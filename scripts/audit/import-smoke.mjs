// Runtime import smoke test: resolve each workspace package's published entry
// (exports["."].import || module || main) and dynamic-import it in Node. Catches
// broken imports/exports, invalid entrypoints, and load-time circular deps.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2] ?? '.');
const pkgsDir = join(root, 'packages');
const results = [];

function entryOf(pkgDir, pkg) {
  const exp = pkg.exports?.['.'];
  const cand =
    (typeof exp === 'string' ? exp : exp?.import ?? exp?.default ?? exp?.node) ??
    pkg.module ?? pkg.main;
  return cand ? join(pkgDir, cand) : null;
}

for (const name of readdirSync(pkgsDir)) {
  const pkgDir = join(pkgsDir, name);
  const pjPath = join(pkgDir, 'package.json');
  if (!existsSync(pjPath)) continue;
  const pkg = JSON.parse(readFileSync(pjPath, 'utf8'));
  if (pkg.private) { results.push([pkg.name ?? name, 'SKIP', 'private']); continue; }
  const entry = entryOf(pkgDir, pkg);
  if (!entry) { results.push([pkg.name ?? name, 'SKIP', 'no entry field']); continue; }
  if (!existsSync(entry)) { results.push([pkg.name ?? name, 'SKIP', `not built (no ${entry.split('/').slice(-2).join('/')})`]); continue; }
  try {
    const mod = await import(pathToFileURL(entry).href);
    const keys = Object.keys(mod).length;
    results.push([pkg.name ?? name, 'OK', `${keys} exports`]);
  } catch (err) {
    results.push([pkg.name ?? name, 'FAIL', String(err?.message ?? err).split('\n')[0]]);
  }
}

let ok = 0, fail = 0, skip = 0;
for (const [n, s, d] of results) {
  if (s === 'OK') ok++; else if (s === 'FAIL') fail++; else skip++;
  console.log(`${s.padEnd(4)} ${n.padEnd(34)} ${d}`);
}
console.log(`\nSUMMARY ok=${ok} fail=${fail} skip=${skip} total=${results.length}`);
process.exit(fail > 0 ? 1 : 0);
