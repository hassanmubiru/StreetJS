#!/usr/bin/env node
// scripts/audit/repo-wide-checks.mjs
//
// Whole-monorepo hygiene checks that were previously only run manually during
// ad-hoc release audits. Wired into CI via .github/workflows/repo-hygiene.yml
// so every push/PR gets this coverage automatically, across ALL packages —
// not just streetjs/cli/core-compat (which existing jobs like `policy-checks`
// and `package-integrity` already cover in more depth).
//
// Checks, each independently reported (all run; failures accumulate):
//   1. Manifest integrity   — every non-private package's `exports`/`main`/
//                             `types`/`module`/`bin` targets resolve to real
//                             files on disk.
//   2. README named imports — every `import { X } from '@scope/pkg'` in a
//      package's README resolves to a real export of that package's built
//      entry point (skips packages without a build/dist yet).
//   3. Placeholder markers  — TODO/FIXME/HACK/@ts-ignore/@ts-nocheck in
//      production src (excludes tests/examples), repo-wide.
//   4. Circular dependencies — delegates to scripts/check-cycles.mjs across
//      every package's src/ (not just core/cli/edge).
//
// Exit code: 0 iff every check passes across every package; 1 otherwise, with
// each failure printed as a GitHub Actions ::error:: annotation.
//
// Usage: node scripts/audit/repo-wide-checks.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

let failures = 0;
const fail = (msg) => { console.log(`::error::${msg}`); failures++; };
const info = (msg) => console.log(msg);

/** Every package dir under packages/ with a package.json, excluding private ones. */
function listPublicPackages() {
  const dirs = readdirSync(join(REPO_ROOT, 'packages')).sort();
  const out = [];
  for (const d of dirs) {
    const pjPath = join(REPO_ROOT, 'packages', d, 'package.json');
    if (!existsSync(pjPath)) continue;
    let pj;
    try { pj = JSON.parse(readFileSync(pjPath, 'utf8')); } catch { continue; }
    if (pj.private === true) continue;
    out.push({ dir: d, base: join(REPO_ROOT, 'packages', d), pj });
  }
  return out;
}

// ── 1. Manifest integrity ───────────────────────────────────────────────────
function checkManifestIntegrity(packages) {
  info('\n=== [1/4] Manifest integrity (exports/main/types/module/bin) ===');
  let checked = 0;
  for (const { dir, base, pj } of packages) {
    const seen = new Set();
    const walk = (v) => {
      if (typeof v === 'string' && v.startsWith('./')) {
        if (seen.has(v)) return;
        seen.add(v);
        checked++;
        if (!existsSync(join(base, v))) {
          fail(`${pj.name ?? dir}: manifest target missing on disk: ${v}`);
        }
      } else if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) walk(v[k]);
      }
    };
    walk(pj.exports);
    walk(pj.main);
    walk(pj.types);
    walk(pj.module);
    walk(pj.bin);
  }
  info(`  checked ${checked} manifest target(s) across ${packages.length} package(s).`);
}

// ── 2. README named imports ─────────────────────────────────────────────────
async function checkReadmeImports(packages) {
  info('\n=== [2/4] README named-import verification ===');
  const importRe = /import\s+(?:type\s+)?(?:[A-Za-z0-9_$]+\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;
  let checked = 0, skippedNoBuild = 0;
  for (const { dir, base, pj } of packages) {
    const readmePath = join(base, 'README.md');
    if (!existsSync(readmePath) || !pj.name) continue;
    const text = readFileSync(readmePath, 'utf8');
    const named = new Set();
    let m;
    while ((m = importRe.exec(text)) !== null) {
      if (m[2] !== pj.name) continue; // only imports of this package itself
      if (!m[1]) continue;
      for (let part of m[1].split(',')) {
        part = part.trim().replace(/^type\s+/, '');
        if (!part) continue;
        named.add(part.split(/\s+as\s+/)[0].trim());
      }
    }
    if (named.size === 0) continue;

    let mod;
    try {
      mod = await import(pj.name);
    } catch {
      skippedNoBuild++;
      continue; // package not built in this context — not a README defect
    }
    const dtsPath = pj.types ? join(base, pj.types) : null;
    const dtsText = dtsPath && existsSync(dtsPath) ? readFileSync(dtsPath, 'utf8') : '';
    const realExports = new Set(Object.keys(mod));
    checked += named.size;
    for (const name of named) {
      if (realExports.has(name)) continue;
      // Fall back to checking the .d.ts text for type-only exports not present
      // on the runtime namespace object.
      if (dtsText && new RegExp(`\\b${name}\\b`).test(dtsText)) continue;
      fail(`${pj.name} README imports '${name}', which is not an export of the built package.`);
    }
  }
  info(`  checked ${checked} named import(s); ${skippedNoBuild} package(s) skipped (not built in this context).`);
}

// ── 3. Placeholder markers in production source ────────────────────────────
function checkPlaceholders(packages) {
  info('\n=== [3/4] Placeholder markers in production source (TODO/FIXME/HACK/@ts-ignore/@ts-nocheck) ===');
  const pattern = /\b(TODO|FIXME|HACK)\b|@ts-ignore|@ts-nocheck/;
  let scanned = 0, hits = 0;
  for (const { base, pj } of packages) {
    const srcDir = join(base, 'src');
    if (!existsSync(srcDir)) continue;
    const walk = (dir) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) {
          if (name.name === 'tests' || name.name === 'examples') continue;
          walk(p);
        } else if (name.name.endsWith('.ts') && !name.name.endsWith('.test.ts') && !name.name.endsWith('.d.ts')) {
          scanned++;
          const text = readFileSync(p, 'utf8');
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (pattern.test(lines[i])) {
              hits++;
              fail(`${pj.name ?? base}: placeholder marker at ${p.replace(REPO_ROOT + '/', '')}:${i + 1}: ${lines[i].trim().slice(0, 100)}`);
            }
          }
        }
      }
    };
    walk(srcDir);
  }
  info(`  scanned ${scanned} production source file(s); ${hits} marker(s) found.`);
}

// ── 4. Circular dependencies (delegates to check-cycles.mjs) ────────────────
function checkCircularDeps(packages) {
  info('\n=== [4/4] Circular dependency analysis (repo-wide) ===');
  const roots = packages
    .map(({ base }) => join(base, 'src'))
    .filter(existsSync)
    .map((p) => p.replace(REPO_ROOT + '/', ''));
  const result = spawnSync('node', ['scripts/check-cycles.mjs', ...roots], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  info(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  if (result.status !== 0) {
    fail('circular dependency detected — see output above');
  }
}

async function main() {
  const packages = listPublicPackages();
  info(`Discovered ${packages.length} non-private package(s) under packages/.`);

  checkManifestIntegrity(packages);
  await checkReadmeImports(packages);
  checkPlaceholders(packages);
  checkCircularDeps(packages);

  info(`\n=== Summary: ${failures} failure(s) ===`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
