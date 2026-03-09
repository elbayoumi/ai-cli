Drop custom skill modules in this directory.

Each module can export:

- `export default { name, description, inputSchema, handler }`
- `export const skill = { ... }`
- `export const skills = [{ ... }, { ... }]`

The runtime auto-discovers these modules at startup.
