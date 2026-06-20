const x = require('fs').readFileSync('/tmp/sitemap.xml', 'utf8');
const locs = [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
console.log('total URLs:', locs.length);
console.log('has lastmod:', /<lastmod>/.test(x));
console.log('has changefreq:', /<changefreq>/.test(x));
console.log('has priority:', /<priority>/.test(x));
const base = 'https://hassanmubiru.github.io/StreetJS/';
const bad = locs.filter(u => !u.startsWith(base));
console.log('\nwrong-domain/base URLs:', bad.length);
bad.slice(0, 10).forEach(u => console.log('  BAD:', u));
const sus = locs.filter(u => /README|AUDIT|REPORT|CERTIFICATION|ROLLBACK|RELEASE_CHECKLIST|GAP|READINESS|HARDENING|VERIFICATION|WORKFLOW|LEADERSHIP|strategy|launch|program|\.cjs/i.test(u));
console.log('\nsuspicious internal docs in sitemap:', sus.length);
sus.forEach(u => console.log('  ', u.replace(base, '/')));
// duplicates
const dup = locs.filter((u, i) => locs.indexOf(u) !== i);
console.log('\nduplicate URLs:', dup.length, dup.slice(0, 5));
// list first/last few normal
console.log('\nsample URLs:');
locs.slice(0, 8).forEach(u => console.log('  ', u.replace(base, '/') || '/'));
