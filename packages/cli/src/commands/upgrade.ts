// packages/cli/src/commands/upgrade.ts
// `street upgrade` — report breaking changes between the installed and target
// Framework versions, then apply migration codemods across a project's
// TypeScript sources. Dry-run by default (prints what would change); pass
// --write to apply. Version resolution + breaking-change analysis and the
// codemods themselves come from @streetjs/core
// (resolveVersions/analyzeBreakingChanges, applyCodemods/listCodemods).
//
// _Design: Components → Upgrade System. Requirements: 8.1, 8.2, 8.3, 8.4_

import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { CliContext } from '../index.js';

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);

export class UpgradeCommand {
  async execute(ctx: CliContext): Promise<void> {
    const core = await import('streetjs');

    // `--list` just prints available codemods.
    if (ctx.args.flags['list']) {
      console.log('\n  Available codemods:\n');
      for (const c of core.listCodemods()) console.log(`  ${c.id.padEnd(30)} ${c.description}`);
      console.log('');
      return;
    }

    // ── Report breaking changes + recommendations (Req 8.3/8.4) ────────────
    // Resolve the installed + target versions and analyze the breaking changes
    // crossed by the upgrade. If an explicitly requested version cannot be
    // resolved, halt before touching any files (Req 8.2).
    const halt = await this.reportBreakingChanges(ctx, core);
    if (halt) return;

    const targetArg = ctx.args.positional[0] ?? 'src';
    const root = resolve(ctx.cwd, targetArg);
    const write = Boolean(ctx.args.flags['write']);
    const only = ctx.args.flags['codemod'] ? [String(ctx.args.flags['codemod'])] : undefined;

    const files = await this.collectTsFiles(root);
    let filesChanged = 0;
    let totalChanges = 0;
    const perCodemod: Record<string, number> = {};

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      let result;
      try {
        result = core.applyCodemods(source, only);
      } catch (err) {
        console.error(`[street] ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }
      if (result.changed) {
        filesChanged++;
        totalChanges += result.totalChanges;
        for (const [id, n] of Object.entries(result.perCodemod)) {
          if (n > 0) perCodemod[id] = (perCodemod[id] ?? 0) + n;
        }
        console.log(`  ${write ? 'updated' : 'would update'}: ${file} (${result.totalChanges} change${result.totalChanges === 1 ? '' : 's'})`);
        if (write) await writeFile(file, result.code);
      }
    }

    console.log('\n  street upgrade — summary');
    console.log(`  mode:           ${write ? 'WRITE' : 'dry-run (use --write to apply)'}`);
    console.log(`  files scanned:  ${files.length}`);
    console.log(`  files changed:  ${filesChanged}`);
    console.log(`  total changes:  ${totalChanges}`);
    for (const [id, n] of Object.entries(perCodemod)) console.log(`    - ${id}: ${n}`);
    console.log('');
  }

  /**
   * Resolve the installed + target Framework versions and print the breaking
   * changes crossed by the upgrade, each with its affected area, whether an
   * automated codemod is available, and the upgrade recommendation (Req
   * 8.3/8.4).
   *
   * The installed version is read from `--from`, else detected from the
   * project's installed `streetjs`/`@streetjs/core`. The target is read from
   * `--to`, else defaults to the latest version the CLI bundles (Req 8.1).
   *
   * Returns `true` when the upgrade must halt: this happens only when a version
   * was explicitly requested but could not be resolved (Req 8.2). When no
   * version information is available and none was requested, the report is
   * skipped silently and the codemod pass proceeds (backward compatible).
   */
  private async reportBreakingChanges(
    ctx: CliContext,
    core: typeof import('streetjs'),
  ): Promise<boolean> {
    const fromArg = ctx.args.flags['from'] ? String(ctx.args.flags['from']) : undefined;
    const toArg = ctx.args.flags['to'] ? String(ctx.args.flags['to']) : undefined;

    const installed = fromArg ?? (await this.detectInstalledVersion(ctx.cwd));
    const latest = this.detectLatestVersion() ?? installed ?? undefined;

    // Nothing to analyze and nothing requested: skip the report quietly.
    if (installed === null && toArg === undefined) return false;

    let resolution: import('streetjs').VersionResolution;
    try {
      resolution = core.resolveVersions({
        targetArg: toArg,
        latest: latest ?? '',
        installed,
      });
    } catch (err) {
      // An explicitly requested upgrade could not be resolved: halt before any
      // file is touched and report which version failed (Req 8.2).
      console.error(`[street] ${(err as Error).message}`);
      process.exitCode = 1;
      return true;
    }

    const changes = core.analyzeBreakingChanges(resolution);

    console.log('\n  street upgrade — breaking changes');
    console.log(`  installed:      ${resolution.installed}`);
    console.log(`  target:         ${resolution.target}`);
    if (changes.length === 0) {
      console.log('  No breaking changes detected for this version range.');
    } else {
      console.log(`  ${changes.length} breaking change${changes.length === 1 ? '' : 's'} detected:\n`);
      for (const c of changes) {
        const codemod = c.codemodId ? `codemod: ${c.codemodId}` : 'no automated codemod';
        console.log(`  • [${c.area}] ${c.description}`);
        console.log(`      recommendation: ${c.recommendation}`);
        console.log(`      ${codemod}`);
      }
    }
    console.log('');
    return false;
  }

  /**
   * Detect the Framework version installed in the project at `cwd`. Prefers the
   * renamed `streetjs` package, then the deprecated `@streetjs/core` compat
   * package. Returns `null` when neither is resolvable.
   */
  private async detectInstalledVersion(cwd: string): Promise<string | null> {
    return (
      (await this.readPackageVersion(resolve(cwd, 'node_modules', 'streetjs', 'package.json'))) ??
      (await this.readPackageVersion(resolve(cwd, 'node_modules', '@streetjs', 'core', 'package.json')))
    );
  }

  /**
   * Detect the latest Framework version available to this CLI: the version of
   * the `streetjs` package the CLI itself resolves. Returns `null` when it
   * cannot be located.
   */
  private detectLatestVersion(): string | null {
    try {
      const require = createRequire(import.meta.url);
      // Resolve the package main, then walk up to its package.json.
      let dir = dirname(require.resolve('streetjs'));
      for (let i = 0; i < 6; i++) {
        try {
          const pkg = JSON.parse(
            require('node:fs').readFileSync(join(dir, 'package.json'), 'utf8'),
          ) as { name?: string; version?: string };
          if (pkg.name === 'streetjs' && pkg.version) return pkg.version;
        } catch {
          /* keep walking up */
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch {
      /* streetjs not resolvable from the CLI */
    }
    return null;
  }

  private async readPackageVersion(pkgPath: string): Promise<string | null> {
    try {
      const raw = await readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(raw) as { version?: string };
      return pkg.version ?? null;
    } catch {
      return null;
    }
  }

  private async collectTsFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (!IGNORED_DIRS.has(e.name)) await walk(full);
        } else if (e.isFile() && /\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) {
          out.push(full);
        }
      }
    };
    // Support pointing at a single file too.
    try {
      const s = await stat(root);
      if (s.isFile()) return [root];
    } catch { /* fall through */ }
    await walk(root);
    return out;
  }
}
