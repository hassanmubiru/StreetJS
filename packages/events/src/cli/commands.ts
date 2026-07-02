// src/cli/commands.ts
// @streetjs/events — CLI commands registered through the reused core CliKernel.
//
// Provides `make:event` and `make:listener` as `@Command`-decorated methods.
// Generation delegates to the pure functions in `generators.ts`: validate the
// name before writing anything, refuse to overwrite an existing target, and
// otherwise emit a typed scaffold that compiles under `tsc`.
//
// No class-level decorator is used, so no constructor dependency metadata is
// emitted and the core `CliKernel` can `container.resolve` the class with no
// registered dependencies.

import { Command } from 'streetjs';
import type { ParsedArgs } from 'streetjs';
import {
  generateEvent,
  generateListener,
  isValidGeneratorName,
  writeScaffold,
  type GenerateResult,
} from './generators.js';

/** Queue of `street make:event` / `street make:listener` commands. */
export class EventsCommands {
  /** `street make:event <Name> [--dir ./events]` — scaffold a typed Event class. */
  @Command('make:event', 'Scaffold a new application Event class (make:event <Name> [--dir <dir>])')
  makeEvent(args: ParsedArgs): void {
    this.runGenerator(args, 'event', (name, dir) => generateEvent(name, dir));
  }

  /** `street make:listener <Name> [--dir ./listeners]` — scaffold an event listener. */
  @Command('make:listener', 'Scaffold a new event listener (make:listener <Name> [--dir <dir>])')
  makeListener(args: ParsedArgs): void {
    this.runGenerator(args, 'listener', (name, dir) => generateListener(name, dir));
  }

  /**
   * Resolve, validate, render, and write a generator scaffold. Validation runs
   * before any file is written; a failed validation aborts with no file written
   * and an existing target is never overwritten.
   */
  private runGenerator(
    args: ParsedArgs,
    kind: 'event' | 'listener',
    generate: (name: string, dir?: string) => GenerateResult,
  ): void {
    const name = this.resolveName(args);
    if (!isValidGeneratorName(name)) {
      console.error(
        `[events] Invalid ${kind} name: "${name}". ` +
          `Use a PascalCase identifier (a letter followed by letters or digits).`,
      );
      process.exitCode = 1;
      return;
    }

    const dir = typeof args.flags['dir'] === 'string' ? args.flags['dir'] : undefined;
    const result = generate(name, dir);
    try {
      writeScaffold(result);
    } catch (err) {
      console.error(`[events] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[events] Generated ${kind}: ${result.path}`);
  }

  /** Read the generator name from the first positional arg or `--name`. */
  private resolveName(args: ParsedArgs): string {
    const positional = args.positional[0];
    if (typeof positional === 'string') {
      return positional;
    }
    return typeof args.flags['name'] === 'string' ? args.flags['name'] : '';
  }
}
