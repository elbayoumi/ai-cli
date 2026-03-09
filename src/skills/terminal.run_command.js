import { runCommand } from '../tools/terminal.js';

export default {
    name: 'terminal.run_command',
    permissionLevel: 'system',
    description: 'Execute a shell command with timeout and output capture.',
    inputSchema: {
        type: 'object',
        required: ['command'],
        properties: {
            command: { type: 'string', description: 'Shell command to execute.' },
            cwd: { type: 'string', description: 'Optional working directory for the command.' },
            timeout: { type: 'number', description: 'Timeout in milliseconds.' },
        },
    },
    async handler({ command, cwd, timeout }) {
        return runCommand(command, { cwd, timeout });
    },
};
