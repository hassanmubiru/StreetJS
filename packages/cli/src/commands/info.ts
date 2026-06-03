// packages/cli/src/commands/info.ts
// `street info` — prints a summary table of environment versions and project config.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { platform, arch } from 'node:os';
import type { CliContext } from '../index.js';

interface InfoRow {
  label: string;
  value: string;
}

export class InfoCommand {
  async execute(ctx: CliContext): Promise<void> {
    const rows: InfoRow[] = [];

    // ── Street version ────────────────────────────────────────────────────
    rows.push({ label: 'Street version', value: this.readStreetVersion(ctx.cwd) });

    // ── Node.js version ───────────────────────────────────────────────────
    rows.push({ label: 'Node.js version', value: process.version });

    // ── TypeScript version ────────────────────────────────────────────────
    rows.push({ label: 'TypeScript version', value: this.readTypeScriptVersion(ctx.cwd) });

    // ── OS / Platform ─────────────────────────────────────────────────────
    rows.push({ label: 'OS', value: `${platform()} (${arch()})` });

    // ── Node.js environment ───────────────────────────────────────────────
    rows.push({ label: 'NODE_ENV', value: process.env['NODE_ENV'] ?? '(not set)' });

    this.printTable(rows);
  }

  /** Read the Street CLI version from the nearest package.json in cwd, or fallback to CLI's own. */
  readStreetVersion(cwd: string): string {
    // Try project's package.json first
    try {
      const projectPkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')) as Record<string, unknown>;
      const deps = (projectPkg['dependencies'] ?? {}) as Record<string, string>;
      const devDeps = (projectPkg['devDependencies'] ?? {}) as Record<string, string>;
      const ver = deps['@streetjs/core'] ?? devDeps['@streetjs/core'] ?? deps['@streetjs/cli'] ?? devDeps['@streetjs/cli'];
      if (ver) return ver;
    } catch {
      // fallthrough
    }

    // Fallback: CLI's own package.json
    try {
      const cliPkg = JSON.parse(
        readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
      ) as Record<string, unknown>;
      return String(cliPkg['version'] ?? 'unknown');
    } catch {
      return 'unknown';
    }
  }

  /** Read TypeScript version from node_modules/typescript/package.json. */
  readTypeScriptVersion(cwd: string): string {
    const candidates = [
      resolve(cwd, 'node_modules', 'typescript', 'package.json'),
      // Walk up one level (monorepo root)
      resolve(cwd, '..', 'node_modules', 'typescript', 'package.json'),
    ];

    for (const candidate of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as Record<string, unknown>;
        return `v${String(pkg['version'])}`;
      } catch {
        // try next
      }
    }
    return 'not found';
  }

  private printTable(rows: InfoRow[]): void {
    const labelWidth = Math.max(...rows.map((r) => r.label.length)) + 2;
    console.log('\n  Street Project Info\n  ' + '─'.repeat(labelWidth + 20));
    for (const { label, value } of rows) {
      console.log(`  ${(label + ':').padEnd(labelWidth)}${value}`);
    }
    console.log('');
  }
}
