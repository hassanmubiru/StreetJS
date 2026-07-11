#!/usr/bin/env node
// scripts/benchmark-footprint.mjs
// Reproducible INSTALL-FOOTPRINT benchmark: for each package, install it alone
// into a clean temp project and measure (a) direct dependency count, (b) total
// resolved package count (transitive), and (c) on-disk install size.
//
// This measures FOOTPRINT ONLY — not runtime throughput/latency (those are
// machine-dependent and belong in a separate harness). Footprint is StreetJS's
// core differentiator (dependency-free), and it is deterministic + reproducible:
// anyone can re-run this and get the same dependency graph from the registry.
//
// Usage:
//   node scripts/benchmark-footprint.mjs                 # default comparison set
//   node scripts/benchmark-footprint.mjs streetjs fastify express
//
// Output: a Markdown table to stdout + JSON at
// verification-artifacts/benchmarks/footprint.json (gitignored).

import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SET = ['streetjs', 'express', 'fastify', 'hono', '@nestjs/core', 'elysia'];
const targets = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SET;

/** Resolved (transitive) package count via npm ls --all --parseable. */
function resolvedCount(cwd) {
  try {
    const out = execSync('npm ls --all --parseable', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    // one path per resolved node; subtract 1 for the project root line
    const lines = out.split('\n').filter((l) => l.includes('node_modules'));
    return lines.length;
  } catch {
    // npm ls exits non-zero on peer-dep warnings; count node_modules dirs instead
    try {
      const out = execSync('find node_modules -name package.json -not -path "*/node_modules/*/node_modules/*"', {
        cwd, stdio: ['ignore', 'pipe', 'ignore'],
      }).toString();
      return out.split('\n').filter(Boolean).length;
    } catch { return -1; }
  }
}

function installSizeKb(cwd) {
  try {
    return parseInt(execSync('du -sk node_modules', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\t')[0], 10);
  } catch { return -1; }
}

function directDeps(name, version) {
  try {
    const out = execSync(`npm view ${name}@${version} dependencies --json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (!out) return 0;
    return Object.keys(JSON.parse(out)).length;
  } catch { return 0; }
}

const rows = [];
for (const name of targets) {
  let version = 'latest';
  try { version = execSync(`npm view ${name} version`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  const dir = mkdtempSync(join(tmpdir(), 'fp-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fp', private: true, version: '0.0.0' }));
  let resolved = -1, sizeKb = -1, direct = 0;
  try {
    execSync(`npm install ${name}@${version} --no-audit --no-fund --ignore-scripts`, { cwd: dir, stdio: 'ignore' });
    resolved = resolvedCount(dir);
    sizeKb = installSizeKb(dir);
    direct = directDeps(name, version);
  } catch (e) {
    // record failure but keep going
  }
  rows.push({ name, version, directDeps: direct, resolvedPackages: resolved, installSizeKb: sizeKb });
  console.error(`measured ${name}@${version}: direct=${direct} resolved=${resolved} size=${sizeKb}KB`);
}

rows.sort((a, b) => a.resolvedPackages - b.resolvedPackages);

const outDir = join(repoRoot, 'verification-artifacts', 'benchmarks');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'footprint.json'), JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, rows }, null, 2));

// Markdown table
const mb = (kb) => (kb < 0 ? 'n/a' : (kb / 1024).toFixed(1) + ' MB');
console.log('\n| Package | Version | Direct deps | Resolved packages | Install size |');
console.log('|---------|---------|------------:|------------------:|-------------:|');
for (const r of rows) {
  console.log(`| \`${r.name}\` | ${r.version} | ${r.directDeps} | ${r.resolvedPackages < 0 ? 'n/a' : r.resolvedPackages} | ${mb(r.installSizeKb)} |`);
}
console.log('\nFootprint only (not runtime performance). Reproduce: `node scripts/benchmark-footprint.mjs`.');
