const c = require('fs').readFileSync('/tmp/site.css', 'utf8');
const checks = [
  ['table td transparent bg', /\.main-content table[^{}]*\}[\s\S]*?td\s*\{[^}]*background-color:\s*transparent\s*!important/],
  ['table th transparent bg', /th\s*\{[^}]*background-color:\s*transparent\s*!important/],
  ['table elevated surface', /\.main-content table\s*\{[^}]*background:\s*var\(--elevated\)\s*!important/],
  ['btn guarded surface bg', /\.btn:not\(\.btn-primary\)[^{]*\{[^}]*background-color:\s*var\(--surface-2\)/],
  ['search-button dark', /\.search-button\s*\{[^}]*background-color:\s*var\(--elevated\)\s*!important/],
  ['div.opaque dark', /div\.opaque\s*\{[^}]*background-color:\s*var\(--bg\)\s*!important/],
  ['skip-to-main dark', /a\.skip-to-main:focus[^{]*\{[^}]*background-color:\s*var\(--elevated\)\s*!important/],
  ['bg-grey-lt-000 token', /\.bg-grey-lt-000\s*\{[^}]*background-color:\s*var\(--surface\)\s*!important/],
];
let f = 0;
for (const [n, re] of checks) { const ok = re.test(c); if (!ok) f++; console.log((ok ? 'PASS ' : 'FAIL ') + n); }
console.log((checks.length - f) + '/' + checks.length + ' present in live CSS');
