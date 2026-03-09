import { editFile } from '../tools/filesystem.js';

export default {
    name: 'filesystem.edit_file',
    permissionLevel: 'write',
    description: 'Apply structured edits such as append, prepend, replace_block, and insert_after.',
    inputSchema: {
        type: 'object',
        required: ['path', 'operation'],
        properties: {
            path: { type: 'string', description: 'File to update.' },
            operation: {
                type: 'string',
                enum: ['append', 'prepend', 'replace_block', 'insert_after', 'insert_before'],
            },
            target: { type: 'string', description: 'Target text used by replace_block and insert operations.' },
            replacement: { type: 'string', description: 'Replacement text for replace_block.' },
            content: { type: 'string', description: 'Content used by append, prepend, and insert operations.' },
        },
    },
    async handler({ path, operation, target, replacement, content }) {
        return editFile(path, operation, { target, replacement, content });
    },
};
