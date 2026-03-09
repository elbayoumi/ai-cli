import 'dotenv/config';

import { program } from 'commander';
import os from 'os';
import { createInterface } from 'readline';

import { runDoctor } from '../core/doctor.js';
import { AgentEngine } from '../core/engine.js';
import { displayMetrics, getMetricsSnapshot } from '../core/metrics.js';
import * as memory from '../memory/context_store.js';
import { getDefaultRegistry } from '../skills/registry.js';
import { logger } from '../utils/logger.js';

function buildRuntimeContext() {
    return {
        cwd: process.cwd(),
        home: os.homedir(),
        shell: process.env.SHELL || 'unknown',
    };
}

function printBanner() {
    logger.raw('AI CLI Agent');
    logger.raw(`Model: ${process.env.GEMINI_MODEL || 'gemini-2.0-flash'}`);
    logger.raw('');
}

async function createEngine() {
    const engine = new AgentEngine({
        workDir: process.env.AGENT_WORK_DIR || process.cwd(),
        runtimeContext: buildRuntimeContext(),
    });
    await engine.initialize();
    return engine;
}

async function printSkills() {
    const registry = getDefaultRegistry({ cwd: process.env.AGENT_WORK_DIR || process.cwd() });
    const skills = await registry.listSkills();

    logger.divider('SKILLS');
    for (const skill of skills) {
        logger.raw(`- ${skill.name} [${skill.permissionLevel}]: ${skill.description}`);
    }
    logger.divider();
}

async function printPlugins() {
    const registry = getDefaultRegistry({ cwd: process.env.AGENT_WORK_DIR || process.cwd() });
    await registry.load({ force: true });
    const plugins = await registry.listPlugins();

    logger.divider('PLUGINS');
    if (plugins.length === 0) {
        logger.info('No external skills or plugins discovered.');
    }

    for (const plugin of plugins) {
        logger.raw(`- ${plugin.moduleName} [${plugin.origin}] ${plugin.status}`);
        if (plugin.skillNames.length > 0) {
            logger.raw(`  skills: ${plugin.skillNames.join(', ')}`);
        }
        if (plugin.error) {
            logger.raw(`  error: ${plugin.error}`);
        }
    }
    logger.divider();
}

async function handleMemoryCommand(options) {
    const workDir = process.env.AGENT_WORK_DIR || process.cwd();

    if (options.clear) {
        await memory.clear(workDir);
        logger.success('Memory cleared.');
        return;
    }

    const context = await memory.load(workDir);

    if (options.scan) {
        await memory.scanProject(context, { workDir });
        await memory.save(context, workDir);
    }

    memory.displayContext(context);
}

async function handleAnalyzeCommand(options = {}) {
    const engine = await createEngine();
    await engine.executeAction(
        { action: 'project.analyze' },
        { unsafe: Boolean(options.unsafe), autoRun: true }
    );
}

async function handleMetricsCommand() {
    const context = await memory.load(process.env.AGENT_WORK_DIR || process.cwd());
    displayMetrics(getMetricsSnapshot(context));
}

async function handleDoctorCommand() {
    const registry = getDefaultRegistry({ cwd: process.env.AGENT_WORK_DIR || process.cwd() });
    const report = await runDoctor({
        workDir: process.env.AGENT_WORK_DIR || process.cwd(),
        registry,
    });

    logger.divider('DOCTOR');
    for (const check of report.checks) {
        logger.raw(`- ${check.name}: ${check.status} - ${check.message}`);
    }
    logger.info(`Summary: ok=${report.summary.ok} warn=${report.summary.warn} fail=${report.summary.fail}`);
    logger.divider();
}

async function interactiveSession(options) {
    printBanner();
    logger.info('Interactive session started. Use "exit" to quit.');

    const engine = await createEngine();
    const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'ai> ',
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const task = line.trim();

        if (!task) {
            rl.prompt();
            return;
        }

        if (task === 'exit' || task === 'quit') {
            rl.close();
            return;
        }

        if (task === 'skills') {
            await printSkills();
            rl.prompt();
            return;
        }

        if (task === 'memory') {
            const context = await memory.load(process.env.AGENT_WORK_DIR || process.cwd());
            memory.displayContext(context);
            rl.prompt();
            return;
        }

        if (task === 'metrics') {
            await handleMetricsCommand();
            rl.prompt();
            return;
        }

        try {
            await engine.runTask(task, {
                autoRun: options.yes,
                unsafe: options.unsafe,
            });
        } catch (error) {
            logger.error(error.message);
        }

        rl.prompt();
    });

    rl.on('close', () => {
        logger.info('Session closed.');
        process.exit(0);
    });
}

program
    .name('ai')
    .description('Terminal-first AI automation agent powered by Gemini')
    .version('1.0.0')
    .option('-y, --yes', 'Preserve compatibility with existing non-interactive flows')
    .option('--unsafe', 'Bypass confirmations for system and dangerous skills')
    .option('--plan', 'Show the AI plan without executing')
    .option('--explain', 'Show the planned approach and rationale')
    .option('--interactive', 'Start an interactive agent session')
    .option('--debug', 'Enable debug logging')
    .helpOption('-h, --help', 'Show help');

program
    .command('skills')
    .description('List all discovered skills')
    .action(printSkills);

program
    .command('plugins')
    .description('List discovered plugin modules and external skills')
    .action(printPlugins);

program
    .command('memory')
    .description('Inspect or refresh stored agent memory')
    .option('--scan', 'Refresh the stored project structure')
    .option('--clear', 'Clear stored memory')
    .action(handleMemoryCommand);

program
    .command('metrics')
    .description('Show runtime metrics')
    .action(handleMetricsCommand);

program
    .command('doctor')
    .description('Validate runtime health and workspace configuration')
    .action(handleDoctorCommand);

program
    .command('analyze')
    .description('Analyze the current workspace without using Gemini')
    .option('--unsafe', 'Bypass confirmations for privileged skills')
    .action(handleAnalyzeCommand);

program
    .command('interactive')
    .description('Start an interactive agent session')
    .option('-y, --yes', 'Preserve compatibility with existing non-interactive flows')
    .option('--unsafe', 'Bypass confirmations for system and dangerous skills')
    .action(interactiveSession);

program
    .argument('[task...]', 'Task to send to the agent')
    .action(async (taskParts, options) => {
        if (options.debug) {
            process.env.DEBUG = 'true';
        }

        if (options.interactive) {
            await interactiveSession(options);
            return;
        }

        const task = taskParts.join(' ').trim();
        if (!task) {
            program.help();
            return;
        }

        if (task === 'skills') {
            await printSkills();
            return;
        }

        if (task === 'memory') {
            await handleMemoryCommand({});
            return;
        }

        if (task === 'metrics') {
            await handleMetricsCommand();
            return;
        }

        if (task === 'doctor') {
            await handleDoctorCommand();
            return;
        }

        if (task === 'plugins') {
            await printPlugins();
            return;
        }

        if (task === 'analyze') {
            await handleAnalyzeCommand(options);
            return;
        }

        printBanner();
        logger.info(`Task: ${task}`);

        const engine = await createEngine();
        try {
            await engine.runTask(task, {
                autoRun: options.yes,
                unsafe: options.unsafe,
                planOnly: options.plan,
                explain: options.explain,
            });
        } catch (error) {
            logger.error(error.message);
            process.exitCode = 1;
        }
    });

program.parse(process.argv);
