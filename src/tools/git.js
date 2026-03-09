import { getWorkspaceRoot } from './filesystem.js';
import { runProcess } from './terminal.js';

const DEFAULT_GIT_TIMEOUT_MS = parseInt(process.env.GIT_TIMEOUT_MS || '15000', 10);

async function runGit(args, options = {}) {
    const cwd = options.cwd || getWorkspaceRoot();
    const result = await runProcess('git', args, {
        cwd,
        timeout: options.timeout || DEFAULT_GIT_TIMEOUT_MS,
        displayCommand: `git ${args.join(' ')}`,
    });

    return result;
}

export async function gitStatus(options = {}) {
    const result = await runGit(['status', '--short', '--branch'], options);
    return {
        ...result,
        summary: result.stdout,
    };
}

export async function gitDiff(options = {}) {
    const args = ['diff'];
    if (options.staged) {
        args.push('--staged');
    }
    if (options.path) {
        args.push('--', options.path);
    }

    const result = await runGit(args, options);
    return {
        ...result,
        diff: result.stdout,
    };
}

export async function gitCommit(options = {}) {
    if (typeof options.message !== 'string' || options.message.trim() === '') {
        throw new Error('Commit message is required.');
    }

    const args = ['commit', '-m', options.message.trim()];
    if (options.all) {
        args.push('--all');
    }

    return runGit(args, options);
}

export async function gitBranch(options = {}) {
    if (options.name) {
        const args = options.checkout
            ? ['switch', '-c', options.name]
            : ['branch', options.name];
        return runGit(args, options);
    }

    const current = await runGit(['branch', '--show-current'], options);
    const list = await runGit(['branch', '--list'], options);

    return {
        success: current.success && list.success,
        command: 'git branch',
        cwd: options.cwd || getWorkspaceRoot(),
        stdout: list.stdout,
        stderr: [current.stderr, list.stderr].filter(Boolean).join('\n').trim(),
        exitCode: current.success && list.success ? 0 : (current.exitCode || list.exitCode),
        currentBranch: current.stdout.trim() || null,
        branches: list.stdout
            .split('\n')
            .map((line) => line.replace(/^\*\s*/, '').trim())
            .filter(Boolean),
        durationMs: (current.durationMs || 0) + (list.durationMs || 0),
    };
}

export async function gitLog(options = {}) {
    const limit = Number.isFinite(options.limit) ? options.limit : 10;
    const result = await runGit(['log', `-n${limit}`, '--oneline', '--decorate'], options);
    return {
        ...result,
        entries: result.stdout.split('\n').filter(Boolean),
    };
}
