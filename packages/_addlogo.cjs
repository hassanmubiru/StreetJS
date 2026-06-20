const fs = require('fs');
const path = require('path');
const RAW = 'https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png';
const block = `<p align="center">\n  <img src="${RAW}" alt="StreetJS logo" width="100" height="100">\n</p>\n\n`;

const pkgs = fs.readdirSync('packages').filter(d => fs.statSync(path.join('packages', d)).isDirectory());
let added = 0, skipped = 0, missing = 0;
for (const d of pkgs) {
  if (d === 'core') { skipped++; continue; }           // already has full logo header
  const rp = path.join('packages', d, 'README.md');
  if (!fs.existsSync(rp)) { missing++; console.log('NO-README ' + d); continue; }
  let t = fs.readFileSync(rp, 'utf8');
  if (t.includes('logo-512.png')) { skipped++; console.log('SKIP (has logo) ' + d); continue; }
  t = block + t.replace(/^\uFEFF/, '');
  fs.writeFileSync(rp, t);
  added++;
  console.log('OK ' + d);
}
console.log(`\nadded ${added}, skipped ${skipped}, missing ${missing}`);
