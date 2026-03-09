import fs from 'fs/promises';
import path from 'path';

import { createEmptyMetrics, ensureMetrics, getMetricsSnapshot } from '../core/metrics.js';
import { getWorkspaceRoot } from '../tools/filesystem.js';
import { logger } from '../utils/logger.js';

const CONTEXT_DIR = '.ai';
const CONTEXT_FILE = 'context.json';
const CONTEXT_VERSION = 2;
const MAX_COMMANDS = 50;
const MAX_RESULTS = 50;
const MAX_TASKS = 50;
const MAX_REFLECTIONS = 25;
const DEFAULT_SCAN_DEPTH = 4;
const DEFAULT_MAX_PROJECT_ENTRIES = 400;
const MAX_CONTEXT_FILE_BYTES = parseInt(process.env.MAX_CONTEXT_FILE_BYTES || '1048576', 10);

const SKIP_DIRECTORIES = new Set([
    '.ai',
    '.git',
    '.next',
    '.turbo',
    'build',
    'coverage',
    'dist',
    'node_modules',
    'vendor',
]);

function now() {
    return new Date().toISOString();
}

function trimText(value, maxLength = 1200) {
    if (typeof value !== 'string') {
        return value;
    }

    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, maxLength)}...`;
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function createEmptyContext(workDir = getWorkspaceRoot()) {
    const timestamp = now();

    return {
        version: CONTEXT_VERSION,
        workspace: {
            root: workDir,
        },
        project: {
            root: workDir,
            scannedAt: null,
            entries: [],
            analysis: null,
        },
        recentCommands: [],
        executionResults: [],
        taskHistory: [],
        reflections: [],
        metrics: createEmptyMetrics(),
        meta: {
            createdAt: timestamp,
            updatedAt: timestamp,
        },
    };
}

function getContextPath(workDir = getWorkspaceRoot()) {
    return path.join(getWorkspaceRoot(workDir), CONTEXT_DIR, CONTEXT_FILE);
}

function mergeContext(raw, workDir) {
    const base = createEmptyContext(workDir);
    if (!raw || typeof raw !== 'object') {
        return base;
    }

    const reflectionValue = Array.isArray(raw.reflections)
        ? raw.reflections
        : (raw.reflection ? [raw.reflection] : []);

    const merged = {
        ...base,
        ...raw,
        workspace: {
            ...base.workspace,
            ...(raw.workspace || {}),
            root: getWorkspaceRoot(raw.workspace?.root || workDir),
        },
        project: {
            ...base.project,
            ...(raw.project || {}),
            root: getWorkspaceRoot(raw.project?.root || workDir),
            entries: ensureArray(raw.project?.entries || raw.project?.files),
            analysis: raw.project?.analysis || raw.project?.type
                ? {
                    root: raw.project?.root || raw.project?.analysis?.root || getWorkspaceRoot(workDir),
                    type: raw.project?.type || raw.project?.analysis?.type || null,
                    language: raw.project?.language || raw.project?.analysis?.language || null,
                    framework: raw.project?.framework || raw.project?.analysis?.framework || null,
                    frameworks: ensureArray(raw.project?.frameworks || raw.project?.analysis?.frameworks),
                    packageName: raw.project?.packageName || raw.project?.analysis?.packageName || null,
                    packageManager: raw.project?.packageManager || raw.project?.analysis?.packageManager || null,
                    dependencyManagers: ensureArray(
                        raw.project?.dependencyManagers || raw.project?.analysis?.dependencyManagers
                    ),
                    buildSystems: ensureArray(raw.project?.buildSystems || raw.project?.analysis?.buildSystems),
                    hasDocker: Boolean(
                        raw.project?.hasDocker ?? raw.project?.analysis?.hasDocker
                    ),
                    git: raw.project?.git || raw.project?.analysis?.git || null,
                    analyzedAt: raw.project?.analyzedAt || raw.project?.analysis?.analyzedAt || null,
                }
                : null,
        },
        recentCommands: ensureArray(raw.recentCommands || raw.commands),
        executionResults: ensureArray(raw.executionResults || raw.results),
        taskHistory: ensureArray(raw.taskHistory || raw.history),
        reflections: reflectionValue,
        metrics: raw.metrics || createEmptyMetrics(),
        meta: {
            ...base.meta,
            ...(raw.meta || {}),
        },
    };

    ensureMetrics(merged);
    return merged;
}

function touch(context) {
    context.meta.updatedAt = now();
}

function pushCapped(list, entry, limit) {
    list.push(entry);
    if (list.length > limit) {
        list.splice(0, list.length - limit);
    }
}

async function walkProject(root, current, depth, maxDepth, entries, maxEntries) {
    if (depth > maxDepth || entries.length >= maxEntries) {
        return;
    }

    let dirents;
    try {
        dirents = await fs.readdir(current, { withFileTypes: true });
    } catch {
        return;
    }

    for (const dirent of dirents) {
        if (entries.length >= maxEntries) {
            return;
        }

        if (dirent.name.startsWith('.git')) {
            continue;
        }

        if (dirent.isDirectory() && SKIP_DIRECTORIES.has(dirent.name)) {
            continue;
        }

        const fullPath = path.join(current, dirent.name);
        const relativePath = path.relative(root, fullPath) || '.';

        entries.push({
            path: relativePath,
            type: dirent.isDirectory()
                ? 'directory'
                : (dirent.isSymbolicLink() ? 'symlink' : 'file'),
            depth,
        });

        if (dirent.isDirectory()) {
            await walkProject(root, fullPath, depth + 1, maxDepth, entries, maxEntries);
        }
    }
}

function enforceContextSize(context) {
    let payload = JSON.stringify(context, null, 2);
    if (Buffer.byteLength(payload, 'utf8') <= MAX_CONTEXT_FILE_BYTES) {
        return context;
    }

    const next = { ...context };
    next.project = {
        ...next.project,
        entries: ensureArray(next.project?.entries).slice(0, Math.floor(DEFAULT_MAX_PROJECT_ENTRIES / 2)),
    };
    next.executionResults = ensureArray(next.executionResults).slice(-25);
    next.recentCommands = ensureArray(next.recentCommands).slice(-25);
    next.taskHistory = ensureArray(next.taskHistory).slice(-25);
    next.reflections = ensureArray(next.reflections).slice(-10);
    payload = JSON.stringify(next, null, 2);

    if (Buffer.byteLength(payload, 'utf8') > MAX_CONTEXT_FILE_BYTES) {
        next.project.entries = [];
    }

    return next;
}

export async function load(workDir = getWorkspaceRoot()) {
    try {
        const raw = await fs.readFile(getContextPath(workDir), 'utf8');
        return mergeContext(JSON.parse(raw), workDir);
    } catch {
        return createEmptyContext(workDir);
    }
}

export async function save(context, workDir = context.workspace?.root || getWorkspaceRoot()) {
    const resolvedWorkDir = getWorkspaceRoot(workDir);
    const merged = mergeContext(context, resolvedWorkDir);
    touch(merged);

    const next = enforceContextSize(merged);
    const contextPath = getContextPath(resolvedWorkDir);
    await fs.mkdir(path.dirname(contextPath), { recursive: true });
    await fs.writeFile(contextPath, JSON.stringify(next, null, 2), 'utf8');

    logger.debug(`Saved context to ${contextPath}`);
    return next;
}

export async function clear(workDir = getWorkspaceRoot()) {
    const context = createEmptyContext(workDir);
    await save(context, workDir);
    return context;
}

export async function scanProject(context, options = {}) {
    const workDir = getWorkspaceRoot(options.workDir || context.workspace?.root || process.cwd());
    const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : DEFAULT_SCAN_DEPTH;
    const maxEntries = Number.isFinite(options.maxEntries)
        ? options.maxEntries
        : DEFAULT_MAX_PROJECT_ENTRIES;
    const entries = [];

    await walkProject(workDir, workDir, 1, maxDepth, entries, maxEntries);

    context.workspace.root = workDir;
    context.project = {
        ...context.project,
        root: workDir,
        scannedAt: now(),
        entries,
    };
    touch(context);

    return context.project;
}

export function updateProjectAnalysis(context, analysis) {
    context.project = {
        ...context.project,
        ...analysis,
        analysis,
    };
    touch(context);
}

export function recordCommand(context, entry) {
    pushCapped(
        context.recentCommands,
        {
            timestamp: now(),
            actionId: entry.actionId || null,
            command: entry.command,
            cwd: entry.cwd,
            permissionLevel: entry.permissionLevel || null,
            success: entry.success !== false,
            exitCode: entry.exitCode ?? null,
            durationMs: entry.durationMs ?? null,
            stdout: trimText(entry.stdout || ''),
            stderr: trimText(entry.stderr || ''),
        },
        MAX_COMMANDS
    );
    touch(context);
}

export function recordResult(context, entry) {
    pushCapped(
        context.executionResults,
        {
            timestamp: now(),
            actionId: entry.actionId || null,
            action: entry.action,
            permissionLevel: entry.permissionLevel || null,
            success: entry.success !== false,
            summary: trimText(entry.summary || ''),
            payload: entry.payload || null,
        },
        MAX_RESULTS
    );
    touch(context);
}

export function recordTask(context, entry) {
    pushCapped(
        context.taskHistory,
        {
            timestamp: now(),
            executionId: entry.executionId || null,
            taskId: entry.taskId || null,
            task: entry.task,
            status: entry.status || 'completed',
            summary: trimText(entry.summary || ''),
            iterations: entry.iterations ?? null,
            durationMs: entry.durationMs ?? null,
        },
        MAX_TASKS
    );
    touch(context);
}

export function recordReflection(context, reflection) {
    pushCapped(
        context.reflections,
        reflection,
        MAX_REFLECTIONS
    );
    touch(context);
}

export function buildPromptContext(context, options = {}) {
    const sampleSize = Number.isFinite(options.sampleSize) ? options.sampleSize : 40;

    return {
        workspace: context.workspace,
        project: {
            root: context.project?.root,
            scannedAt: context.project?.scannedAt,
            totalEntries: context.project?.entries?.length || 0,
            sampleEntries: ensureArray(context.project?.entries).slice(0, sampleSize),
            analysis: context.project?.analysis || null,
        },
        recentCommands: ensureArray(context.recentCommands).slice(-5),
        executionResults: ensureArray(context.executionResults).slice(-5),
        taskHistory: ensureArray(context.taskHistory).slice(-5),
        reflections: ensureArray(context.reflections).slice(-3),
        metrics: getMetricsSnapshot(context),
    };
}

export function displayContext(context) {
    logger.divider('MEMORY');
    logger.info(`Workspace: ${context.workspace?.root || 'unknown'}`);
    logger.info(`Project entries: ${context.project?.entries?.length || 0}`);
    logger.info(`Project type: ${context.project?.analysis?.type || context.project?.type || 'unknown'}`);
    logger.info(`Recent commands: ${context.recentCommands?.length || 0}`);
    logger.info(`Execution results: ${context.executionResults?.length || 0}`);
    logger.info(`Task history: ${context.taskHistory?.length || 0}`);
    logger.info(`Reflections: ${context.reflections?.length || 0}`);
    logger.info(`Updated: ${context.meta?.updatedAt || 'unknown'}`);

    const recentTasks = ensureArray(context.taskHistory).slice(-5);
    if (recentTasks.length > 0) {
        logger.divider('RECENT TASKS');
        for (const entry of recentTasks) {
            logger.raw(`- ${entry.task} [${entry.status}]`);
        }
    }

    logger.divider();
}
