import chalk from 'chalk';

function sanitizeContext(value) {
    const next = {};

    for (const [key, entry] of Object.entries(value || {})) {
        if (entry !== undefined && entry !== null && entry !== '') {
            next[key] = entry;
        }
    }

    return next;
}

function stringify(value) {
    if (typeof value === 'string') {
        return value;
    }

    return JSON.stringify(value, null, 2);
}

let currentContext = {};

function emit(level, prefix, color, args, method = console.log) {
    const timestamp = new Date().toISOString();

    if (process.env.DEBUG === 'true') {
        const [first, ...rest] = args;
        const entry = {
            timestamp,
            level,
            execution_id: currentContext.execution_id,
            task_id: currentContext.task_id,
            action_id: currentContext.action_id,
            message: first == null ? '' : stringify(first),
        };

        if (rest.length > 0) {
            entry.data = rest;
        }

        method(JSON.stringify(entry));
        return;
    }

    method(color(prefix), ...args.map(stringify));
}

export const logger = {
    setContext(patch = {}) {
        currentContext = {
            ...currentContext,
            ...sanitizeContext(patch),
        };
        return { ...currentContext };
    },
    resetContext() {
        currentContext = {};
    },
    clearContext(keys = []) {
        const next = { ...currentContext };
        for (const key of keys) {
            delete next[key];
        }
        currentContext = next;
        return { ...currentContext };
    },
    getContext() {
        return { ...currentContext };
    },
    async withContext(patch, fn) {
        const previous = { ...currentContext };
        currentContext = {
            ...currentContext,
            ...sanitizeContext(patch),
        };

        try {
            return await fn();
        } finally {
            currentContext = previous;
        }
    },
    info: (...args) => emit('info', '[info]', chalk.blue, args),
    success: (...args) => emit('success', '[ok]', chalk.green, args),
    warn: (...args) => emit('warn', '[warn]', chalk.yellow, args, console.warn),
    error: (...args) => emit('error', '[error]', chalk.red, args, console.error),
    action: (...args) => emit('action', '[action]', chalk.magenta, args),
    plan: (...args) => emit('plan', '[plan]', chalk.cyan, args),
    ai: (...args) => emit('ai', '[ai]', chalk.hex('#7c3aed'), args),
    debug: (...args) => {
        if (process.env.DEBUG === 'true') {
            emit('debug', '[debug]', chalk.gray, args);
        }
    },
    raw: (...args) => {
        if (process.env.DEBUG === 'true') {
            emit('raw', '[raw]', chalk.gray, args);
            return;
        }

        console.log(...args);
    },
    divider: (label = '') => {
        if (process.env.DEBUG === 'true') {
            emit('divider', '[divider]', chalk.gray, [label || '--------------------------------']);
            return;
        }

        const line = '-'.repeat(72);
        if (!label) {
            console.log(chalk.gray(line));
            return;
        }

        const prefix = `--- ${label} `;
        console.log(chalk.gray(prefix + '-'.repeat(Math.max(0, 72 - prefix.length))));
    },
    box: (title, content) => {
        if (process.env.DEBUG === 'true') {
            emit('box', '[box]', chalk.gray, [title, content]);
            return;
        }

        const rows = String(content ?? '').split('\n');
        const width = Math.min(
            100,
            Math.max(title.length + 4, ...rows.map((row) => row.length + 4), 24)
        );
        const top = '+' + '-'.repeat(width - 2) + '+';

        console.log(chalk.gray(top));
        console.log(chalk.gray('| ') + chalk.bold(title.padEnd(width - 4)) + chalk.gray(' |'));
        console.log(chalk.gray('|' + '-'.repeat(width - 2) + '|'));
        for (const row of rows) {
            console.log(chalk.gray('| ') + row.slice(0, width - 4).padEnd(width - 4) + chalk.gray(' |'));
        }
        console.log(chalk.gray(top));
    },
};
