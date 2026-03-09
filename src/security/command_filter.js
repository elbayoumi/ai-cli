import path from 'path';

export class SecurityError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SecurityError';
    }
}

const BLOCKED_COMMAND_PATTERNS = [
    /\brm\s+-[^\n]*r[^\n]*f[^\n]*\s+\/(?:\s|$)/i,
    /\brm\s+-[^\n]*f[^\n]*r[^\n]*\s+\/(?:\s|$)/i,
    /\bshutdown\b/i,
    /\breboot\b/i,
    /\bpoweroff\b/i,
    /\bhalt\b/i,
    /\bmkfs(?:\.[a-z0-9_-]+)?\b/i,
    /\bdd\b[^\n]*(?:if|of)=\/dev\//i,
    /:\s*\(\s*\)\s*{/,
    /\bcurl\b[^\n]*\|\s*(?:bash|sh|zsh)\b/i,
    /\bwget\b[^\n]*\|\s*(?:bash|sh|zsh)\b/i,
];

const BLOCKED_SEGMENT_PATTERNS = [
    /^\s*shutdown(?:\s|$)/i,
    /^\s*reboot(?:\s|$)/i,
    /^\s*poweroff(?:\s|$)/i,
    /^\s*halt(?:\s|$)/i,
    /^\s*mkfs(?:\.[a-z0-9_-]+)?(?:\s|$)/i,
    /^\s*dd(?:\s|$)/i,
];

function splitSegments(command) {
    return command
        .split(/\|\||&&|;|\n|\|/g)
        .map((segment) => segment.trim())
        .filter(Boolean);
}

export function validateCommand(command) {
    if (typeof command !== 'string' || command.trim() === '') {
        throw new SecurityError('Command must be a non-empty string.');
    }

    const trimmed = command.trim();

    for (const pattern of BLOCKED_COMMAND_PATTERNS) {
        if (pattern.test(trimmed)) {
            throw new SecurityError(`Blocked dangerous command: ${trimmed}`);
        }
    }

    for (const segment of splitSegments(trimmed)) {
        for (const pattern of BLOCKED_SEGMENT_PATTERNS) {
            if (pattern.test(segment)) {
                throw new SecurityError(`Blocked dangerous command segment: ${segment}`);
            }
        }
    }

    return true;
}

export function resolveWorkspaceRoot(workDir = process.env.AGENT_WORK_DIR || process.cwd()) {
    return path.resolve(workDir);
}

export function validatePath(targetPath, workDir = resolveWorkspaceRoot()) {
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
        throw new SecurityError('Path must be a non-empty string.');
    }

    const base = resolveWorkspaceRoot(workDir);
    const resolved = path.resolve(base, targetPath);
    const relative = path.relative(base, resolved);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new SecurityError(`Path is outside the workspace root: ${targetPath}`);
    }

    return resolved;
}
