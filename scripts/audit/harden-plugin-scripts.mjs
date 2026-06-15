// One-shot: harden plugin package.json scripts so signing happens ONLY at publish.
//  build         -> "tsc"                                   (never signs)
//  prepublishOnly-> "npm run clean && npm run build && npm run sign"
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'packages';
let changed = 0;
for (const name of readdirSync(dir)) {
  if (!name.startsWith('plugin-')) continue;
  const pj = join(dir, name, 'package.json');
  if (!existsSync(pj)) continue;
  const pkg = JSON.parse(readFileSync(pj, 'utf8'));
  const s = pkg.scripts ?? {};
  if (!s.sign) continue; // only plugins that sign
  s.build = 'tsc';
  s.prepublishOnly = 'npm run clean && npm run build && npm run sign';
  pkg.scripts = s;
  writeFileSync(pj, JSON.stringify(pkg, null, 2) + '\n');
  changed++;
}
console.log(`updated ${changed} plugin package.json files`);
