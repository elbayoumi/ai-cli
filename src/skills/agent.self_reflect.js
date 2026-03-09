import { createReflection } from '../core/self_reflection.js';

export default {
    name: 'agent.self_reflect',
    permissionLevel: 'read',
    description: 'Generate a structured post-task reflection.',
    inputSchema: {
        type: 'object',
        required: ['task'],
        properties: {
            task: { type: 'string', description: 'Task that was executed.' },
        },
    },
    async handler({ task, summary, success = true }, runtime = {}) {
        const reflection = createReflection({
            task,
            outcome: { success, summary },
            actions: runtime.actions || [],
        });

        if (runtime.engine?.recordReflection) {
            await runtime.engine.recordReflection(reflection);
        }

        return {
            success: true,
            reflection,
        };
    },
};
