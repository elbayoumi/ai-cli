# AI CLI Agent

Production-oriented autonomous engineering agent runtime for terminal automation, code editing, project analysis, and plugin-based skill execution. Gemini is the initial reasoning backend, but the runtime is structured so local capabilities still work when `GEMINI_API_KEY` is missing.

## Core Design

- Terminal-first interface
- JSON-only AI actions
- Skills as the only execution boundary
- Validation before every action
- Sandboxed workspace file access
- Plugin discovery from `./skills` and `./plugins`
- Iterative agent loop with explicit stop conditions

## Architecture

```text
src/
  cli/
    index.js
  core/
    ai.js
    agent_loop.js
    doctor.js
    engine.js
    metrics.js
    planner.js
    project_analyzer.js
    self_reflection.js
  tools/
    filesystem.js
    git.js
    http.js
    terminal.js
  skills/
    registry.js
    terminal.run_command.js
    filesystem.read_file.js
    filesystem.write_file.js
    filesystem.list_files.js
    filesystem.edit_file.js
    project.analyze.js
    http.request.js
    git.status.js
    git.diff.js
    git.commit.js
    git.branch.js
    git.log.js
    agent.self_reflect.js
  memory/
    context_store.js
  security/
    command_filter.js
  utils/
    logger.js
    schema_validator.js
plugins/
  docker.plugin.js
skills/
bin/
  ai.js
```

## Runtime Capabilities

- Terminal automation through `terminal.run_command`
- Sandboxed file reads, writes, listings, and structured edits
- Human plans and execution plans with normalization
- Workspace project analysis with framework and package-manager detection
- Git inspection and commit/branch workflows
- Allowlisted HTTP requests with size and timeout limits
- Persistent task memory, reflections, and metrics in `.ai/context.json`
- Structured logging with execution, task, and action IDs

## Permission Model

Every skill declares a `permissionLevel`:

- `read`
- `write`
- `network`
- `system`
- `dangerous`

`system` and `dangerous` skills require explicit confirmation unless `--unsafe` is used. Lower-risk skills auto-run.

## CLI

### Natural-language tasks

```bash
ai list files
ai read package.json
ai fix this configuration
ai improve this project
```

### Commands

```bash
ai skills
ai plugins
ai analyze
ai doctor
ai metrics
ai memory
ai memory --scan
ai interactive
```

### Flags

- `-y, --yes`: keep compatibility with existing non-interactive flows
- `--unsafe`: bypass confirmations for `system` and `dangerous` skills
- `--plan`: request a human plan only
- `--explain`: request a plan or action plus rationale
- `--interactive`: start a REPL-style agent session
- `--debug`: emit structured JSON logs

## AI Contracts

Single action:

```json
{
  "action": "filesystem.read_file",
  "path": "package.json"
}
```

Human plan:

```json
{
  "action": "plan",
  "description": "Analyze the project",
  "steps": [
    "scan project structure",
    "inspect package.json",
    "identify dependencies"
  ]
}
```

Execution plan:

```json
{
  "action": "plan",
  "description": "Analyze the workspace",
  "steps": [
    { "action": "project.analyze" },
    { "action": "filesystem.read_file", "path": "package.json" }
  ]
}
```

Structured edit:

```json
{
  "action": "filesystem.edit_file",
  "path": "src/index.js",
  "operation": "replace_block",
  "target": "old code",
  "replacement": "new code"
}
```

HTTP request:

```json
{
  "action": "http.request",
  "method": "GET",
  "url": "https://api.github.com/repos"
}
```

## Memory

The runtime persists `.ai/context.json` with:

- project scan data
- project analysis metadata
- recent commands
- execution results
- task history
- reflections
- runtime metrics

## Project Analyzer

`project.analyze` inspects the workspace for:

- project type
- language
- frameworks
- package manager
- dependency managers
- build systems
- Docker support
- git repository status

Examples it can detect include Node.js, Python, Docker, Next.js, FastAPI, Laravel, and Go modules.

## Git Skills

- `git.status`
- `git.diff`
- `git.commit`
- `git.branch`
- `git.log`

## Network Safety

`http.request` supports `GET`, `POST`, `PUT`, and `DELETE`, but only against allowlisted domains from `HTTP_ALLOWED_DOMAINS`.

## Plugin SDK

Plugins can export a single skill or a bundle:

```js
export default {
  skills: [
    {
      name: "docker.run_container",
      permissionLevel: "system",
      description: "Run a Docker container",
      handler: async ({ image }) => { /* ... */ }
    }
  ]
}
```

The registry loads plugins safely and records load errors for `ai doctor` and `ai plugins`.

## Reliability Guards

The runtime stops when:

- iterations exceed `MAX_ITERATIONS`
- executed actions exceed `MAX_STEPS_PER_TASK`
- repeated failures exceed `MAX_CONSECUTIVE_FAILURES`
- invalid AI responses exceed `MAX_INVALID_AI_RESPONSES`
- heap usage exceeds `MAX_MEMORY_BYTES`

It also enforces command timeouts, HTTP timeouts, response size caps, edit size limits, and context file size limits.

## Environment

Copy `.env.example` to `.env` and configure:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `AGENT_WORK_DIR`
- `COMMAND_TIMEOUT_MS`
- `MAX_COMMAND_TIMEOUT_MS`
- `MAX_ITERATIONS`
- `MAX_STEPS_PER_TASK`
- `MAX_MEMORY_BYTES`
- `HTTP_ALLOWED_DOMAINS`

## Development

```bash
npm install
npm link
ai doctor
ai analyze
ai --help
```
