import { logger } from '../utils/logger.js';

const EDIT_OPERATIONS = new Set([
    'append',
    'prepend',
    'replace',
    'replace_block',
    'insert_after',
    'insert_before',
]);

const HUMAN_STEP_CONVERTERS = [
    {
        test: /scan|analy[sz]e.*project/i,
        build: () => ({ action: 'project.analyze' }),
    },
    {
        test: /inspect|read.*package\.json|identify dependencies/i,
        build: () => ({ action: 'filesystem.read_file', path: 'package.json' }),
    },
    {
        test: /list files|inspect workspace|scan workspace/i,
        build: () => ({ action: 'filesystem.list_files', path: '.', recursive: false }),
    },
    {
        test: /git status/i,
        build: () => ({ action: 'git.status' }),
    },
    {
        test: /git diff/i,
        build: () => ({ action: 'git.diff' }),
    },
];

function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureString(value, fieldName) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`AI response field "${fieldName}" must be a non-empty string.`);
    }

    return value.trim();
}

function ensureOptionalString(value, fieldName) {
    if (value == null) {
        return undefined;
    }

    if (typeof value !== 'string') {
        throw new Error(`AI response field "${fieldName}" must be a string.`);
    }

    return value;
}

function ensureStringValue(value, fieldName) {
    if (typeof value !== 'string') {
        throw new Error(`AI response field "${fieldName}" must be a string.`);
    }

    return value;
}

function convertHumanStep(step, availableSkillNames) {
    const normalized = ensureString(step, 'steps[]');

    for (const converter of HUMAN_STEP_CONVERTERS) {
        if (!converter.test.test(normalized)) {
            continue;
        }

        const action = converter.build(normalized);
        if (availableSkillNames.size === 0 || availableSkillNames.has(action.action)) {
            return action;
        }
    }

    return null;
}

function validateSkillAction(response, availableSkillNames) {
    if (availableSkillNames.size > 0 && !availableSkillNames.has(response.action)) {
        throw new Error(`AI selected an unknown skill: ${response.action}`);
    }

    if (response.action === 'terminal.run_command') {
        if (response.timeout != null && !Number.isFinite(response.timeout)) {
            throw new Error('AI response field "timeout" must be a number when provided.');
        }

        return {
            action: response.action,
            explanation: ensureOptionalString(response.explanation, 'explanation'),
            command: ensureString(response.command, 'command'),
            cwd: ensureOptionalString(response.cwd, 'cwd'),
            timeout: response.timeout,
        };
    }

    if (response.action === 'filesystem.read_file') {
        return {
            action: response.action,
            explanation: ensureOptionalString(response.explanation, 'explanation'),
            path: ensureString(response.path, 'path'),
        };
    }

    if (response.action === 'filesystem.write_file') {
        return {
            action: response.action,
            explanation: ensureOptionalString(response.explanation, 'explanation'),
            path: ensureString(response.path, 'path'),
            content: ensureStringValue(response.content, 'content'),
        };
    }

    if (response.action === 'filesystem.list_files') {
        return {
            action: response.action,
            explanation: ensureOptionalString(response.explanation, 'explanation'),
            path: ensureOptionalString(response.path, 'path') || '.',
            recursive: Boolean(response.recursive),
            depth: response.depth,
            includeHidden: Boolean(response.includeHidden),
        };
    }

    if (response.action === 'filesystem.edit_file') {
        const operation = ensureString(response.operation, 'operation');
        if (!EDIT_OPERATIONS.has(operation)) {
            throw new Error(`Unsupported edit operation from AI: ${operation}`);
        }

        if (['append', 'prepend', 'insert_after', 'insert_before'].includes(operation)) {
            ensureStringValue(response.content, 'content');
        }

        if (['replace', 'replace_block', 'insert_after', 'insert_before'].includes(operation)) {
            ensureString(response.target, 'target');
        }

        if (['replace', 'replace_block'].includes(operation) && typeof response.replacement !== 'string') {
            throw new Error('AI response field "replacement" must be a string.');
        }

        return {
            action: response.action,
            explanation: ensureOptionalString(response.explanation, 'explanation'),
            path: ensureString(response.path, 'path'),
            operation,
            target: ensureOptionalString(response.target, 'target'),
            replacement: ensureOptionalString(response.replacement, 'replacement'),
            content: ensureOptionalString(response.content, 'content'),
        };
    }

    return {
        ...response,
        explanation: ensureOptionalString(response.explanation, 'explanation'),
    };
}

