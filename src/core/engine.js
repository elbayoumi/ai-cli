import { randomUUID } from 'crypto';

import chalk from 'chalk';
import ora from 'ora';

import { GeminiReasoner } from './ai.js';
import { runAgentLoop } from './agent_loop.js';
import { buildOfflineFallbackPlan, shouldUseOfflineFallback } from './local_fallback.js';
import { getMetricsSnapshot, recordActionMetric, recordTaskMetric } from './metrics.js';
import { analyzeWorkspace } from './project_analyzer.js';
import { createReflection } from './self_reflection.js';
import {
    coerceToDisplayPlan,
    describeAction,
    displayPlan,
    isExecutablePlan,
    validateModelResponse,
} from './planner.js';
import * as memory from '../memory/context_store.js';
import { getWorkspaceRoot } from '../tools/filesystem.js';
import { getDefaultRegistry, requiresExplicitConfirmation } from '../skills/registry.js';
import { validateSchema } from '../utils/schema_validator.js';
import { logger } from '../utils/logger.js';

const MAX_MEMORY_BYTES = parseInt(process.env.MAX_MEMORY_BYTES || '536870912', 10);
const MAX_STEPS_PER_TASK = parseInt(process.env.MAX_STEPS_PER_TASK || '25', 10);

async function confirm(message) {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    return new Promise((resolve) => {
        rl.question(`${message} [y/N] `, (answer) => {
            rl.close();
            resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
        });
    });
}

function trimPayload(result) {
    if (result == null || typeof result !== 'object') {
        return result;
    }

    const payload = { ...result };

    for (const key of ['stdout', 'stderr', 'content', 'bodyText']) {
        if (typeof payload[key] === 'string') {
            payload[key] = payload[key].slice(0, 1000);
        }
    }

    if (Array.isArray(payload.entries)) {
        payload.entries = payload.entries.slice(0, 20);
    }

    return payload;
}

function summarizeResult(action, result) {
    if (result.skipped) {
        return `Skipped ${action.action}`;
    }

    if (action.action === 'terminal.run_command') {
        return result.success
            ? `Command completed: ${action.command}`
            : `Command failed: ${action.command}`;
    }

    if (action.action === 'project.analyze') {
        return `Analyzed project: ${result.analysis?.type || 'unknown'}`;
    }

    if (action.action === 'http.request') {
        return `${action.method || 'GET'} ${action.url} -> ${result.status ?? 'error'}`;
    }

    return describeAction(action);
}

function renderResult(action, result) {
    logger.divider('RESULT');

    switch (action.action) {
        case 'terminal.run_command':
            if (result.stdout) {
                logger.raw(result.stdout);
            }
            if (result.stderr) {
                logger.warn(result.stderr);
            }
            logger.info(`Exit code: ${result.exitCode ?? 0}`);
            logger.info(`Duration: ${result.durationMs ?? 0}ms`);
            break;
        case 'filesystem.read_file':
            logger.raw(result.content);
            break;
        case 'filesystem.list_files':
            for (const entry of result.entries || []) {
                logger.raw(`- [${entry.type}] ${entry.path}`);
            }
            break;
        case 'filesystem.write_file':
            logger.success(`Wrote ${result.bytes} bytes to ${result.path}`);
            break;
        case 'filesystem.edit_file':
            logger.success(`Applied ${result.operation} to ${result.path}`);
            break;
        case 'project.analyze':
            logger.raw(JSON.stringify(result.analysis, null, 2));
            break;
        case 'http.request':
            logger.info(`${result.status ?? 'error'} ${result.statusText || ''}`.trim());
            if (result.body && typeof result.body === 'object') {
                logger.raw(JSON.stringify(result.body, null, 2));
            } else if (result.bodyText) {
                logger.raw(result.bodyText);
            } else if (result.error) {
                logger.warn(result.error);
            }
            break;
        case 'git.status':
        case 'git.diff':
        case 'git.log':
        case 'git.branch':
        case 'git.commit':
            if (result.stdout) {
                logger.raw(result.stdout);
            }
            if (result.stderr) {
                logger.warn(result.stderr);
            }
            break;
        case 'agent.self_reflect':
            logger.raw(JSON.stringify(result.reflection, null, 2));
            break;
        default:
            logger.raw(JSON.stringify(result, null, 2));
            break;
    }

    logger.divider();
}

function displayAction(action, permissionLevel) {
    logger.action(describeAction(action));
    logger.info(`Permission: ${permissionLevel}`);
    if (action.explanation) {
        logger.ai(action.explanation);
    }
}

export class AgentEngine {
    constructor(options = {}) {
        this.workDir = getWorkspaceRoot(options.workDir || process.cwd());
        this.runtimeContext = options.runtimeContext || {};
        this.registry = options.registry || getDefaultRegistry({ cwd: this.workDir });
        this.reasoner = options.reasoner || null;
        this.initialized = false;
        this.context = null;
    }

