import fs from 'node:fs';
import { execSync } from 'node:child_process';

const dirs = fs.readdirSync('packages').sort();
let packOK = 0, packFail = 0; const packFails = [];
let live = 0, notPub = 0, conflict = 0, ahead = 0;
const conflicts = [], news = [];
for (const d of dirs) {
  const pjp = `packages/${d}/package.json`;
  if (!fs.existsSync(pjp)) continue;
  const p = JSON.parse(fs.readFileSync(pjp, 'utf8'));
  if (p.private === true) continue;
  // pack --dry-run
  try { execSync('npm pack --dry-run', { cwd: `packages/${d}`, stdio: 'ignore' }); packOK++; }
  catch { packFail++; packFails.push(p.name); }
  // registry state
  let pub = null;
  try { pub = execSync(`npm view ${p.name} version 2>/dev/null`, { encoding: 'utf8' }).trim(); } catch {}
  if (!pub) { notPub++; news.push(`${p.name}@${p.version}`); }
  else if (pub === p.version) { conflict++; conflicts.push(p.name); }
  else { ahead++; }
}
console.log(`pack --dry-run: OK=${packOK} FAIL=${packFail}${packFails.length ? ' -> ' + packFails.join(', ') : ''}`);
console.log(`\nregistry state:`);
console.log(`  NOT published (local version) : ${notPub}`);
console.log(`  already published (same ver)  : ${conflict}`);
console.log(`  local ver differs from npm    : ${ahead}`);
console.log(`\nNOT-yet-published (${news.length}):`);
console.log('  ' + news.join(', '));
