const fs = require('fs');
const files = [
  'ADOPTION-ENTERPRISE-GAP-CLOSURE.md','DEPLOYMENT-CERTIFICATION.md','OBSERVABILITY-CERTIFICATION.md',
  'PERFORMANCE-CERTIFICATION.md','SECURITY-CERTIFICATION.md','PLATFORM-LEADERSHIP-ADOPTION-PROGRAM.md',
  'PRE-PRODUCTION-LAUNCH-READINESS.md','PRODUCTION-HARDENING-PROGRAM.md','README-AUDIT.md','README.md',
  'RUNTIME-STABILITY-VERIFICATION.md','SECURITY-HARDENING.md','STREETJS-FULL-REPORT.md','STREETJS-GAP-ANALYSIS.md',
  'STREETJS-READINESS-ASSESSMENT.md','WEBSITE-SEO-ADOPTION-AUDIT.md','WORKFLOW-AUDIT.md','architecture-report.md',
  'broken-links-report.md','documentation-audit.md','seo-strategy.md','case-studies/README.md','community/README.md',
  'compliance/README.md','sustainability/README.md',
];
let bad = 0;
for (const rel of files) {
  const t = fs.readFileSync('docs/' + rel, 'utf8');
  const m = t.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fmOK = !!m;
  const hasS = m && /^sitemap:\s+false\s*$/m.test(m[1]);
  const hasN = m && /^noindex:\s+true\s*$/m.test(m[1]);
  if (!(fmOK && hasS && hasN)) { bad++; console.log('BAD  ' + rel + ' fm=' + fmOK + ' sitemap=' + hasS + ' noindex=' + hasN); }
}
console.log(bad === 0 ? `ALL ${files.length} files OK (front-matter valid, sitemap:false + noindex:true inside)` : `${bad} files have issues`);
