import { gitStatus } from '../tools/git.js';

export default {
    name: 'git.status',
    permissionLevel: 'read',
    description: 'Show git status for the current workspace.',
    inputSchema: {
        type: 'object',
        properties: {},
    },
    async handler() {
        return gitStatus();
    },
};
