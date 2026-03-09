import { displayPlan, isPlanAction, validateModelResponse } from './planner.js';
import { logger } from '../utils/logger.js';

const DEFAULT_MAX_ITERATIONS = parseInt(process.env.MAX_ITERATIONS || '12', 10);
const MAX_CONSECUTIVE_FAILURES = parseInt(process.env.MAX_CONSECUTIVE_FAILURES || '3', 10);
const MAX_INVALID_AI_RESPONSES = parseInt(process.env.MAX_INVALID_AI_RESPONSES || '3', 10);

function compactResult(result) {
    return {
        success: result.success !== false,
        skipped: Boolean(result.skipped),
        path: result.path,
        command: result.command,
        exitCode: result.exitCode ?? null,
        durationMs: result.durationMs ?? null,
        summary: result.summary || null,
        stdout: typeof result.stdout === 'string' ? result.stdout.slice(0, 1500) : undefined,
        stderr: typeof result.stderr === 'string' ? result.stderr.slice(0, 1500) : undefined,
        content: typeof result.content === 'string' ? result.content.slice(0, 1500) : undefined,
        entries: Array.isArray(result.entries) ? result.entries.slice(0, 30) : undefined,
    };
}

async function requestRecoveryResponse(session, reason) {
    return session.sendObservation({
        type: 'system',
        message: `Previous model output was invalid: ${reason}. Return one valid JSON object now.`,
    });
}

export async function runAgentLoop({
    task,
    engine,
    reasoner,
    options = {},
}) {
    const maxIterations = Number.isFinite(options.maxIterations)
        ? options.maxIterations
        : DEFAULT_MAX_ITERATIONS;
    const maxStepsPerTask = engine.getRuntimeLimits().maxStepsPerTask;
    const skills = await engine.listSkills();
    const availableSkillNames = new Set(skills.map((skill) => skill.name));
    const context = await engine.buildAiContext();
    const session = await reasoner.startSession({ task, context, skills });

    let response = session.initialResponse;
    let consecutiveFailures = 0;
    let invalidResponses = 0;
    const actions = [];

    logger.divider('AGENT LOOP');
    logger.info(`Task: ${task}`);
    logger.info(`Max iterations: ${maxIterations}`);
    logger.info(`Max steps: ${maxStepsPerTask}`);
    logger.divider();

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        engine.assertMemoryWithinLimit();

        let action;
        try {
            action = validateModelResponse(response, {
                availableSkillNames,
                allowLoopActions: true,
            });
            invalidResponses = 0;
        } catch (error) {
            invalidResponses += 1;
            logger.warn(`Invalid AI response (${invalidResponses}/${MAX_INVALID_AI_RESPONSES}): ${error.message}`);

            if (invalidResponses >= MAX_INVALID_AI_RESPONSES) {
                return {
                    success: false,
                    summary: `Stopped after ${invalidResponses} invalid AI responses.`,
                    actions,
                };
            }

            response = await requestRecoveryResponse(session, error.message);
            continue;
        }

        if (action.action === 'think') {
            logger.ai(action.thought);
            response = await session.sendObservation({
                type: 'system',
                message: 'Thought acknowledged. Return the next concrete action.',
            });
            continue;
        }

        if (action.action === 'done') {
            logger.success(action.summary);
            return {
                success: true,
                summary: action.summary,
                actions,
            };
        }

        if (isPlanAction(action)) {
            displayPlan(action);
            if (action.executable && action.executionSteps.length > 0) {
                response = action.executionSteps[0];
                continue;
            }

            response = await session.sendObservation({
                type: 'system',
                message: 'Plan noted. Return the first executable action now.',
            });
            continue;
        }

        if (actions.length >= maxStepsPerTask) {
            return {
                success: false,
                summary: `Stopped after reaching the maximum step limit (${maxStepsPerTask}).`,
                actions,
            };
        }

        const result = await engine.executeAction(action, {
            ...options,
            actions,
        });
        actions.push({ action, result });

        consecutiveFailures = result.success === false ? consecutiveFailures + 1 : 0;

        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            return {
                success: false,
                summary: `Stopped after ${consecutiveFailures} consecutive failed actions.`,
                actions,
            };
        }

        try {
            response = await session.sendObservation({
                type: 'observation',
                action,
                result: compactResult(result),
            });
        } catch (error) {
            invalidResponses += 1;
            logger.warn(`Observation handling failed (${invalidResponses}/${MAX_INVALID_AI_RESPONSES}): ${error.message}`);

            if (invalidResponses >= MAX_INVALID_AI_RESPONSES) {
                return {
                    success: false,
                    summary: `Stopped after ${invalidResponses} invalid AI responses.`,
                    actions,
                };
            }

            response = await requestRecoveryResponse(session, error.message);
        }
    }

    return {
        success: false,
        summary: `Stopped after reaching the iteration limit (${maxIterations}).`,
        actions,
    };
}
