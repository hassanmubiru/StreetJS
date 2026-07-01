// packages/cli/src/commands/make.ts
// `street make:<kind> <Name>` generators — scaffold typed, compile-ready
// realtime source (channels, gateways) into the consuming application.
//
// These commands follow the existing generator conventions used by
// `street generate` (see commands/generate.ts): a safe-identifier name check,
// template files under `templates/`, `{{...}}` placeholder substitution,
// directory creation, and non-destructive no-overwrite behavior. The shared
// `scaffold` helper is intentionally generic so `make:gateway` (task 13.2) can
// reuse the exact same path/validation/exit-code behavior as `make:channel`.

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliContext } from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Safe identifier pattern for `make:*` generator names (Req 14.1, 15.1).
 * A name must start with a letter and contain only letters and digits — this
 * keeps the generated PascalCase class/type and file name a valid TypeScript
 * identifier and prevents path-traversal via the name argument.
 */
const MAKE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/** Resolve the `make` templates directory regardless of CJS/ESM layout. */
function makeTemplatesDir(): string {
  // When compiled to dist/, __dirname is packages/cli/dist/commands/;
  // templates live at packages/cli/templates/make/.
  return resolve(__dirname, '..', '..', 'templates', 'make');
}

/** Normalize a validated name to PascalCase (upper-case the first character). */
export function toMakePascalCase(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Derive the channel-name string literal (camelCase) from a PascalCase name. */
export function toMakeChannelName(pascal: string): string {
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** Configuration for a single `make:*` generator variant. */
interface MakeSpec {
  /** Human-readable kind reported in success/usage output (e.g. `channel`). */
  readonly kind: string;
  /** Project subdirectory under `src/` the file is written to. */
  readonly subdir: string;
  /** Suffix appended to the PascalCase name to form the class/file base. */
  readonly suffix: string;
  /** Template file name under `templates/make/`. */
  readonly templateFile: string;
  /** Usage string printed on missing/invalid name. */
  readonly usage: string;
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export class MakeCommand {
  /** `street make:channel <Name>` (Req 14.1–14.4). */
  async executeChannel(ctx: CliContext): Promise<void> {
    await this.scaffold(ctx, {
      kind: 'channel',
      subdir: 'channels',
      suffix: 'Channel',
      templateFile: 'channel.ts.tpl',
      usage: 'street make:channel <Name>',
    });
  }

  /** `street make:gateway <Name>` (Req 15.1–15.4). */
  async executeGateway(ctx: CliContext): Promise<void> {
    await this.scaffold(ctx, {
      kind: 'gateway',
      subdir: 'gateways',
      suffix: 'Gateway',
      templateFile: 'gateway.ts.tpl',
      usage: 'street make:gateway <Name>',
    });
  }

  /**
   * Shared scaffolder for every `make:*` generator. Handles name validation,
   * PascalCase normalization, no-overwrite protection, directory creation, and
   * template rendering with consistent exit codes and usage guidance.
   */
  private async scaffold(ctx: CliContext, spec: MakeSpec): Promise<void> {
    const raw = ctx.args.positional[0];

    // ── Missing name → non-zero exit + usage guidance (Req 14.2/15.2) ──────
    if (typeof raw !== 'string' || raw.trim() === '') {
      console.error(`[street] Usage: ${spec.usage}`);
      console.error(`  Example: street make:${spec.kind} Chat`);
      process.exitCode = 1;
      return;
    }

    const name = raw.trim();

    // ── Name validation (Req 14.1) ─────────────────────────────────────────
    if (!MAKE_NAME_PATTERN.test(name)) {
      console.error(
        `[street] Invalid name "${name}". Name must match ${MAKE_NAME_PATTERN.source} (letters and digits, starting with a letter).`
      );
      console.error(`  Usage: ${spec.usage}`);
      process.exitCode = 1;
      return;
    }

    const pascal = toMakePascalCase(name);
    const channelName = toMakeChannelName(pascal);
    const fileBase = `${pascal}${spec.suffix}`;
    const relPath = `src/${spec.subdir}/${fileBase}.ts`;
    const targetPath = resolve(ctx.cwd, 'src', spec.subdir, `${fileBase}.ts`);

    // ── No-overwrite → non-zero exit, leave existing file intact (Req 14.3) ─
    if (await fileExists(targetPath)) {
      console.error(`[street] File already exists: ${relPath}`);
      console.error('Abort — no files were overwritten.');
      process.exitCode = 1;
      return;
    }

    // ── Render the typed template (Req 14.1, 14.4) ─────────────────────────
    const tplPath = resolve(makeTemplatesDir(), spec.templateFile);
    const tpl = await readFile(tplPath, 'utf8');
    const content = tpl
      .replaceAll('{{NAME}}', pascal)
      .replaceAll('{{CHANNEL}}', channelName);

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, 'utf8');

    console.log(`[street] Generated ${spec.kind}: ${relPath}`);
  }
}
