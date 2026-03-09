import { readFile } from '../tools/filesystem.js';

export default {
    name: 'filesystem.read_file',
    permissionLevel: 'read',
    description: 'Read a UTF-8 text file from the workspace.',
    inputSchema: {
        type: 'object',
        required: ['path'],
        properties: {
            path: { type: 'string', description: 'Path to the file to read.' },
        },
    },
    async handler({ path }) {
        return readFile(path);
    },
};
