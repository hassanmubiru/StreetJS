import fs from 'node:fs';
import path from 'node:path';

const pillars = ['realtime', 'queue', 'events', 'storage', 'gateway', 'workflow'];

for (const d of pillars) {
  const base = `packages/${d}`;
  const pj = JSON.parse(fs.readFileSync(`${base}/package.json`, 'utf8'));
  const exp = pj.exports || {};
  let bad = 0, checked = 0;
  const missing = [];
  const chk = (v) => {
    if (typeof v === 'string') {
      if (v.startsWith('./')) {
        checked++;
        if (!fs.existsSync(path.join(base, v))) { missing.push(v); bad++; }
      }
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) chk(v[k]);
    }
  };
  chk(exp);
  console.log(d.padEnd(9), 'export targets checked:', checked, 'missing:', bad, bad ? JSON.stringify(missing) : '');
}
