function normalizeTask(task) {
    return String(task || '').trim().toLowerCase();
}

// ── Pattern matchers ────────────────────────────────────────────────────────

function isN8nInstallTask(task) {
    const normalized = normalizeTask(task);
    return (
        /\binstall\s+n8n\b/.test(normalized)
        || /\bsetup\s+n8n\b/.test(normalized)
        || /ثبت\s*n8n/.test(normalized)
        || /شغل\s*n8n/.test(normalized)
    );
}

function isListTask(task) {
    const normalized = normalizeTask(task);
    return (
        /^list(\s+files?)?$/.test(normalized)
        || /^ls\b/.test(normalized)
        || /^show\s+(files?|directory|dir|folder)/.test(normalized)
        || /^dir\b/.test(normalized)
    );
}

function isReadTask(task) {
    const normalized = normalizeTask(task);
    const match = normalized.match(/^(?:read|show|cat|view|display)\s+(.+)$/);
    return match ? match[1].trim() : null;
}

function isDiskTask(task) {
    const normalized = normalizeTask(task);
    return (
        /\bdisk\s*(?:usage|space|free)\b/.test(normalized)
        || /\bdf\b/.test(normalized)
        || /\bdu\b/.test(normalized)
        || /\bfree\s*space\b/.test(normalized)
    );
}

function isStatusTask(task) {
    const normalized = normalizeTask(task);
    return (
        /^(?:git\s+)?status$/.test(normalized)
        || /\bgit\s+status\b/.test(normalized)
    );
}

function isWhoamiTask(task) {
    const normalized = normalizeTask(task);
    return (
        /^whoami$/.test(normalized)
        || /^who\s+am\s+i$/.test(normalized)
        || /^hostname$/.test(normalized)
        || /^uname/.test(normalized)
        || /^system\s+info/.test(normalized)
    );
}

function isPwdTask(task) {
    const normalized = normalizeTask(task);
    return (
        /^pwd$/.test(normalized)
        || /^where\s+am\s+i$/.test(normalized)
        || /^current\s+(dir|directory|path|folder)/.test(normalized)
    );
}

// ── Fallback detection ──────────────────────────────────────────────────────

export function shouldUseOfflineFallback(error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) {
        return false;
    }

    return (
        message.includes('gemini_api_key is not set')
        || message.includes('api key not valid')
        || message.includes('api_key_invalid')
        || message.includes('too many requests')
        || message.includes('quota exceeded')
        || message.includes('rate limit')
        || message.includes('rate-limit')
        || message.includes('429')
    );
}

// ── Plan builders ───────────────────────────────────────────────────────────

function makePlan(description, steps) {
    return {
        action: 'plan',
        planType: 'execution_plan',
        description,
        steps,
        executionSteps: steps,
        executable: true,
        fallback: true,
    };
}

export function buildOfflineFallbackPlan(task) {
    // ── list files ──
    if (isListTask(task)) {
        return makePlan('List files in the current directory.', [
            { action: 'filesystem.list_files', path: '.', recursive: false },
        ]);
    }

    // ── read file ──
    const readTarget = isReadTask(task);
    if (readTarget) {
        return makePlan(`Read file: ${readTarget}`, [
            { action: 'filesystem.read_file', path: readTarget },
        ]);
    }

    // ── disk usage ──
    if (isDiskTask(task)) {
        return makePlan('Check disk usage.', [
            { action: 'terminal.run_command', command: 'df -h' },
        ]);
    }

    // ── git status ──
    if (isStatusTask(task)) {
        return makePlan('Check git status.', [
            { action: 'terminal.run_command', command: 'git status' },
        ]);
    }

    // ── whoami / system info ──
    if (isWhoamiTask(task)) {
        return makePlan('System information.', [
            { action: 'terminal.run_command', command: 'uname -a && whoami && hostname' },
        ]);
    }

    // ── pwd ──
    if (isPwdTask(task)) {
        return makePlan('Show current directory.', [
            { action: 'terminal.run_command', command: 'pwd' },
        ]);
    }

    // ── n8n install ──
    if (isN8nInstallTask(task)) {
        return makePlan('Install and start n8n locally without Gemini reasoning.', [
            {
                action: 'terminal.run_command',
                command: 'command -v n8n >/dev/null 2>&1 || npm install -g n8n',
            },
            {
                action: 'terminal.run_command',
                command: 'mkdir -p .ai && (lsof -iTCP:5678 -sTCP:LISTEN -n -P >/dev/null 2>&1 || nohup n8n start --port 5678 > .ai/n8n.log 2>&1 &)',
            },
            {
                action: 'terminal.run_command',
                command: 'lsof -iTCP:5678 -sTCP:LISTEN -n -P',
            },
        ]);
    }

    return null;
}
