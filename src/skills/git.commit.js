import { gitCommit } from '../tools/git.js';

export default {
    name: 'git.commit',
    permissionLevel: 'write',
    description: 'Create a git commit.',
    inputSchema: {
        type: 'object',
        required: ['message'],
        properties: {
            message: { type: 'string', description: 'Commit message.' },
            all: { type: 'boolean', description: 'Commit tracked changes automatically.' },
        },
    },
    async handler({ message, all = false }) {
        return gitCommit({ message, all });
    },
};
