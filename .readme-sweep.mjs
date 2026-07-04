// README doc sweep: for each pillar, extract named imports from README code
// fences that import the package itself, and verify each identifier is a real
// export of the built package. Reports any documented-but-missing exports.
import fs from 'node:fs';

const pillars = ['realtime', 'queue', 'events', 'storage', 'gateway', 'workflow'];

// import { A, B as C, type D } from '<spec>'  and  import Default from '<spec>'
const importRe = /import\s+(type\s+)?(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g;

for (const p of pillars) {
  const pkgName = `@streetjs/${p}`;
  const readme = `packages/${p}/README.md`;
  if (!fs.existsSync(readme)) { console.log(`${p}: (no README)`); continue; }
  const text = fs.readFileSync(readme, 'utf8');

  // Real exports of the package's public entry + known subpaths.
  const mod = await import(pkgName).catch((e) => ({ __err: e.message }));
  if (mod.__err) { console.log(`${p}: IMPORT FAIL ${mod.__err}`); continue; }
  const realExports = new Set(Object.keys(mod));

  const named = new Set();
  let m;
  while ((m = importRe.exec(text)) !== null) {
    const spec = m[4];
    // Only check imports from THIS package (ignore subpath ./testing etc. and streetjs)
    if (spec !== pkgName) continue;
    if (m[2]) named.add(m[2].trim()); // default import name (rare)
    if (m[3]) {
      for (let part of m[3].split(',')) {
        part = part.trim().replace(/^type\s+/, '');
        if (!part) continue;
        const asName = part.split(/\s+as\s+/)[0].trim();
        if (asName) named.add(asName);
      }
    }
  }

  const missing = [...named].filter((n) => !realExports.has(n));
  console.log(`${p.padEnd(9)} pkg=${pkgName}  README named-imports checked=${named.size}  missing=${missing.length}${missing.length ? ' -> ' + JSON.stringify(missing) : ''}`);
}
