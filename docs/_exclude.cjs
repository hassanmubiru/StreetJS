const fs = require('fs');
const files = [
  'ADOPTION-ENTERPRISE-GAP-CLOSURE.md', 'DEPLOYMENT-CERTIFICATION.md',
  'OBSERVABILITY-CERTIFICATION.md', 'PERFORMANCE-CERTIFICATION.md',
  'SECURITY-CERTIFICATION.md', 'PLATFORM-LEADERSHIP-ADOPTION-PROGRAM.md',
  'PRE-PRODUCTION-LAUNCH-READINESS.md', 'PRODUCTION-HARDENING-PROGRAM.md',
  'README-AUDIT.md', 'README.md', 'RUNTIME-STABILITY-VERIFICATION.md',
  'SECURITY-HARDENING.md', 'STREETJS-FULL-REPORT.md', 'STREETJS-GAP-ANALYSIS.md',
  'STREETJS-READINESS-ASSESSMENT.md', 'WEBSITE-SEO-ADOPTION-AUDIT.md',
  'WORKFLOW-AUDIT.md', 'architecture-report.md', 'broken-links-report.md',
  'documentation-audit.md', 'seo-strategy.md',
  'case-studies/README.md', 'community/README.md', 'compliance/README.md',
  'sustainability/README.md',
];
let changed = 0, skipped = 0;
for (const rel of files) {
  const p = 'docs/' + rel;
  if (!fs.existsSync(p)) { console.log('MISS  ' + rel); continue; }
  let t = fs.readFileSync(p, 'utf8');
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) { console.log('NO-FM ' + rel); continue; }
  let fm = m[1];
  let add = [];
  if (!/^sitemap:/m.test(fm)) add.push('sitemap:     false');
  if (!/^noindex:/m.test(fm)) add.push('noindex:     true');
  if (add.length === 0) { skipped++; console.log('SKIP  ' + rel + ' (already set)'); continue; }
  // insert after the first line of front-matter (the layout line)
  const newFm = fm + '\n' + add.join('\n');
  t = t.replace(m[1], newFm);
  fs.writeFileSync(p, t);
  changed++;
  console.log('OK    ' + rel + '  +[' + add.join(', ') + ']');
}
console.log(`\nchanged ${changed}, skipped ${skipped}`);
