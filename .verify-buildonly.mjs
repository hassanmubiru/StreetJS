import fs from 'node:fs';
import path from 'node:path';

// core-compat is named @streetjs/core; the 7 build-only plugins by dir.
const targets = [
  { dir: 'core-compat', name: '@streetjs/core' },
  { dir: 'edge', name: '@streetjs/edge' },
  { dir: 'plugin-auth0', name: '@streetjs/plugin-auth0' },
  { dir: 'plugin-r2', name: '@streetjs/plugin-r2' },
  { dir: 'plugin-s3', name: '@streetjs/plugin-s3' },
  { dir: 'plugin-sendgrid', name: '@streetjs/plugin-sendgrid' },
  { dir: 'plugin-stripe', name: '@streetjs/plugin-stripe' },
  { dir: 'plugin-twilio', name: '@streetjs/plugin-twilio' },
];

for (const { dir, name } of targets) {
  const base = `packages/${dir}`;
  const p = JSON.parse(fs.readFileSync(`${base}/package.json`, 'utf8'));
  // 1) manifest entry targets exist
  let miss = 0, ck = 0; const seen = new Set();
  const chk = (v) => {
    if (typeof v === 'string' && v.startsWith('./')) {
      if (seen.has(v)) return; seen.add(v); ck++;
      if (!fs.existsSync(path.join(base, v))) { console.log(`  MISSING ${dir}:`, v); miss++; }
    } else if (v && typeof v === 'object') { for (const k of Object.keys(v)) chk(v[k]); }
  };
  chk(p.exports); chk(p.main); chk(p.types);
  // 2) importable
  let imp = 'OK', n = 0;
  try { const m = await import(name); n = Object.keys(m).length; }
  catch (e) { imp = 'IMPORT FAIL: ' + e.message; }
  console.log(`${name.padEnd(24)} targets:${String(ck).padStart(3)} missing:${miss}  import:${imp}${imp === 'OK' ? ' exports:' + n : ''}`);
}
