import { constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import path from 'path';

import * as memory from '../memory/context_store.js';
import { getWorkspaceRoot } from '../tools/filesystem.js';

function statusFor(condition, ok = 'ok', bad = 'warn') {
    return condition ? ok : bad;
}

export async function runDoctor({ workDir = getWorkspaceRoot(), registry }) {
    const checks = [];
    const resolvedWorkDir = getWorkspaceRoot(workDir);

    checks.push({
        name: 'gemini_api_key',
        status: statusFor(Boolean(process.env.GEMINI_API_KEY)),
        message: process.env.GEMINI_API_KEY
            ? 'Gemini API key is configured.'
            : 'Gemini API key is not configured; local commands still work.',
    });

    try {
        await fs.access(resolvedWorkDir, fsConstants.R_OK | fsConstants.W_OK);
        checks.push({
            name: 'workspace_permissions',
            status: 'ok',
            message: `Workspace is readable and writable: ${resolvedWorkDir}`,
        });
    } catch (error) {
        checks.push({
            name: 'workspace_permissions',
            status: 'fail',
            message: `Workspace access failed: ${error.message}`,
        });
    }

    try {
        const tempDir = path.join(resolvedWorkDir, '.ai');
        const tempFile = path.join(tempDir, '.doctor-write-check');
        await fs.mkdir(tempDir, { recursive: true });
        await fs.writeFile(tempFile, 'ok', 'utf8');
        await fs.unlink(tempFile);
        checks.push({
            name: 'memory_storage',
            status: 'ok',
            message: 'Memory directory is writable.',
        });
    } catch (error) {
        checks.push({
            name: 'memory_storage',
            status: 'fail',
            message: `Memory directory check failed: ${error.message}`,
        });
    }

    try {
        const memoryPath = path.join(resolvedWorkDir, '.ai', 'context.json');
        try {
            const raw = await fs.readFile(memoryPath, 'utf8');
            JSON.parse(raw);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
        await memory.load(resolvedWorkDir);
        checks.push({
            name: 'memory_file',
            status: 'ok',
            message: 'Memory file is readable and valid JSON.',
        });
    } catch (error) {
        checks.push({
            name: 'memory_file',
            status: 'fail',
            message: `Memory file is invalid: ${error.message}`,
        });
    }

    if (registry) {
        await registry.load({ force: true });
        const errors = registry.getLoadErrors();
        checks.push({
            name: 'plugin_integrity',
            status: errors.length === 0 ? 'ok' : 'warn',
            message: errors.length === 0
                ? 'All plugins loaded successfully.'
                : `${errors.length} plugin or skill modules failed to load.`,
            details: errors,
        });
    }

    const summary = {
        ok: checks.filter((check) => check.status === 'ok').length,
        warn: checks.filter((check) => check.status === 'warn').length,
        fail: checks.filter((check) => check.status === 'fail').length,
    };

    return {
        workDir: resolvedWorkDir,
        checks,
        summary,
    };
}
