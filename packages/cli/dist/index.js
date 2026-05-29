// packages/cli/src/index.ts
// Main CLI dispatcher — parses argv, routes to command handlers, manages lifecycle.
import { argvParser } from './argv.js';
import { CreateCommand } from './commands/create.js';
import { DevCommand } from './commands/dev.js';
import { BuildCommand } from './commands/build.js';
import { StartCommand } from './commands/start.js';
import { TestCommand } from './commands/test.js';
import { GenerateCommand } from './commands/generate.js';
import { MigrateCommand } from './commands/migrate.js';
const VERSION = '1.0.2';
const APP_NAME = 'street';
/**
 * Main CLI entry point. Parses process.argv, finds a matching command,
 * executes it, and handles errors.
 */
export async function runCli(argv) {
    const args = argvParser(argv);
    const ctx = { cwd: process.cwd(), args };
    // ── Global flags ──────────────────────────────────────────────────────
    if (args.flags['version'] || args.flags['v']) {
        console.log(`${APP_NAME} v${VERSION}`);
        return;
    }
    if (!args.command || args.flags['help'] || args.flags['h']) {
        printHelp();
        return;
    }
    // ── Command routing ───────────────────────────────────────────────────
    try {
        switch (args.command) {
            case 'create':
                await new CreateCommand().execute(ctx);
                break;
            case 'dev':
                await new DevCommand().execute(ctx);
                break;
            case 'build':
                await new BuildCommand().execute(ctx);
                break;
            case 'start':
                await new StartCommand().execute(ctx);
                break;
            case 'test':
                await new TestCommand().execute(ctx);
                break;
            case 'generate':
                await new GenerateCommand().execute(ctx);
                break;
            case 'migrate:create':
                await new MigrateCommand().executeCreate(ctx);
                break;
            case 'migrate:run':
                await new MigrateCommand().executeRun(ctx);
                break;
            default:
                console.error(`[street] Unknown command: "${args.command}"`);
                console.error(`Run "${APP_NAME} --help" to see available commands.`);
                process.exitCode = 1;
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[street] Command failed: ${message}`);
        process.exitCode = 1;
    }
}
function printHelp() {
    console.log(`
${APP_NAME} v${VERSION} — Street framework CLI

Usage:
  street <command> [options]

Commands:
  create <name>                   Scaffold a new Street project
  dev                             Start the development server with hot-reload
  build                           Compile the project for production
  start                           Start the production server
  test                            Run the project test suite
  generate <type> <name>          Generate a controller, service, or repository
  migrate:create <name>           Create a new empty migration file
  migrate:run                     Run all pending migrations

Flags:
  --help, -h                      Show this help message
  --version, -v                   Show the CLI version

Examples:
  street create my-api
  street generate controller users
  street migrate:create create_users_table
  street migrate:run
`);
}
//# sourceMappingURL=index.js.map