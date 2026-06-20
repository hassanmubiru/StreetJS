const fs = require('fs');
const files = [
  'certification.md',
  'runtime-certification.md',
  'ecosystem/plugin-certification.md',
  'adoption/tutorials-and-examples-program.md',
];
let changed = 0;
for (const rel of files) {
  const p = 'docs/' + rel;
  let t = fs.readFileSync(p, 'utf8');
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) { console.log('NO-FM ' + rel); continue; }
  let add = [];
  if (!/^sitemap:/m.test(m[1])) add.push('sitemap:     false');
  if (!/^noindex:/m.test(m[1])) add.push('noindex:     true');
  if (!add.length) { console.log('SKIP  ' + rel); continue; }
  t = t.replace(m[1], m[1] + '\n' + add.join('\n'));
  fs.writeFileSync(p, t);
  changed++;
  console.log('OK    ' + rel + '  +[' + add.join(', ') + ']');
}
console.log('changed ' + changed);
