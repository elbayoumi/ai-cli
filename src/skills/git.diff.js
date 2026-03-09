import { gitDiff } from '../tools/git.js';

export default {
    name: 'git.diff',
    permissionLevel: 'read',
    description: 'Show git diff output.',
    inputSchema: {
        type: 'object',
        properties: {
            staged: { type: 'boolean', description: 'Show staged diff.' },
            path: { type: 'string', description: 'Optional path filter.' },
        },
    },
    async handler({ staged = false, path }) {
        return gitDiff({ staged, path });
    },
};