    getReasoner() {
        if (!this.reasoner) {
            this.reasoner = new GeminiReasoner();
        }

        return this.reasoner;
    }

    getRuntimeLimits() {
        return {
            maxStepsPerTask: MAX_STEPS_PER_TASK,
            maxMemoryBytes: MAX_MEMORY_BYTES,
        };
    }

    assertMemoryWithinLimit() {
        const heapUsed = process.memoryUsage().heapUsed;
        if (heapUsed > MAX_MEMORY_BYTES) {
            throw new Error(`Runtime memory usage exceeded the configured limit (${MAX_MEMORY_BYTES} bytes).`);
        }
    }

    async initialize() {
        if (this.initialized) {
            return this;
        }

        await this.registry.load();
        this.context = await memory.load(this.workDir);

        if (!Array.isArray(this.context.project?.entries) || this.context.project.entries.length === 0) {
            await memory.scanProject(this.context, { workDir: this.workDir });
        }

        if (!this.context.project?.analysis) {
            const analysis = await analyzeWorkspace(this.workDir);
            memory.updateProjectAnalysis(this.context, analysis);
        }

        this.context = await memory.save(this.context, this.workDir);
        this.initialized = true;
        return this;
    }

    async listSkills() {
        await this.initialize();
        return this.registry.listSkills();
    }

    async listPlugins() {
        await this.initialize();
        return this.registry.listPlugins();
    }

    async buildAiContext(extra = {}) {
        await this.initialize();

        return {
            runtime: {
                workDir: this.workDir,
                platform: process.platform,
                arch: process.arch,
                node: process.version,
                shell: process.env.SHELL || 'unknown',
                limits: this.getRuntimeLimits(),
                ...this.runtimeContext,
            },
            memory: memory.buildPromptContext(this.context),
            ...extra,
        };
    }

    async updateProjectAnalysis(analysis) {
        await this.initialize();
        memory.updateProjectAnalysis(this.context, analysis);
        this.context = await memory.save(this.context, this.workDir);
        return analysis;
    }

    async analyzeProject() {
        await this.initialize();
        const analysis = await analyzeWorkspace(this.workDir);
        await this.updateProjectAnalysis(analysis);
        return analysis;
    }

    async recordExecution(action, result, meta = {}) {
        await this.initialize();

        if (action.action === 'terminal.run_command') {
            memory.recordCommand(this.context, {
                actionId: meta.actionId,
                command: action.command,
                cwd: result.cwd,
                permissionLevel: meta.permissionLevel,
                success: result.success,
                exitCode: result.exitCode,
                durationMs: result.durationMs,
                stdout: result.stdout,
                stderr: result.stderr,
            });
        }

        memory.recordResult(this.context, {
            actionId: meta.actionId,
            action: action.action,
            permissionLevel: meta.permissionLevel,
            success: result.success,
            summary: summarizeResult(action, result),
            payload: trimPayload(result),
        });

        recordActionMetric(this.context, {
            success: result.success,
            durationMs: result.durationMs,
        });

        this.context = await memory.save(this.context, this.workDir);
    }

    async recordTaskOutcome(task, outcome) {
        await this.initialize();
        memory.recordTask(this.context, {
            task,
            ...outcome,
        });
        recordTaskMetric(this.context, {
            success: outcome.success !== false,
            durationMs: outcome.durationMs,
        });
        this.context = await memory.save(this.context, this.workDir);
    }

    async recordReflection(reflection) {
        await this.initialize();
        memory.recordReflection(this.context, reflection);
        this.context = await memory.save(this.context, this.workDir);
    }

    getMetrics() {
        return getMetricsSnapshot(this.context);
    }

    validateActionInput(skill, action) {
        const payload = { ...action };
        delete payload.action;
        delete payload.explanation;

        const errors = validateSchema(payload, skill.inputSchema);
        if (errors.length > 0) {
            throw new Error(`Invalid input for ${skill.name}: ${errors.join(' ')}`);
        }
    }

    async executeAction(action, options = {}) {
        await this.initialize();
        this.assertMemoryWithinLimit();

        const skill = await this.registry.getSkill(action.action);
        if (!skill) {
            throw new Error(`Unknown skill: ${action.action}`);
        }

        this.validateActionInput(skill, action);

        const actionId = options.actionId || randomUUID();
        const permissionLevel = skill.permissionLevel || 'system';

        return logger.withContext({ action_id: actionId }, async () => {
            displayAction(action, permissionLevel);

            const requiresApproval = requiresExplicitConfirmation(permissionLevel) && !options.unsafe;
            if (requiresApproval) {
                const approved = await confirm(chalk.yellow(`Execute privileged action (${permissionLevel})?`));
                if (!approved) {
                    const skipped = {
                        success: false,
                        skipped: true,
                        summary: `User skipped ${action.action}`,
                    };
                    await this.recordExecution(action, skipped, { actionId, permissionLevel });
                    logger.warn('Action skipped by user.');
                    return skipped;
                }
            }

            let result;
            try {
                result = await skill.handler(action, {
                    engine: this,
                    workDir: this.workDir,
                    options,
                    actionId,
                    permissionLevel,
                    actions: options.actions || [],
                });
            } catch (error) {
                result = {
                    success: false,
                    error: error.message,
                    stderr: error.message,
                };
            }

            const normalizedResult = {
                success: result.success !== false,
                ...result,
            };

            await this.recordExecution(action, normalizedResult, { actionId, permissionLevel });
            renderResult(action, normalizedResult);

            return normalizedResult;
        });
    }

