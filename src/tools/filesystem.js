import fs from 'fs/promises';
import path from 'path';

import { resolveWorkspaceRoot, validatePath } from '../security/command_filter.js';

const DEFAULT_LIST_DEPTH = 1;
const MAX_FILE_EDIT_BYTES = parseInt(process.env.MAX_FILE_EDIT_BYTES || '524288', 10);
const MAX_FILE_READ_BYTES = parseInt(process.env.MAX_FILE_READ_BYTES || '524288', 10);

function ensureWithinLimit(bytes, label) {
    if (bytes > MAX_FILE_EDIT_BYTES) {
        throw new Error(`${label} exceeds the maximum allowed edit size of ${MAX_FILE_EDIT_BYTES} bytes.`);
    }
}

export function getWorkspaceRoot(workDir = process.env.AGENT_WORK_DIR || process.cwd()) {
    return resolveWorkspaceRoot(workDir);
}

export function resolvePath(targetPath, workDir = getWorkspaceRoot()) {
    return validatePath(targetPath, workDir);
}

export async function readFile(filePath, options = {}) {
    const resolved = resolvePath(filePath, options.workDir);
    const stat = await fs.stat(resolved);
    if (stat.size > MAX_FILE_READ_BYTES) {
        throw new Error(`File exceeds the maximum readable size of ${MAX_FILE_READ_BYTES} bytes.`);
    }

    const content = await fs.readFile(resolved, options.encoding || 'utf8');

    return {
        success: true,
        path: resolved,
        content,
        bytes: Buffer.byteLength(content, options.encoding || 'utf8'),
    };
}

export async function writeFile(filePath, content, options = {}) {
    const resolved = resolvePath(filePath, options.workDir);
    const size = Buffer.byteLength(content, options.encoding || 'utf8');
    ensureWithinLimit(size, 'Write content');

    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, options.encoding || 'utf8');

    return {
        success: true,
        path: resolved,
        bytes: size,
    };
}

async function statEntry(fullPath, relativePath, dirent) {
    const stat = await fs.stat(fullPath);

    return {
        path: relativePath,
        name: path.basename(relativePath),
        type: dirent.isDirectory() ? 'directory' : (dirent.isSymbolicLink() ? 'symlink' : 'file'),
        size: dirent.isFile() ? stat.size : null,
    };
}

async function walkDirectory(root, current, depth, maxDepth, includeHidden, entries) {
    if (depth > maxDepth) {
        return;
    }

    const dirents = await fs.readdir(current, { withFileTypes: true });
    for (const dirent of dirents) {
        if (!includeHidden && dirent.name.startsWith('.')) {
            continue;
        }

        const fullPath = path.join(current, dirent.name);
        const relativePath = path.relative(root, fullPath) || '.';
        entries.push(await statEntry(fullPath, relativePath, dirent));

        if (dirent.isDirectory() && depth < maxDepth) {
            await walkDirectory(root, fullPath, depth + 1, maxDepth, includeHidden, entries);
        }
    }
}

export async function listFiles(dirPath = '.', options = {}) {
    const resolved = resolvePath(dirPath, options.workDir);
    const recursive = Boolean(options.recursive);
    const depth = recursive
        ? (Number.isFinite(options.depth) ? options.depth : 4)
        : (Number.isFinite(options.depth) ? options.depth : DEFAULT_LIST_DEPTH);
    const entries = [];

    await walkDirectory(
        resolved,
        resolved,
        1,
        Math.max(1, depth),
        Boolean(options.includeHidden),
        entries
    );

    entries.sort((left, right) => {
        if (left.type !== right.type) {
            return left.type === 'directory' ? -1 : 1;
        }

        return left.path.localeCompare(right.path);
    });

    return {
        success: true,
        path: resolved,
        entries,
    };
}

function assertString(value, name) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} must be a non-empty string.`);
    }
}

export async function editFile(filePath, operation, params = {}, options = {}) {
    const resolved = resolvePath(filePath, options.workDir);
    const current = await fs.readFile(resolved, 'utf8');
    ensureWithinLimit(Buffer.byteLength(current, 'utf8'), 'Existing file');

    const normalizedOperation = operation === 'replace' ? 'replace_block' : operation;
    let next = current;

    switch (normalizedOperation) {
        case 'append':
            assertString(params.content, 'content');
            next = current + params.content;
            break;
        case 'prepend':
            assertString(params.content, 'content');
            next = params.content + current;
            break;
        case 'replace_block':
            assertString(params.target, 'target');
            if (typeof params.replacement !== 'string') {
                throw new Error('replacement must be a string.');
            }
            if (!current.includes(params.target)) {
                throw new Error(`Target block was not found in ${filePath}.`);
            }
            next = current.replace(params.target, params.replacement);
            break;
        case 'insert_after': {
            assertString(params.target, 'target');
            assertString(params.content, 'content');
            const index = current.indexOf(params.target);
            if (index === -1) {
                throw new Error(`Target block was not found in ${filePath}.`);
            }
            const insertAt = index + params.target.length;
            next = current.slice(0, insertAt) + params.content + current.slice(insertAt);
            break;
        }
        case 'insert_before': {
            assertString(params.target, 'target');
            assertString(params.content, 'content');
            const index = current.indexOf(params.target);
            if (index === -1) {
                throw new Error(`Target block was not found in ${filePath}.`);
            }
            next = current.slice(0, index) + params.content + current.slice(index);
            break;
        }
        default:
            throw new Error(`Unsupported edit operation: ${operation}`);
    }

    const size = Buffer.byteLength(next, 'utf8');
    ensureWithinLimit(size, 'Edited file');
    await fs.writeFile(resolved, next, 'utf8');

    return {
        success: true,
        path: resolved,
        operation: normalizedOperation,
        changed: next !== current,
        bytes: size,
    };
}
