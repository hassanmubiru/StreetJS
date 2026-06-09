// packages/cli/src/commands/upgrade.ts
// `street upgrade` — apply migration codemods across a project's TypeScript
// sources. Dry-run by default (prints what would change); pass --write to apply.
// Codemods come from @streetjs/core (applyCodemods/listCodemods).

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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
