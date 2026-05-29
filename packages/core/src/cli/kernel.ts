// src/cli/kernel.ts
// CLI kernel: argv parser, flag parser, @Command decorator dispatch with DI.

import { container } from '../core/container.js';
import { getCommandMeta } from '../core/decorators.js';
import type { Constructor } from '../core/types.js';

export interface ParsedArgs {
  command: string | null;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/** Parse process.argv into structured args */
export function parseArgv(argv: string[]): ParsedArgs {
  // argv[0] = node, argv[1] = script
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command: string | null = null;

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx !== -1) {
        flags[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith('-')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      if (command === null) {
        command = arg;
      } else {
        positional.push(arg);
      }
    }

    i++;
  }

  return { command, positional, flags };
}

export interface CliKernelOptions {
  appName?: string;
  version?: string;
}

export class CliKernel {
  private readonly handlers = new Map<string, { instance: object; method: string; description: string }>();
  private readonly opts: Required<CliKernelOptions>;

  constructor(opts: CliKernelOptions = {}) {
    this.opts = {
      appName: opts.appName ?? 'street',
      version: opts.version ?? '1.0.0',
    };
  }

  /** Register a class containing @Command-decorated methods */
  register(ctor: Constructor): void {
    const instance = container.resolve(ctor);
    const commands = getCommandMeta(ctor);

    for (const cmd of commands) {
      if (this.handlers.has(cmd.name)) {
        throw new Error(`Duplicate CLI command: "${cmd.name}"`);
      }
      this.handlers.set(cmd.name, {
        instance,
        method: cmd.handlerMethod,
        description: cmd.description,
      });
    }
  }

  /** Run a command from parsed args */
  async run(args: ParsedArgs): Promise<void> {
    if (args.flags['version'] || args.flags['v']) {
      console.log(`${this.opts.appName} v${this.opts.version}`);
      return;
    }

    if (!args.command || args.flags['help'] || args.flags['h']) {
      this._printHelp();
      return;
    }

    const handler = this.handlers.get(args.command);
    if (!handler) {
      console.error(`Unknown command: "${args.command}"`);
      console.error(`Run "${this.opts.appName} --help" to see available commands.`);
      process.exitCode = 1;
      return;
    }

    const method = (handler.instance as Record<string, unknown>)[handler.method];
    if (typeof method !== 'function') {
      throw new Error(`Handler method "${handler.method}" is not a function`);
    }

    await (method as (args: ParsedArgs) => Promise<void>).call(handler.instance, args);
  }

  /** Execute from process.argv */
  async execute(): Promise<void> {
    const args = parseArgv(process.argv);
    await this.run(args);
  }

  private _printHelp(): void {
    console.log(`\n${this.opts.appName} v${this.opts.version}\n`);
    console.log('Commands:\n');
    for (const [name, h] of this.handlers.entries()) {
      console.log(`  ${name.padEnd(20)} ${h.description}`);
    }
    console.log('\nFlags:\n');
    console.log('  --help, -h           Show this help');
    console.log('  --version, -v        Show version\n');
  }
}
