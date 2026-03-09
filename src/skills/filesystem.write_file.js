import { writeFile } from '../tools/filesystem.js';

export default {
    name: 'filesystem.write_file',
    permissionLevel: 'write',
    description: 'Create or overwrite a UTF-8 text file in the workspace.',
    inputSchema: {
        type: 'object',
        required: ['path', 'content'],
        properties: {
            path: { type: 'string', description: 'Path to the file to write.' },
            content: { type: 'string', description: 'Full file content.' },
        },
    },
    async handler({ path, content }) {
        return writeFile(path, content);
    },
};
