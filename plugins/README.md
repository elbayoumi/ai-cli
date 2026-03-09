Drop plugin skill modules or plugin folders in this directory.

Supported plugin entrypoints:

- `plugins/my-plugin.js`
- `plugins/my-plugin/index.js`
- `plugins/my-plugin/skill.js`
- `plugins/my-plugin/package.json` with a `main` field

Each plugin can export one skill or a `skills` array.
