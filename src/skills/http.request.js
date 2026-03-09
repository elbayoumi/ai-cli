import { httpRequest } from '../tools/http.js';

export default {
    name: 'http.request',
    permissionLevel: 'network',
    description: 'Perform an allowlisted HTTP request.',
    inputSchema: {
        type: 'object',
        required: ['method', 'url'],
        properties: {
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
            url: { type: 'string', description: 'Target URL.' },
            headers: { type: 'object', description: 'Request headers.' },
            timeout: { type: 'number', description: 'Request timeout in milliseconds.' },
        },
    },
    async handler({ method, url, headers, body, timeout }) {
        return httpRequest({ method, url, headers, body, timeout });
    },
};
