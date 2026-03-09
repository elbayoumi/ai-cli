import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { logger } from '../utils/logger.js';

const BUILTIN_SKILLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SUPPORTED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const SKIP_FILES = new Set(['index.js', 'registry.js']);
const PERMISSION_LEVELS = new Set(['read', 'write', 'network', 'system', 'dangerous']);

function isSkillObject(candidate) {
    return Boolean(
        candidate &&
        typeof candidate === 'object' &&
        typeof candidate.name === 'string' &&
        typeof candidate.handler === 'function'
    );
}

async function pathExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function discoverModuleFiles(directory, origin) {
    if (!await pathExists(directory)) {
        return [];
    }

    const dirents = await fs.readdir(directory, { withFileTypes: true });
    const moduleFiles = [];

    for (const dirent of dirents) {
        const fullPath = path.join(directory, dirent.name);

        if (dirent.isFile()) {
            const extension = path.extname(dirent.name);
            if (SUPPORTED_EXTENSIONS.has(extension) && !SKIP_FILES.has(dirent.name)) {
                moduleFiles.push({
                    origin,
                    modulePath: fullPath,
                    moduleName: dirent.name,
                });
            }
            continue;
        }

        if (!dirent.isDirectory()) {
            continue;
        }

        const packageJsonPath = path.join(fullPath, 'package.json');
        if (await pathExists(packageJsonPath)) {
            try {
                const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
                if (packageJson.main) {
                    moduleFiles.push({
                        origin,
                        modulePath: path.resolve(fullPath, packageJson.main),
                        moduleName: dirent.name,
                    });
                    continue;
                }
            } catch {
                // Ignore invalid plugin metadata and continue to conventional entrypoints.
            }
        }

        for (const entrypoint of ['index.js', 'index.mjs', 'skill.js', 'skill.mjs']) {
            const entrypointPath = path.join(fullPath, entrypoint);
            if (await pathExists(entrypointPath)) {
                moduleFiles.push({
                    origin,
                    modulePath: entrypointPath,
                    moduleName: dirent.name,
                });
                break;
            }
        }
    }

    return moduleFiles;
}

function normalizeModuleExports(mod) {
    const candidates = [];

    if (Array.isArray(mod?.skills)) {
        candidates.push(...mod.skills);
    }

    if (mod?.default?.skills && Array.isArray(mod.default.skills)) {
        candidates.push(...mod.default.skills);
    }

    if (mod?.default?.skill) {
        candidates.push(mod.default.skill);
    }

    if (Array.isArray(mod?.default)) {
        candidates.push(...mod.default);
    } else if (isSkillObject(mod?.default)) {
        candidates.push(mod.default);
    }

    if (mod?.skill) {
        candidates.push(mod.skill);
    }

    return candidates.filter(isSkillObject);
}

function normalizeSkill(skill, moduleInfo) {
    const permissionLevel = PERMISSION_LEVELS.has(skill.permissionLevel)
        ? skill.permissionLevel
        : 'system';

    return {
        permissionLevel,
        inputSchema: skill.inputSchema || { type: 'object', properties: {} },
        description: skill.description || '',
        ...skill,
        permissionLevel,
        source: moduleInfo.modulePath,
        sourceType: moduleInfo.origin,
        moduleName: moduleInfo.moduleName,
    };
}

export function requiresExplicitConfirmation(permissionLevel) {
    return permissionLevel === 'system' || permissionLevel === 'dangerous';
}

export class SkillRegistry {
    constructor(options = {}) {
        this.cwd = path.resolve(options.cwd || process.cwd());
        this.builtinDir = options.builtinDir || BUILTIN_SKILLS_DIR;
        this.externalDirs = options.externalDirs || [
            path.join(this.cwd, 'skills'),
            path.join(this.cwd, 'plugins'),
        ];
        this.loaded = false;
        this.skills = new Map();
        this.loadErrors = [];
        this.moduleStatuses = [];
    }

    async load(options = {}) {
        if (this.loaded && !options.force) {
            return this;
        }

        this.skills.clear();
        this.loadErrors = [];
        this.moduleStatuses = [];

        const moduleFiles = [
            ...(await discoverModuleFiles(this.builtinDir, 'builtin')),
            ...(await discoverModuleFiles(this.externalDirs[0], 'skill')),
            ...(await discoverModuleFiles(this.externalDirs[1], 'plugin')),
        ];

        for (const moduleInfo of moduleFiles) {
            try {
                const mod = await import(pathToFileURL(moduleInfo.modulePath).href);
                const skillExports = normalizeModuleExports(mod);

                if (skillExports.length === 0) {
                    const error = {
                        modulePath: moduleInfo.modulePath,
                        message: 'Module did not export any valid skills.',
                    };
                    this.loadErrors.push(error);
                    this.moduleStatuses.push({
                        ...moduleInfo,
                        status: 'invalid',
                        skillNames: [],
                        error: error.message,
                    });
                    continue;
                }

                const skillNames = [];
                for (const rawSkill of skillExports) {
                    const skill = normalizeSkill(rawSkill, moduleInfo);
                    if (this.skills.has(skill.name)) {
                        logger.warn(`Duplicate skill "${skill.name}" from ${moduleInfo.modulePath}; overriding previous definition.`);
                    }

                    this.skills.set(skill.name, skill);
                    skillNames.push(skill.name);
                }

                this.moduleStatuses.push({
                    ...moduleInfo,
                    status: 'loaded',
                    skillNames,
                });
            } catch (error) {
                const failure = {
                    modulePath: moduleInfo.modulePath,
                    message: error.message,
                };
                this.loadErrors.push(failure);
                this.moduleStatuses.push({
                    ...moduleInfo,
                    status: 'error',
                    skillNames: [],
                    error: error.message,
                });
                logger.warn(`Failed to load skill module ${moduleInfo.modulePath}: ${error.message}`);
            }
        }

        this.loaded = true;
        return this;
    }

    async getSkill(name) {
        await this.load();
        return this.skills.get(name);
    }

    async listSkills() {
        await this.load();
        return [...this.skills.values()].sort((left, right) => left.name.localeCompare(right.name));
    }

    async getSkillNames() {
        const skills = await this.listSkills();
        return new Set(skills.map((skill) => skill.name));
    }

    getLoadErrors() {
        return [...this.loadErrors];
    }

    getModuleStatuses() {
        return [...this.moduleStatuses];
    }

    async listPlugins() {
        await this.load();
        return this.moduleStatuses.filter((entry) => entry.origin !== 'builtin');
    }
}

let defaultRegistry = null;

export function getDefaultRegistry(options = {}) {
    if (!defaultRegistry || options.cwd) {
        defaultRegistry = new SkillRegistry(options);
    }

    return defaultRegistry;
}

export async function getSkill(name) {
    return getDefaultRegistry().getSkill(name);
}

export async function listSkills() {
    return getDefaultRegistry().listSkills();
}
