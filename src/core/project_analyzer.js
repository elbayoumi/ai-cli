import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

import { getWorkspaceRoot } from '../tools/filesystem.js';
import { gitBranch, gitStatus } from '../tools/git.js';

async function exists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function readJson(targetPath) {
    try {
        return JSON.parse(await fs.readFile(targetPath, 'utf8'));
    } catch {
        return null;
    }
}

async function readText(targetPath) {
    try {
        return await fs.readFile(targetPath, 'utf8');
    } catch {
        return '';
    }
}

function uniq(values) {
    return [...new Set(values.filter(Boolean))];
}

async function analyzeNodeProject(workDir) {
    const packageJsonPath = path.join(workDir, 'package.json');
    if (!await exists(packageJsonPath)) {
        return null;
    }

    const packageJson = await readJson(packageJsonPath);
    if (!packageJson) {
        return {
            type: 'nodejs',
            language: 'javascript',
            frameworks: [],
            buildSystems: [],
            packageName: null,
        };
    }

    const dependencies = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
    };
    const frameworks = [];
    const buildSystems = [];

    if (dependencies.next) frameworks.push('Next.js');
    if (dependencies.express) frameworks.push('Express');
    if (dependencies['@nestjs/core']) frameworks.push('NestJS');
    if (dependencies.fastify) frameworks.push('Fastify');
    if (dependencies.react) frameworks.push('React');
    if (dependencies.vue) frameworks.push('Vue');
    if (dependencies.svelte) frameworks.push('Svelte');

    if (dependencies.vite || packageJson.scripts?.dev?.includes('vite')) buildSystems.push('Vite');
    if (dependencies.webpack) buildSystems.push('Webpack');
    if (packageJson.scripts?.build) buildSystems.push('npm scripts');
    if (await exists(path.join(workDir, 'turbo.json'))) buildSystems.push('Turborepo');

    return {
        type: 'nodejs',
        language: (dependencies.typescript || await exists(path.join(workDir, 'tsconfig.json')))
            ? 'typescript'
            : 'javascript',
        frameworks,
        buildSystems,
        packageName: packageJson.name || null,
    };
}

async function analyzePythonProject(workDir) {
    const hasMarker = await Promise.all([
        exists(path.join(workDir, 'pyproject.toml')),
        exists(path.join(workDir, 'requirements.txt')),
        exists(path.join(workDir, 'Pipfile')),
        exists(path.join(workDir, 'setup.py')),
    ]);

    if (!hasMarker.some(Boolean)) {
        return null;
    }

    const pyproject = await readText(path.join(workDir, 'pyproject.toml'));
    const requirements = await readText(path.join(workDir, 'requirements.txt'));
    const combined = `${pyproject}\n${requirements}`.toLowerCase();
    const frameworks = [];

    if (combined.includes('fastapi')) frameworks.push('FastAPI');
    if (combined.includes('django')) frameworks.push('Django');
    if (combined.includes('flask')) frameworks.push('Flask');

    return {
        type: 'python',
        language: 'python',
        frameworks,
        buildSystems: uniq([
            pyproject ? 'pyproject' : null,
            requirements ? 'pip' : null,
        ]),
        packageName: null,
    };
}

async function analyzePhpProject(workDir) {
    const composerPath = path.join(workDir, 'composer.json');
    const artisanPath = path.join(workDir, 'artisan');
    if (!await exists(composerPath) && !await exists(artisanPath)) {
        return null;
    }

    const composerJson = await readJson(composerPath);
    const requires = {
        ...(composerJson?.require || {}),
        ...(composerJson?.['require-dev'] || {}),
    };
    const isLaravel = Boolean(requires['laravel/framework']) || await exists(artisanPath);

    return {
        type: isLaravel ? 'laravel' : 'php',
        language: 'php',
        frameworks: isLaravel ? ['Laravel'] : [],
        buildSystems: ['composer'],
        packageName: composerJson?.name || null,
    };
}

async function analyzeGoProject(workDir) {
    const goModPath = path.join(workDir, 'go.mod');
    if (!await exists(goModPath)) {
        return null;
    }

    const content = await readText(goModPath);
    const frameworks = [];
    if (content.includes('gin-gonic')) frameworks.push('Gin');
    if (content.includes('fiber')) frameworks.push('Fiber');

    return {
        type: 'go',
        language: 'go',
        frameworks,
        buildSystems: ['go modules'],
        packageName: null,
    };
}

async function analyzeDockerSupport(workDir) {
    const dockerfile = await exists(path.join(workDir, 'Dockerfile'));
    const compose = await exists(path.join(workDir, 'docker-compose.yml'))
        || await exists(path.join(workDir, 'docker-compose.yaml'))
        || await exists(path.join(workDir, 'compose.yml'))
        || await exists(path.join(workDir, 'compose.yaml'));

    return {
        hasDocker: dockerfile || compose,
        buildSystems: uniq([
            dockerfile ? 'Dockerfile' : null,
            compose ? 'Docker Compose' : null,
        ]),
    };
}

async function analyzeGit(workDir) {
    const status = await gitStatus({ cwd: workDir });
    if (!status.success) {
        return {
            isRepository: false,
            clean: null,
            branch: null,
            summary: status.stderr || 'Not a git repository.',
        };
    }

    const branch = await gitBranch({ cwd: workDir });
    const lines = status.stdout.split('\n').filter(Boolean);
    const changes = lines.filter((line) => !line.startsWith('##'));

    return {
        isRepository: true,
        clean: changes.length === 0,
        branch: branch.currentBranch || null,
        summary: status.stdout,
    };
}

function detectPackageManager(root) {
    const candidates = [
        ['pnpm-lock.yaml', 'pnpm'],
        ['yarn.lock', 'yarn'],
        ['bun.lockb', 'bun'],
        ['bun.lock', 'bun'],
        ['package-lock.json', 'npm'],
        ['poetry.lock', 'poetry'],
        ['Pipfile.lock', 'pipenv'],
        ['composer.lock', 'composer'],
        ['go.mod', 'go'],
    ];

    for (const [filename, manager] of candidates) {
        if (existsSync(path.join(root, filename))) {
            return manager;
        }
    }

    return null;
}

export async function analyzeWorkspace(workDir = getWorkspaceRoot()) {
    const root = getWorkspaceRoot(workDir);
    const node = await analyzeNodeProject(root);
    const python = await analyzePythonProject(root);
    const php = await analyzePhpProject(root);
    const go = await analyzeGoProject(root);
    const docker = await analyzeDockerSupport(root);
    const git = await analyzeGit(root);

    const primary = node || python || php || go || {
        type: docker.hasDocker ? 'docker' : 'unknown',
        language: 'unknown',
        frameworks: [],
        buildSystems: [],
        packageName: null,
    };

    return {
        root,
        type: primary.type,
        language: primary.language,
        framework: primary.frameworks?.[0] || null,
        frameworks: uniq(primary.frameworks || []),
        packageManager: detectPackageManager(root),
        dependencyManagers: uniq([
            node ? 'npm ecosystem' : null,
            python ? 'python packaging' : null,
            php ? 'composer' : null,
            go ? 'go modules' : null,
        ]),
        buildSystems: uniq([
            ...(primary.buildSystems || []),
            ...(docker.buildSystems || []),
        ]),
        hasDocker: docker.hasDocker,
        packageName: primary.packageName || null,
        git,
        analyzedAt: new Date().toISOString(),
    };
}