    async executePlan(plan, options = {}) {
        const steps = isExecutablePlan(plan)
            ? plan.executionSteps
            : plan.executionSteps || [];

        if (steps.length === 0) {
            throw new Error('Plan is not executable.');
        }

        if (steps.length > MAX_STEPS_PER_TASK) {
            throw new Error(`Plan exceeds maximum steps per task (${MAX_STEPS_PER_TASK}).`);
        }

        displayPlan(plan);
        const results = [];

        for (const step of steps) {
            const result = await this.executeAction(step, {
                ...options,
                actions: results,
            });
            results.push({ action: step, result });

            if (result.success === false) {
                break;
            }
        }

        return results;
    }

    async requestModel(task, mode) {
        await this.initialize();
        const skills = await this.listSkills();
        const spinner = ora({ text: 'Thinking...', color: 'magenta' }).start();

        try {
            const response = await this.getReasoner().request({
                task,
                context: await this.buildAiContext(),
                skills,
                mode,
            });
            spinner.stop();
            return validateModelResponse(response, {
                availableSkillNames: new Set(skills.map((skill) => skill.name)),
                allowLoopActions: false,
            });
        } catch (error) {
            spinner.fail(`AI error: ${error.message}`);
            throw error;
        }
    }

    async runTask(task, options = {}) {
        await this.initialize();
        const executionId = options.executionId || randomUUID();
        const taskId = options.taskId || randomUUID();
        const startedAt = Date.now();

        return logger.withContext({ execution_id: executionId, task_id: taskId }, async () => {
            try {
                if (options.planOnly) {
                    const response = await this.requestModel(task, 'plan');
                    const plan = coerceToDisplayPlan(response);
                    displayPlan(plan);
                    return { plan };
                }

                if (options.explain) {
                    const response = await this.requestModel(task, 'explain');
                    if (response.explanation) {
                        logger.ai(response.explanation);
                    }
                    const plan = coerceToDisplayPlan(response);
                    displayPlan(plan);
                    return { explanation: response.explanation, plan };
                }

                let outcome;
                try {
                    outcome = await runAgentLoop({
                        task,
                        engine: this,
                        reasoner: this.getReasoner(),
                        options,
                    });
                } catch (error) {
                    if (!shouldUseOfflineFallback(error)) {
                        throw error;
                    }

                    const fallbackPlan = buildOfflineFallbackPlan(task);
                    if (!fallbackPlan) {
                        throw error;
                    }

                    logger.warn('AI unavailable (quota/network). Using offline fallback.');
                    const fallbackResults = await this.executePlan(fallbackPlan, options);
                    const failedStep = fallbackResults.find((entry) => entry.result.success === false);
                    outcome = {
                        success: !failedStep,
                        summary: failedStep
                            ? `Fallback execution failed at ${failedStep.action.action}.`
                            : 'Fallback execution completed successfully.',
                        actions: fallbackResults,
                    };
                }

                const durationMs = Date.now() - startedAt;
                await this.recordTaskOutcome(task, {
                    executionId,
                    taskId,
                    status: outcome.success ? 'completed' : 'failed',
                    summary: outcome.summary,
                    iterations: outcome.actions?.length || 0,
                    durationMs,
                    success: outcome.success,
                });

                const reflection = createReflection({
                    task,
                    outcome,
                    actions: outcome.actions || [],
                });
                await this.recordReflection(reflection);

                return {
                    ...outcome,
                    executionId,
                    taskId,
                    reflection,
                };
            } catch (error) {
                const durationMs = Date.now() - startedAt;
                await this.recordTaskOutcome(task, {
                    executionId,
                    taskId,
                    status: 'failed',
                    summary: error.message,
                    iterations: 0,
                    durationMs,
                    success: false,
                });
                await this.recordReflection(createReflection({
                    task,
                    outcome: { success: false, summary: error.message },
                    actions: [],
                }));
                throw error;
            }
        });
    }
}

export async function run(task, options = {}) {
    const engine = new AgentEngine({
        workDir: options.workDir,
        runtimeContext: options.context,
    });

    return engine.runTask(task, options);
}