function normalizePlan(response, availableSkillNames) {
    if (!Array.isArray(response.steps) || response.steps.length === 0) {
        throw new Error('Plan responses must include a non-empty "steps" array.');
    }

    const normalizedSteps = response.steps.map((step) => {
        if (typeof step === 'string') {
            return ensureString(step, 'steps[]');
        }

        return validateModelResponse(step, {
            availableSkillNames,
            allowLoopActions: false,
        });
    });

    const planType = normalizedSteps.every((step) => typeof step === 'string')
        ? 'human_plan'
        : normalizedSteps.every((step) => isObject(step))
            ? 'execution_plan'
            : 'mixed_plan';

    const executionSteps = normalizedSteps.map((step) => {
        if (typeof step === 'string') {
            return convertHumanStep(step, availableSkillNames);
        }

        return step;
    }).filter(Boolean);

    return {
        action: 'plan',
        planType,
        description: ensureOptionalString(response.description, 'description'),
        explanation: ensureOptionalString(response.explanation, 'explanation'),
        steps: normalizedSteps,
        executionSteps,
        executable: executionSteps.length === normalizedSteps.length && executionSteps.length > 0,
    };
}

export function isPlanAction(response) {
    return isObject(response) && response.action === 'plan' && Array.isArray(response.steps);
}

export function isExecutablePlan(plan) {
    return isPlanAction(plan) && plan.executable === true;
}

export function validateModelResponse(
    response,
    {
        availableSkillNames = new Set(),
        allowLoopActions = false,
    } = {},
) {
    if (!isObject(response)) {
        throw new Error('AI response must be a JSON object.');
    }

    const action = ensureString(response.action, 'action');

    if (action === 'plan') {
        return normalizePlan(response, availableSkillNames);
    }

    if (action === 'done') {
        if (!allowLoopActions) {
            throw new Error('The "done" action is only valid inside the agent loop.');
        }

        return {
            action: 'done',
            summary: ensureOptionalString(response.summary, 'summary') || 'Task completed.',
        };
    }

    if (action === 'think') {
        if (!allowLoopActions) {
            throw new Error('The "think" action is only valid inside the agent loop.');
        }

        return {
            action: 'think',
            thought: ensureOptionalString(response.thought, 'thought')
                || ensureOptionalString(response.explanation, 'explanation')
                || 'Evaluating the next step.',
        };
    }

    return validateSkillAction(response, availableSkillNames);
}

export function coerceToDisplayPlan(response) {
    if (isPlanAction(response)) {
        return response;
    }

    return {
        action: 'plan',
        planType: 'execution_plan',
        description: 'Single action',
        steps: [response],
        executionSteps: [response],
        executable: true,
    };
}

export function describeAction(action) {
    switch (action.action) {
        case 'terminal.run_command':
            return `terminal.run_command -> ${action.command}`;
        case 'filesystem.read_file':
            return `filesystem.read_file -> ${action.path}`;
        case 'filesystem.write_file':
            return `filesystem.write_file -> ${action.path}`;
        case 'filesystem.list_files':
            return `filesystem.list_files -> ${action.path || '.'}`;
        case 'filesystem.edit_file':
            return `filesystem.edit_file (${action.operation}) -> ${action.path}`;
        case 'project.analyze':
            return 'project.analyze -> workspace';
        case 'http.request':
            return `http.request -> ${action.method || 'GET'} ${action.url}`;
        case 'git.status':
        case 'git.diff':
        case 'git.log':
        case 'git.branch':
        case 'git.commit':
            return action.action;
        case 'agent.self_reflect':
            return 'agent.self_reflect';
        case 'plan':
            return action.description || 'Execution plan';
        case 'done':
            return action.summary || 'Task completed';
        case 'think':
            return action.thought || 'Reasoning step';
        default:
            return action.action;
    }
}

function formatPlanStep(step) {
    if (typeof step === 'string') {
        return step;
    }

    return describeAction(step);
}

export function displayPlan(plan) {
    logger.divider('PLAN');
    logger.plan(`${plan.planType || 'plan'}${plan.executable ? ' (executable)' : ''}`);
    if (plan.description) {
        logger.plan(plan.description);
    }
    if (plan.explanation) {
        logger.ai(plan.explanation);
    }
    plan.steps.forEach((step, index) => {
        logger.raw(`${index + 1}. ${formatPlanStep(step)}`);
    });
    logger.divider();
}
