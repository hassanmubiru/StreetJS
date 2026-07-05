// For each non-private workspace package, compare local version vs the version
// published on npm. Flags: NEW (not on npm), CONFLICT (local == published → 403),
// or PUBLISHABLE (local newer / differs).
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const dirs = fs.readdirSync('packages').sort();
const rows = [];
for (const d of dirs) {
  const pj = `packages/${d}/package.json`;
  if (!fs.existsSync(pj)) continue;
  const p = JSON.parse(fs.readFileSync(pj, 'utf8'));
  if (p.private === true) continue;
  const name = p.name, local = p.version;
  let published = null;
  try {
    published = execSync(`npm view ${name} version 2>/dev/null`, { encoding: 'utf8' }).trim();
  } catch { published = null; }
  let status;
  if (!published) status = 'NEW (not on npm)';
  else if (published === local) status = `CONFLICT (npm has ${published})`;
  else status = `differs (npm ${published} / local ${local})`;
  rows.push({ name, local, published: published || '-', status });
}
const conflicts = rows.filter(r => r.status.startsWith('CONFLICT'));
const news = rows.filter(r => r.status.startsWith('NEW'));
const diffs = rows.filter(r => r.status.startsWith('differs'));
console.log(`\n== NEW — publishable as-is (${news.length}) ==`);
for (const r of news) console.log('  ', r.name.padEnd(30), r.local);
console.log(`\n== CONFLICT — version already on npm, will 403 (${conflicts.length}) ==`);
for (const r of conflicts) console.log('  ', r.name.padEnd(30), 'local', r.local, '=', 'npm');
console.log(`\n== DIFFERS — local vs npm mismatch (${diffs.length}) ==`);
for (const r of diffs) console.log('  ', r.name.padEnd(30), r.status);
