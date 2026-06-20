const fs = require('fs');
const h = fs.readFileSync('/tmp/home.html', 'utf8');
const checks = {
  'hero headline': h.includes('The TypeScript Framework for Modern Backend Applications'),
  'hero subheadline': h.includes('background jobs and AI integrations'),
  'copy command block': h.includes('npx @streetjs/cli create my-app'),
  'copy button': h.includes('cmd-copy'),
  'code example controller': h.includes("@Controller('/users')") || h.includes('@Controller(&#39;/users&#39;)') || h.includes('UsersController'),
  'feature badge Routing': h.includes('>Routing<'),
  'feature badge Validation': h.includes('>Validation<'),
  'why section': h.includes('Why StreetJS'),
  'Background Jobs card': h.includes('Background Jobs'),
  'AI Integrations card': h.includes('AI Integrations'),
  'Ecosystem section': h.includes('>Ecosystem<') || h.includes('Ecosystem'),
  'Final CTA': h.includes('Build production applications faster') || h.includes('Build Production Applications Faster'),
  'View all examples': h.includes('View all examples'),
  'no batteries phrase': !/batteries[- ]included/i.test(h),
  'no shields badge row': !h.includes('img.shields.io/npm/v/streetjs'),
  'old "without the bloat" gone': !h.includes('without the bloat'),
};
let pass = 0, fail = 0;
for (const [k, v] of Object.entries(checks)) {
  console.log((v ? 'PASS ' : 'FAIL ') + k);
  v ? pass++ : fail++;
}
console.log(`\n${pass} passed, ${fail} failed`);
