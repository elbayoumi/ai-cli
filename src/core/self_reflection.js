function describeActionResult(entry) {
    if (!entry?.action) {
        return 'unknown action';
    }

    if (entry.result?.success === false) {
        return `${entry.action.action} failed`;
    }

    return `${entry.action.action} succeeded`;
}

export function createReflection({ task, outcome, actions = [] }) {
    const succeeded = actions
        .filter((entry) => entry?.result?.success !== false)
        .map(describeActionResult);
    const failed = actions
        .filter((entry) => entry?.result?.success === false)
        .map(describeActionResult);

    const improvements = [];
    if (failed.length > 0) {
        improvements.push('Reduce failed actions before retrying the same approach.');
    }
    if (actions.some((entry) => entry?.result?.timedOut)) {
        improvements.push('Lower command scope or increase timeout only when justified.');
    }
    if (actions.some((entry) => entry?.result?.skipped)) {
        improvements.push('Plan around privileged actions earlier to avoid operator skips.');
    }
    if (improvements.length === 0) {
        improvements.push('Preserve the same execution path for similar tasks.');
    }

    return {
        task,
        success: outcome.success !== false,
        summary: outcome.summary || (outcome.success === false ? 'Task failed.' : 'Task completed.'),
        whatSucceeded: succeeded,
        whatFailed: failed,
        couldImprove: improvements,
        notes: [
            succeeded.length > 0 ? `Successful steps: ${succeeded.length}` : null,
            failed.length > 0 ? `Failed steps: ${failed.length}` : null,
            outcome.summary || null,
        ].filter(Boolean).join(' | '),
        timestamp: new Date().toISOString(),
    };
}
