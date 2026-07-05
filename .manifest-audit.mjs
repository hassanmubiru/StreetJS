import fs from 'node:fs';
import path from 'node:path';

const dirs = fs.readdirSync('packages').sort();
let checkedPkgs = 0, brokenTargets = 0, missingEngines = 0, missingPub = 0, missingLicenseField = 0;
const problems = [];
for (const d of dirs) {
  const base = `packages/${d}`;
  const pjp = `${base}/package.json`;
  if (!fs.existsSync(pjp)) continue;
  const p = JSON.parse(fs.readFileSync(pjp, 'utf8'));
  if (p.private === true) continue;
  checkedPkgs++;
  // exports/main/types targets exist
  const seen = new Set(); let miss = [];
  const chk = (v) => {
    if (typeof v === 'string' && v.startsWith('./')) {
      if (seen.has(v)) return; seen.add(v);
      if (!fs.existsSync(path.join(base, v))) miss.push(v);
    } else if (v && typeof v === 'object') for (const k of Object.keys(v)) chk(v[k]);
  };
  chk(p.exports); chk(p.main); chk(p.types); chk(p.module); chk(p.bin);
  if (miss.length) { brokenTargets++; problems.push(`${p.name}: MISSING ${miss.join(', ')}`); }
  if (!p.engines || !p.engines.node) { missingEngines++; problems.push(`${p.name}: no engines.node`); }
  if (!p.publishConfig) { missingPub++; }
  if (!p.license) { missingLicenseField++; problems.push(`${p.name}: no license field`); }
}
console.log(`publishable packages audited: ${checkedPkgs}`);
console.log(`broken exports/main/types targets: ${brokenTargets}`);
console.log(`missing engines.node: ${missingEngines}`);
console.log(`missing publishConfig: ${missingPub}`);
console.log(`missing license field: ${missingLicenseField}`);
if (problems.length) { console.log('\n-- problems --'); for (const x of problems) console.log('  ', x); }
else console.log('\nAll manifests: entry targets resolve, engines + license present.');
