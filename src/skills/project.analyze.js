import { analyzeWorkspace } from '../core/project_analyzer.js';

export default {
    name: 'project.analyze',
    permissionLevel: 'read',
    description: 'Analyze the current workspace and identify project characteristics.',
    inputSchema: {
        type: 'object',
        properties: {},
    },
    async handler(_input, runtime = {}) {
        const analysis = await analyzeWorkspace(runtime.workDir || process.cwd());
        if (runtime.engine?.updateProjectAnalysis) {
            await runtime.engine.updateProjectAnalysis(analysis);
        }
        return {
            success: true,
            analysis,
        };
    },
};
