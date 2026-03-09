import { listFiles } from '../tools/filesystem.js';

export default {
    name: 'filesystem.list_files',
    permissionLevel: 'read',
    description: 'List files and directories in the workspace.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Directory to inspect.' },
            recursive: { type: 'boolean', description: 'Whether to walk subdirectories.' },
            depth: { type: 'number', description: 'Maximum walk depth.' },
            includeHidden: { type: 'boolean', description: 'Whether hidden files should be included.' },
        },
    },
    async handler({ path = '.', recursive = false, depth, includeHidden = false }) {
        return listFiles(path, { recursive, depth, includeHidden });
    },
};
