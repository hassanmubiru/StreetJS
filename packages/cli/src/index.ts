// packages/cli/src/index.ts
// Main CLI dispatcher — parses argv, routes to command handlers, manages lifecycle.

import { argvParser } from './argv.js';
import type { ParsedArgs } from './argv.js';
import { CreateCommand } from './commands/create.js';
import { DevCommand } from './commands/dev.js';
import { BuildCommand } from './commands/build.js';
import { StartCommand } from './commands/start.js';
import { TestCommand } from './commands/test.js';
import { GenerateCommand } from './commands/generate.js';
import { MigrateCommand } from './commands/migrate.js';
import { InfoCommand } from './commands/info.js';
import { DoctorCommand, EnvValidateCommand } from './commands/doctor.js';
import { AuditCommand } from './commands/audit.js';
import { SeedCommand } from './commands/seed.js';
import { DiagnosticsCommand } from './commands/diagnostics.js';
import { JobsDashboardCommand } from './commands/jobs-dashboard.js';
import { DeployInitCommand } from './commands/deploy.js';
import { PluginInstallCommand, PluginListCommand } from './commands/plugin.js';

const VERSION = '1.0.3';
const APP_NAME = 'street';

export interface CliContext {
  cwd: string;
  args: ParsedArgs;
}

/**
 * Main CLI entry point. Parses process.argv, finds a matching command,
 * executes it, and handles errors.
 */
export async function runCli(argv: string[]): Promise<void> {
  const args = argvParser(argv);
  const ctx: CliContext = { cwd: process.cwd(), args };

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

      case 'migrate:diff':
        await new MigrateCommand().executeDiff(ctx);
        break;

      case 'info':
        await new InfoCommand().execute(ctx);
        break;

      case 'doctor':
        await new DoctorCommand().execute(ctx);
        break;

      case 'env':
        if (ctx.args.positional[0] === 'validate') {
          await new EnvValidateCommand().execute(ctx);
        } else {
          console.error('[street] Usage: street env validate');
          process.exitCode = 1;
        }
        break;

      case 'audit':
        await new AuditCommand().execute(ctx);
        break;

      case 'db:seed':
        await new SeedCommand().execute(ctx);
        break;

      case 'diagnostics':
        await new DiagnosticsCommand().execute(ctx);
        break;

      case 'jobs:dashboard':
        await new JobsDashboardCommand().execute(ctx);
        break;

      case 'deploy:init':
        await new DeployInitCommand().execute(ctx);
        break;

      case 'plugin:install':
        await new PluginInstallCommand().execute(ctx);
        break;

      case 'plugin:list':
        await new PluginListCommand().execute(ctx);
        break;

      default:
        console.error(`[street] Unknown command: "${args.command}"`);
        console.error(`Run "${APP_NAME} --help" to see available commands.`);
        process.exitCode = 1;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[street] Command failed: ${message}`);
    process.exitCode = 1;
  }
}

function printHelp(): void {
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
  migrate:diff [--confirm-destructive]  Diff live schema vs entity metadata
  db:seed <file>                  Run a SQL seed file (idempotent)
  info                            Print framework, runtime, and project info
  doctor                          Check runtime, env vars, and DB connectivity
  env validate                    Validate env vars against street.config
  audit                           Scan dependencies for known vulnerabilities
  diagnostics [--pid <pid>]       Live diagnostics dashboard for a running app
  jobs:dashboard [--pid <pid>]    Live job-queue dashboard for a running app

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
