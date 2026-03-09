import { spawn } from 'child_process';

import { validateCommand } from '../security/command_filter.js';

const DEFAULT_TIMEOUT_MS = parseInt(process.env.COMMAND_TIMEOUT_MS || '30000', 10);
const MAX_TIMEOUT_MS = parseInt(process.env.MAX_COMMAND_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10);
const DEFAULT_MAX_OUTPUT_BYTES = parseInt(process.env.COMMAND_MAX_OUTPUT_BYTES || '262144', 10);

function appendChunk(buffer, chunk, maxBytes) {
    const current = Buffer.byteLength(buffer, 'utf8');
    const next = Buffer.byteLength(chunk, 'utf8');

    if (current >= maxBytes) {
        return { value: buffer, truncated: true };
    }

    if (current + next <= maxBytes) {
        return { value: buffer + chunk, truncated: false };
    }

    const remaining = maxBytes - current;
    return {
        value: buffer + Buffer.from(chunk).subarray(0, remaining).toString('utf8'),
        truncated: true,
    };
}

function clampTimeout(timeout) {
    const requested = Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT_MS;
    return Math.min(requested, MAX_TIMEOUT_MS);
}

function collectResult({
    success,
    command,
    cwd,
    stdout,
    stderr,
    exitCode,
    signal,
    durationMs,
    timedOut,
    stdoutTruncated,
    stderrTruncated,
}) {
    return {
        success,
        command,
        cwd,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        signal: signal || null,
        durationMs,
        timedOut,
        stdoutTruncated,
        stderrTruncated,
    };
}

export async function runProcess(file, args = [], options = {}) {
    const timeout = clampTimeout(options.timeout);
    const cwd = options.cwd || process.cwd();
    const env = { ...process.env, ...(options.env || {}) };
    const maxOutputBytes = Number.isFinite(options.maxOutputBytes)
        ? options.maxOutputBytes
        : DEFAULT_MAX_OUTPUT_BYTES;
    const startedAt = Date.now();

    return new Promise((resolve) => {
        let stdout = '';
        let stderr = '';
        let stdoutTruncated = false;
        let stderrTruncated = false;
        let settled = false;
        let timedOut = false;

        const child = spawn(file, args, {
            cwd,
            env,
            shell: Boolean(options.shell),
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 1000).unref();
        }, timeout);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk) => {
            const next = appendChunk(stdout, chunk, maxOutputBytes);
            stdout = next.value;
            stdoutTruncated = stdoutTruncated || next.truncated;
        });

        child.stderr.on('data', (chunk) => {
            const next = appendChunk(stderr, chunk, maxOutputBytes);
            stderr = next.value;
            stderrTruncated = stderrTruncated || next.truncated;
        });

        child.on('error', (error) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timer);
            resolve(collectResult({
                success: false,
                command: options.displayCommand || `${file} ${args.join(' ')}`.trim(),
                cwd,
                stdout,
                stderr: error.message,
                exitCode: null,
                signal: null,
                durationMs: Date.now() - startedAt,
                timedOut,
                stdoutTruncated,
                stderrTruncated,
            }));
        });

        child.on('close', (code, signal) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timer);
            resolve(collectResult({
                success: code === 0 && !timedOut,
                command: options.displayCommand || `${file} ${args.join(' ')}`.trim(),
                cwd,
                stdout,
                stderr,
                exitCode: code,
                signal,
                durationMs: Date.now() - startedAt,
                timedOut,
                stdoutTruncated,
                stderrTruncated,
            }));
        });
    });
}

export async function runCommand(command, options = {}) {
    validateCommand(command);
    return runProcess(command, [], {
        ...options,
        shell: true,
        displayCommand: command,
    });
}
