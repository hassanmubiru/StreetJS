// Approximate GitHub Linguist accounting: sum bytes of tracked files by extension
// and by top-level area. Linguist counts tracked, non-excluded files on the
// default branch; .gitignored paths (e.g. dist/) are already untracked.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const files = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n').filter(Boolean);

// Linguist language-ish mapping by extension (subset we care about)
const LANG = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.sh': 'Shell', '.hbs': 'Handlebars', '.handlebars': 'Handlebars',
  '.md': 'Markdown', '.json': 'JSON', '.yml': 'YAML', '.yaml': 'YAML',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.go': 'Go',
};

function bytes(f) { try { return fs.statSync(f).size; } catch { return 0; } }

const byLang = {};
const jsByDir = {};       // top-2-level dir -> js bytes
const jsFiles = [];       // {f, size}
let tsTotal = 0, jsTotal = 0;

for (const f of files) {
  const ext = path.extname(f).toLowerCase();
  const lang = LANG[ext];
  if (!lang) continue;
  const sz = bytes(f);
  byLang[lang] = (byLang[lang] || 0) + sz;
  if (lang === 'TypeScript') tsTotal += sz;
  if (lang === 'JavaScript') {
    jsTotal += sz;
    jsFiles.push({ f, size: sz });
    const parts = f.split('/');
    const key = parts.slice(0, 2).join('/');
    jsByDir[key] = (jsByDir[key] || 0) + sz;
  }
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
// Programming-language % (Linguist excludes prose like Markdown from the bar? It includes Markdown as a language but it's data/prose; the bar shows all detected languages). We'll report both raw and code-only.
const codeLangs = ['TypeScript', 'JavaScript', 'Shell', 'Handlebars', 'Go', 'CSS', 'SCSS', 'HTML'];
let codeTotal = 0; for (const l of codeLangs) codeTotal += byLang[l] || 0;

console.log('=== Tracked bytes by language ===');
for (const [l, b] of Object.entries(byLang).sort((a, c) => c[1] - a[1])) {
  console.log(`${l.padEnd(12)} ${kb(b).padStart(12)}`);
}
console.log('\n=== TS vs JS (code-only subset incl. Shell/Hbs/Go/CSS/HTML) ===');
console.log('code total:', kb(codeTotal));
console.log('TypeScript %:', (tsTotal / codeTotal * 100).toFixed(1));
console.log('JavaScript %:', (jsTotal / codeTotal * 100).toFixed(1));

console.log('\n=== JavaScript bytes by top-2 dir (largest first) ===');
for (const [d, b] of Object.entries(jsByDir).sort((a, c) => c[1] - a[1])) {
  console.log(`${kb(b).padStart(12)}  ${d}`);
}

console.log('\n=== Top 25 individual JS files ===');
jsFiles.sort((a, c) => c.size - a.size);
for (const { f, size } of jsFiles.slice(0, 25)) console.log(`${kb(size).padStart(10)}  ${f}`);
console.log(`\ntotal tracked JS files: ${jsFiles.length}`);
