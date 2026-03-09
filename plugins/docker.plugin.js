import { runProcess } from '../src/tools/terminal.js';

export default {
    skills: [
        {
            name: 'docker.run_container',
            permissionLevel: 'system',
            description: 'Run a Docker container with a minimal safe argument set.',
            inputSchema: {
                type: 'object',
                required: ['image'],
                properties: {
                    image: { type: 'string', description: 'Container image to run.' },
                    name: { type: 'string', description: 'Optional container name.' },
                    detach: { type: 'boolean', description: 'Run the container in detached mode.' },
                    publish: { type: 'string', description: 'Port mapping in HOST:CONTAINER format.' },
                },
            },
            async handler({ image, name, detach = true, publish }) {
                const args = ['run'];

                if (detach) {
                    args.push('-d');
                }
                if (name) {
                    args.push('--name', name);
                }
                if (publish) {
                    args.push('-p', publish);
                }

                args.push(image);

                return runProcess('docker', args, {
                    displayCommand: `docker ${args.join(' ')}`,
                });
            },
        },
    ],
};
