const DEFAULT_HTTP_TIMEOUT_MS = parseInt(process.env.HTTP_TIMEOUT_MS || '10000', 10);
const DEFAULT_HTTP_MAX_RESPONSE_BYTES = parseInt(process.env.HTTP_MAX_RESPONSE_BYTES || '262144', 10);

function getAllowedDomains() {
    const raw = process.env.HTTP_ALLOWED_DOMAINS || 'api.github.com,localhost,127.0.0.1';
    return raw
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
}

function isDomainAllowed(hostname) {
    const domain = hostname.toLowerCase();
    return getAllowedDomains().some((allowed) => {
        if (allowed.startsWith('.')) {
            return domain.endsWith(allowed);
        }

        return domain === allowed;
    });
}

function normalizeHeaders(headers) {
    const normalized = {};
    for (const [key, value] of Object.entries(headers || {})) {
        if (typeof value === 'string') {
            normalized[key] = value;
        }
    }
    return normalized;
}

async function readResponseBody(response, maxBytes) {
    const reader = response.body?.getReader();
    if (!reader) {
        return { bodyText: '', truncated: false };
    }

    let total = 0;
    const chunks = [];
    let truncated = false;

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }

        total += value.byteLength;
        if (total > maxBytes) {
            const allowed = value.subarray(0, value.byteLength - (total - maxBytes));
            chunks.push(allowed);
            truncated = true;
            break;
        }

        chunks.push(value);
    }

    const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return {
        bodyText: merged.toString('utf8'),
        truncated,
    };
}

export async function httpRequest(options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
        throw new Error(`Unsupported HTTP method: ${method}`);
    }

    const url = new URL(options.url);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`Unsupported URL protocol: ${url.protocol}`);
    }

    if (!isDomainAllowed(url.hostname)) {
        throw new Error(`Domain is not allowlisted: ${url.hostname}`);
    }

    const controller = new AbortController();
    const timeout = Number.isFinite(options.timeout) ? options.timeout : DEFAULT_HTTP_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), timeout);
    const startedAt = Date.now();

    try {
        const requestHeaders = normalizeHeaders(options.headers);
        let body = options.body;

        if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
            if (!requestHeaders['content-type'] && !requestHeaders['Content-Type']) {
                requestHeaders['content-type'] = 'application/json';
            }
            body = JSON.stringify(body);
        }

        const response = await fetch(url, {
            method,
            headers: requestHeaders,
            body: method === 'GET' ? undefined : body,
            signal: controller.signal,
        });

        const { bodyText, truncated } = await readResponseBody(
            response,
            Number.isFinite(options.maxResponseBytes) ? options.maxResponseBytes : DEFAULT_HTTP_MAX_RESPONSE_BYTES
        );

        let parsedBody = null;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            try {
                parsedBody = JSON.parse(bodyText);
            } catch {
                parsedBody = null;
            }
        }

        return {
            success: response.ok,
            method,
            url: url.toString(),
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: parsedBody ?? bodyText,
            bodyText,
            truncated,
            durationMs: Date.now() - startedAt,
        };
    } catch (error) {
        return {
            success: false,
            method,
            url: url.toString(),
            status: null,
            statusText: null,
            headers: {},
            body: null,
            bodyText: '',
            truncated: false,
            durationMs: Date.now() - startedAt,
            error: error.name === 'AbortError' ? 'HTTP request timed out.' : error.message,
        };
    } finally {
        clearTimeout(timer);
    }
}
