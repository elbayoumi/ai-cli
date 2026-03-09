function normalizeTask(task) {
    return String(task || '').trim().toLowerCase();
}

function isN8nInstallTask(task) {
    const normalized = normalizeTask(task);
    return (
        /\binstall\s+n8n\b/.test(normalized)
        || /\bsetup\s+n8n\b/.test(normalized)
        || /ثبت\s*n8n/.test(normalized)
        || /شغل\s*n8n/.test(normalized)
    );
}

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

export function buildOfflineFallbackPlan(task) {
    if (isN8nInstallTask(task)) {
        return {
            action: 'plan',
            planType: 'execution_plan',
            description: 'Install and start n8n locally without Gemini reasoning.',
            steps: [
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
            ],
            executionSteps: [
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
            ],
            executable: true,
            fallback: true,
        };
    }

    return null;
}
