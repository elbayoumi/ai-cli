import { GoogleGenerativeAI } from '@google/generative-ai';

const BASE_SYSTEM_PROMPT = [
    'You are the reasoning engine for a secure terminal-first AI agent.',
    'Always return exactly one JSON object and nothing else.',
    'Never use markdown fences or prose outside the JSON object.',
    'Only use skills that appear in the provided catalog.',
    'Prefer the least-privileged skill that can complete the step.',
    'AI never executes commands directly; every action must route through a skill.',
    'Plan responses must be either a human_plan (string steps) or an execution_plan (action objects).',
    'Never suggest destructive commands such as rm -rf /, shutdown, reboot, mkfs, dd, or destructive disk operations.',
    'If an explanation is requested, provide a short operational explanation in the "explanation" field.',
].join('\n');

function getApiKey() {
    return process.env.GEMINI_API_KEY || null;
}

function getModelName() {
    return process.env.GEMINI_MODEL || 'gemini-2.0-flash';
}

function stripFences(raw) {
    return String(raw || '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function parseJson(raw) {
    const cleaned = stripFences(raw);
    if (!cleaned) {
        throw new Error('Gemini returned an empty response.');
    }

    try {
        return JSON.parse(cleaned);
    } catch {
        throw new Error(`Gemini returned invalid JSON: ${cleaned.slice(0, 300)}`);
    }
}

function formatSkillCatalog(skills) {
    return skills.map((skill) => JSON.stringify({
        name: skill.name,
        description: skill.description,
        permissionLevel: skill.permissionLevel,
        inputSchema: skill.inputSchema,
    })).join('\n');
}

function buildPrompt({ task, context, skills, mode }) {
    const shared = [
        `Mode: ${mode}`,
        'Workspace context:',
        JSON.stringify(context, null, 2),
        'Available skills:',
        formatSkillCatalog(skills),
        `Task: ${task}`,
    ];

    if (mode === 'plan') {
        shared.push(
            'Return a human plan.',
            'Use {"action":"plan","description":"...","steps":["...", "..."]}.',
        );
    } else if (mode === 'explain') {
        shared.push(
            'Return either a single skill action or a human plan.',
            'Always include "explanation" with a short operational rationale.',
        );
    } else {
        shared.push(
            'Return either one concrete skill action or an execution plan.',
            'Execution plans must use {"action":"plan","description":"...","steps":[{...action...}, {...action...}]}.',
        );
    }

    return shared.join('\n\n');
}

function buildLoopBootstrap({ task, context, skills }) {
    return [
        'Loop mode instructions:',
        'Return one JSON object per turn.',
        'Allowed actions: any skill from the catalog, "think", "plan", or "done".',
        'When you return "plan" in loop mode, it must be an execution_plan with action objects only.',
        'When the task is complete, return {"action":"done","summary":"..."}',
        '',
        'Workspace context:',
        JSON.stringify(context, null, 2),
        '',
        'Available skills:',
        formatSkillCatalog(skills),
        '',
        `Task: ${task}`,
        '',
        'Return the first response now.',
    ].join('\n');
}

export class GeminiReasoner {
    constructor(options = {}) {
        this.modelName = options.modelName || getModelName();
        this.apiKey = options.apiKey || getApiKey();
        this.client = this.apiKey ? new GoogleGenerativeAI(this.apiKey) : null;
    }

    isConfigured() {
        return Boolean(this.client);
    }

    createModel() {
        if (!this.client) {
            throw new Error('GEMINI_API_KEY is not set.');
        }

        return this.client.getGenerativeModel({
            model: this.modelName,
            systemInstruction: BASE_SYSTEM_PROMPT,
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4096,
                responseMimeType: 'application/json',
            },
        });
    }

    async request({ task, context, skills, mode = 'execute' }) {
        const model = this.createModel();
        const prompt = buildPrompt({ task, context, skills, mode });
        let lastError = null;

        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const result = await model.generateContent(prompt);
                return parseJson(result.response.text());
            } catch (error) {
                lastError = error;
            }
        }

        throw lastError || new Error('Gemini request failed.');
    }

    async startSession({ task, context, skills }) {
        const model = this.createModel();
        const chat = model.startChat();

        async function send(message) {
            const result = await chat.sendMessage(
                typeof message === 'string' ? message : JSON.stringify(message, null, 2)
            );

            return parseJson(result.response.text());
        }

        const initialResponse = await send(buildLoopBootstrap({ task, context, skills }));

        return {
            initialResponse,
            sendObservation: send,
        };
    }
}
