import { CreateCommand } from '/home/error51/Downloads/street-framework/streetJS/packages/cli/dist/commands/create.js';
const cwd = process.cwd();
await new CreateCommand().execute({ cwd, args: { command: 'create', positional: ['my-saas'], flags: { 'no-lockfile': true, starter: 'saas' } } });
await new CreateCommand().execute({ cwd, args: { command: 'create', positional: ['my-saas-full'], flags: { 'no-lockfile': true, starter: 'saas', 'with-billing': true, 'with-admin-ui': true, 'with-email': true } } });
