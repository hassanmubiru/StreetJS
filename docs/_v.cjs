const c = require('fs').readFileSync('/tmp/site.css', 'utf8');
const checks = [
  ['main-header dark bg', /\.main-header\s*\{[^}]*background-color:\s*var\(--bg\)\s*!important/],
  ['main-header dark border', /\.main-header\s*\{[^}]*border-bottom:\s*1px solid var\(--border\)\s*!important/],
  ['site-title:hover gradient removed', /\.site-title:hover\s*\{\s*background-image:\s*none\s*!important/],
  ['search-results dark', /\.search-results\s*\{[^}]*background:\s*var\(--elevated\)\s*!important/],
  ['search-input-wrap dark', /\.search-input-wrap\s*\{[^}]*background:\s*var\(--bg\)\s*!important/],
  ['nav-link fade removed', /\.nav-list-item \.nav-list-link\s*\{\s*background-image:\s*none\s*!important/],
  ['hr token fill', /hr\s*\{\s*background-color:\s*var\(--border\)\s*!important/],
];
let f = 0;
for (const [n, re] of checks) { const ok = re.test(c); if (!ok) f++; console.log((ok ? 'PASS ' : 'FAIL ') + n); }
console.log((checks.length - f) + '/' + checks.length + ' present in live CSS');
