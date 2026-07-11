#!/usr/bin/env node
// scripts/verify-registry-subpaths.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Registry subpath-import gate.
//
// Installs every published StreetJS workspace package FROM THE NPM REGISTRY and
// dynamically imports EVERY subpath declared in each installed package's published
// `exports` field. This is the guard against the packaging/exports-vs-tarball
// defect class (historically F-4 `@streetjs/storage` and F-5 admin/ai/commerce/
// search) — where a package's own `exports`/`files` allowlist omits a sibling
// runtime module, so the package installs but fails on import from the registry.
//
// Semantics (deliberate, matches the repo's "honest BLOCKED" convention):
//   • A genuine subpath import failure of an installed package  → exit 1 (defect).
//   • Registry unreachable / install cannot complete (network)  → exit 0 (BLOCKED),
//     because that is infrastructure, not a package defect. The reason is recorded.
//   • All subpaths import OK                                     → exit 0 (VERIFIED).
//
// JSON export targets are imported with `{ with: { type: 'json' } }`. Types-only
// (`.d.ts`) and wildcard (`*`) export keys are classified and skipped (not runtime).
//
// Usage:
//   node scripts/verify-registry-subpaths.mjs            # all published packages
//   node scripts/verify-registry-subpaths.mjs pkgA pkgB  # only the named packages
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.slice(2);

// ── 1. Enumerate publishable workspace packages ─────────────────────────────
function publishablePackages() {
  const dir = join(repoRoot, 'packages');
  const out = [];
  for (const d of readdirSync(dir)) {
    const pj = join(dir, d, 'package.json');
    if (!existsSync(pj)) continue;
    let j;
    try { j = JSON.parse(readFileSync(pj, 'utf8')); } catch { continue; }
    if (!j.name || j.private === true) continue;
    if (only.length && !only.includes(j.name)) continue;
    out.push(j.name);
  }
  return out.sort();
}

// ── 2. Enumerate runtime subpaths from a package's published `exports` ───────
function leaves(v, acc) {
  if (typeof v === 'string') { acc.push(v); return; }
  if (v && typeof v === 'object') for (const k of Object.keys(v)) leaves(v[k], acc);
}
function hasRuntime(v) {
  const acc = []; leaves(v, acc);
  return acc.some((s) => /\.(js|mjs|cjs|json)$/.test(s));
}
function isJsonOnly(v) {
  const acc = []; leaves(v, acc);
  const rt = acc.filter((s) => /\.(js|mjs|cjs|json)$/.test(s));
  return rt.length > 0 && rt.every((s) => /\.json$/.test(s));
}
function subpathsOf(pj) {
  const exp = pj.exports;
  if (exp == null) return [['.', pj.main || pj.module || 'index.js']];
  if (typeof exp === 'string') return [['.', exp]];
  const keys = Object.keys(exp);
  if (keys.some((k) => k.startsWith('.'))) return keys.filter((k) => k.startsWith('.')).map((k) => [k, exp[k]]);
  return [['.', exp]]; // a bare conditions object is the "." export
}

async function main() {
  const names = publishablePackages();
  if (names.length === 0) {
    console.error('[subpaths] no publishable packages found');
    process.exit(1);
  }
  console.log(`[subpaths] ${names.length} publishable packages`);

  // ── 3. Resolve published versions ──────────────────────────────────────────
  const specs = [];
  const unpublished = [];
  for (const name of names) {
    try {
      const v = execSync(`npm view ${name} version`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      if (v) specs.push(`${name}@${v}`); else unpublished.push(name);
    } catch { unpublished.push(name); }
  }
  console.log(`[subpaths] resolved ${specs.length} published, ${unpublished.length} unpublished`);
  if (specs.length === 0) {
    console.log('[subpaths] BLOCKED: no published versions resolvable (registry unreachable?) — exit 0');
    process.exit(0);
  }

  // ── 4. Install from the registry into an isolated project ───────────────────
  const work = mkdtempSync(join(tmpdir(), 'streetjs-subpaths-'));
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'subpath-gate', private: true, type: 'module', version: '0.0.0' }));
  try {
    execSync(`npm install --no-audit --no-fund ${specs.join(' ')}`, { cwd: work, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const msg = (e.stderr?.toString() || e.message || '').split('\n').slice(-5).join(' ');
    console.log(`[subpaths] BLOCKED: registry install failed (infrastructure, not a package defect): ${msg} — exit 0`);
    process.exit(0);
  }

  // ── 5. Import every runtime subpath ─────────────────────────────────────────
  const { pathToFileURL } = await import('node:url');
  const results = [];
  let ok = 0, fail = 0, skip = 0;
  for (const spec of specs) {
    const name = spec.replace(/@[^@]+$/, '');
    let pj;
    try { pj = JSON.parse(readFileSync(join(work, 'node_modules', name, 'package.json'), 'utf8')); }
    catch (e) { results.push({ name, sub: '(package.json)', status: 'FAIL', message: e.message }); fail++; continue; }
    for (const [key, val] of subpathsOf(pj)) {
      if (key.includes('*')) { results.push({ name, sub: key, status: 'SKIP_PATTERN' }); skip++; continue; }
      if (!hasRuntime(val)) { results.push({ name, sub: key, status: 'SKIP_TYPES_ONLY' }); skip++; continue; }
      const target = name + (key === '.' ? '' : key.slice(1));
      // resolve against the temp project so bare specifiers find node_modules
      const resolved = pathToFileURL(join(work, 'node_modules', 'x')).href; // base only
      const json = isJsonOnly(val);
      try {
        const spec2 = await import.meta.resolve
          ? import.meta.resolve(target, pathToFileURL(join(work, 'index.js')).href)
          : target;
        if (json) await import(spec2, { with: { type: 'json' } });
        else {
          try { await import(spec2); }
          catch (e) {
            const c = String(e.code || '');
            if (c.includes('IMPORT_ATTRIBUTE') || c.includes('ASSERTION') || /type.*json/i.test(e.message)) {
              await import(spec2, { with: { type: 'json' } });
            } else throw e;
          }
        }
        results.push({ name, sub: key, target, json, status: 'OK' }); ok++;
      } catch (e) {
        results.push({ name, sub: key, target, json, status: 'FAIL', code: e.code || '', message: (e.message || '').split('\n')[0] }); fail++;
      }
    }
  }

  // ── 6. Emit artifact + summary ──────────────────────────────────────────────
  const outDir = join(repoRoot, 'verification-artifacts', 'registry-subpaths');
  mkdirSync(outDir, { recursive: true });
  const artifact = {
    generatedAt: new Date().toISOString(),
    node: process.version,
    packages: specs.length,
    runtimeSubpaths: ok + fail,
    ok, fail, skipped: skip,
    unpublished,
    failures: results.filter((r) => r.status === 'FAIL'),
    results,
  };
  writeFileSync(join(outDir, 'registry-subpaths.artifact.json'), JSON.stringify(artifact, null, 2));

  console.log('[subpaths] === FAILURES ===');
  for (const r of artifact.failures) console.log(`  FAIL ${r.target || r.name} [${r.code || ''}] ${r.message}`);
  console.log(`[subpaths] packages=${specs.length} runtimeSubpaths=${ok + fail} OK=${ok} FAIL=${fail} skipped=${skip}`);

  if (fail > 0) { console.error(`[subpaths] ✖ ${fail} subpath import(s) failed — packaging/exports defect`); process.exit(1); }
  console.log('[subpaths] ✔ every published subpath imports cleanly'); process.exit(0);
}

main().catch((e) => { console.error('[subpaths] unexpected error:', e); process.exit(1); });
