import { logger } from '../utils/logger.js';

function now() {
    return new Date().toISOString();
}

export function createEmptyMetrics() {
    return {
        tasksExecuted: 0,
        tasksSucceeded: 0,
        tasksFailed: 0,
        actionsExecuted: 0,
        actionsSucceeded: 0,
        actionsFailed: 0,
        totalTaskDurationMs: 0,
        totalActionDurationMs: 0,
        peakHeapUsedBytes: 0,
        lastUpdatedAt: now(),
    };
}

export function ensureMetrics(context) {
    if (!context.metrics || typeof context.metrics !== 'object') {
        context.metrics = createEmptyMetrics();
    }

    return context.metrics;
}

function updatePeakHeap(metrics) {
    metrics.peakHeapUsedBytes = Math.max(
        metrics.peakHeapUsedBytes || 0,
        process.memoryUsage().heapUsed
    );
    metrics.lastUpdatedAt = now();
}

export function recordActionMetric(context, entry = {}) {
    const metrics = ensureMetrics(context);
    metrics.actionsExecuted += 1;
    metrics.totalActionDurationMs += Number.isFinite(entry.durationMs) ? entry.durationMs : 0;

    if (entry.success === false) {
        metrics.actionsFailed += 1;
    } else {
        metrics.actionsSucceeded += 1;
    }

    updatePeakHeap(metrics);
}

export function recordTaskMetric(context, entry = {}) {
    const metrics = ensureMetrics(context);
    metrics.tasksExecuted += 1;
    metrics.totalTaskDurationMs += Number.isFinite(entry.durationMs) ? entry.durationMs : 0;

    if (entry.success === false) {
        metrics.tasksFailed += 1;
    } else {
        metrics.tasksSucceeded += 1;
    }

    updatePeakHeap(metrics);
}

export function getMetricsSnapshot(context) {
    const metrics = ensureMetrics(context);

    return {
        ...metrics,
        taskSuccessRate: metrics.tasksExecuted > 0
            ? Number(((metrics.tasksSucceeded / metrics.tasksExecuted) * 100).toFixed(2))
            : 0,
        actionSuccessRate: metrics.actionsExecuted > 0
            ? Number(((metrics.actionsSucceeded / metrics.actionsExecuted) * 100).toFixed(2))
            : 0,
        averageTaskDurationMs: metrics.tasksExecuted > 0
            ? Number((metrics.totalTaskDurationMs / metrics.tasksExecuted).toFixed(2))
            : 0,
        averageActionDurationMs: metrics.actionsExecuted > 0
            ? Number((metrics.totalActionDurationMs / metrics.actionsExecuted).toFixed(2))
            : 0,
    };
}

export function displayMetrics(snapshot) {
    logger.divider('METRICS');
    logger.info(`Tasks executed: ${snapshot.tasksExecuted}`);
    logger.info(`Task success rate: ${snapshot.taskSuccessRate}%`);
    logger.info(`Average task duration: ${snapshot.averageTaskDurationMs}ms`);
    logger.info(`Actions executed: ${snapshot.actionsExecuted}`);
    logger.info(`Action success rate: ${snapshot.actionSuccessRate}%`);
    logger.info(`Average action duration: ${snapshot.averageActionDurationMs}ms`);
    logger.info(`Peak heap used: ${snapshot.peakHeapUsedBytes} bytes`);
    logger.info(`Updated: ${snapshot.lastUpdatedAt}`);
    logger.divider();
}
