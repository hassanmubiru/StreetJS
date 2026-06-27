// scripts/test-plugins-offline.mjs
// Reproducible offline test runner for the official plugin packages.
//
// Builds @streetjs/core (which every plugin imports), then builds and runs the
// node:test suite for each packages/plugin-* that declares a `test` script.
// Offline only — no network, no service containers. Exits non-zero if any
// plugin fails to build or test, so it is usable as a CI gate.
//
// Usage: npm run test:plugins-offline
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgsDir = join(repoRoot, 'packages');

function run(args) {
  execFileSync('npm', args, { cwd: repoRoot, stdio: 'inherit' });
}
function hasTestScript(dir) {
  const pj = join(pkgsDir, dir, 'package.json');
  if (!existsSync(pj)) return false;
  try {
    const s = JSON.parse(readFileSync(pj, 'utf8')).scripts ?? {};
    return typeof s.test === 'string' && s.test.trim() !== '';
  } catch { return false; }
}

const plugins = readdirSync(pkgsDir)
  .filter((d) => d.startsWith('plugin-') && hasTestScript(d))
  .sort();

console.log(`Building @streetjs/core …`);
run(['run', 'build', '-w', 'packages/core']);

const passed = [];
const failed = [];
for (const p of plugins) {
  const ws = `packages/${p}`;
  console.log(`\n──────── ${p} ────────`);
  try {
    run(['run', 'build', '-w', ws]);
    run(['test', '-w', ws]);
    passed.push(p);
  } catch {
    failed.push(p);
  }
}

console.log(`\n════════ plugin offline test summary ════════`);
console.log(`passed: ${passed.length}/${plugins.length} — ${passed.join(', ')}`);
if (failed.length) {
  console.error(`FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('All plugin offline suites passed.');
