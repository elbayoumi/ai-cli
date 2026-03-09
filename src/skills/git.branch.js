import { gitBranch } from '../tools/git.js';

export default {
    name: 'git.branch',
    permissionLevel: 'write',
    description: 'Inspect or create git branches.',
    inputSchema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Optional branch name to create.' },
            checkout: { type: 'boolean', description: 'Create and switch to the branch.' },
        },
    },
    async handler({ name, checkout = false }) {
        return gitBranch({ name, checkout });
    },
};
