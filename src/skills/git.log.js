import { gitLog } from '../tools/git.js';

export default {
    name: 'git.log',
    permissionLevel: 'read',
    description: 'Show recent git log entries.',
    inputSchema: {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Maximum number of log entries.' },
        },
    },
    async handler({ limit }) {
        return gitLog({ limit });
    },
};
