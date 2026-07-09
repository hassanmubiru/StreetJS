// Asserts the built Jekyll docs site's sitemap/robots/noindex signals are clean:
// internal/working docs are excluded from sitemap.xml and noindexed (while
// staying reachable by URL), genuine public pages remain in the sitemap, and
// sitemap.xml/robots.txt stay valid. Run after `jekyll build` against the
// output dir:
//   SITE_DIR=docs/_site node scripts/docs/assert-sitemap-cleanliness.mjs
//
// Requirements: 5.1, 5.2, 5.3, 5.4

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SITE = process.env.SITE_DIR || 'docs/_site';
const SITE_URL = 'https://hassanmubiru.github.io/StreetJS';
let failures = 0;
const ok = (n) => console.log('  ok  ' + n);
const fail = (n, why) => { failures++; console.log(`  FAIL ${n}: ${why}`); };

function fileExists(rel) {
  return existsSync(join(SITE, rel));
}
function read(rel) {
  return existsSync(join(SITE, rel)) ? readFileSync(join(SITE, rel), 'utf8') : '';
}

// The 16 pages that must be excluded from the sitemap (permalink + built-file
// path relative to SITE, per each file's actual front matter / Jekyll default
// permalink derivation):
//   - 5 files from task 1 with no prior front matter (default .html permalink)
//   - 4 files from task 2 that already had front matter with an explicit permalink
//   - docs/showcase/crm-roadmap.md (sitemap-excluded, but NOT noindexed — see below)
//   - 6 comparisons/*.md redirect stubs (explicit permalink)
const EXCLUDED_PAGES = [
  { permalink: '/GOOD-FIRST-ISSUES.html', file: 'GOOD-FIRST-ISSUES.html', checkNoindex: true },
  { permalink: '/INDEX.html', file: 'INDEX.html', checkNoindex: true },
  { permalink: '/PLUGIN-MARKETPLACE.html', file: 'PLUGIN-MARKETPLACE.html', checkNoindex: true },
  { permalink: '/integrations/marzpay-research.html', file: 'integrations/marzpay-research.html', checkNoindex: true },
  { permalink: '/audits/2026-07-06-release-readiness-audit.html', file: 'audits/2026-07-06-release-readiness-audit.html', checkNoindex: true },
  { permalink: '/adoption/adoption-scorecard/', file: 'adoption/adoption-scorecard/index.html', checkNoindex: true },
  { permalink: '/adoption/go-to-market-roadmap/', file: 'adoption/go-to-market-roadmap/index.html', checkNoindex: true },
  { permalink: '/platform-leadership/', file: 'platform-leadership/index.html', checkNoindex: true },
  { permalink: '/architecture-decision-records/0001-mysql-detection-seam.html', file: 'architecture-decision-records/0001-mysql-detection-seam.html', checkNoindex: true },
  // Borderline page: sitemap-excluded but intentionally NOT noindexed (stays
  // reachable/linked from showcase/crm.md as historical context).
  { permalink: '/showcase/crm-roadmap/', file: 'showcase/crm-roadmap/index.html', checkNoindex: false },
  { permalink: '/comparisons/', file: 'comparisons/index.html', checkNoindex: true },
  { permalink: '/comparisons/streetjs-vs-adonisjs/', file: 'comparisons/streetjs-vs-adonisjs/index.html', checkNoindex: true },
  { permalink: '/comparisons/streetjs-vs-express/', file: 'comparisons/streetjs-vs-express/index.html', checkNoindex: true },
  { permalink: '/comparisons/streetjs-vs-fastify/', file: 'comparisons/streetjs-vs-fastify/index.html', checkNoindex: true },
  { permalink: '/comparisons/streetjs-vs-nestjs/', file: 'comparisons/streetjs-vs-nestjs/index.html', checkNoindex: true },
  { permalink: '/comparisons/why-streetjs/', file: 'comparisons/why-streetjs/index.html', checkNoindex: true },
];

// A sample of genuine public pages that must remain in the sitemap.
const PUBLIC_PAGES = [
  '/getting-started/',
  '/plugins/',
  '/compliance/control-mappings.html',
  '/enterprise/risk-assessment/',
];

const sitemap = read('sitemap.xml');
const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

// 1. Excluded pages must NOT appear in sitemap.xml
if (locs.length === 0) {
  fail('sitemap.xml', 'missing or contains no <loc> entries');
} else {
  for (const { permalink } of EXCLUDED_PAGES) {
    const url = SITE_URL + permalink;
    locs.includes(url)
      ? fail('excluded-from-sitemap', `${permalink} unexpectedly present in sitemap.xml`)
      : ok(`${permalink} excluded from sitemap.xml`);
  }
}

// 2. Genuine public pages must appear in sitemap.xml
for (const permalink of PUBLIC_PAGES) {
  const url = SITE_URL + permalink;
  locs.includes(url)
    ? ok(`${permalink} present in sitemap.xml`)
    : fail('public-page-in-sitemap', `${permalink} missing from sitemap.xml`);
}

// 3. No duplicate <loc> values
const dupes = locs.filter((loc, i) => locs.indexOf(loc) !== i);
dupes.length === 0
  ? ok('sitemap.xml has no duplicate <loc> values')
  : fail('sitemap-duplicates', `duplicate <loc> values: ${[...new Set(dupes)].join(', ')}`);

// 4. robots.txt references the sitemap at the correct domain
const robots = read('robots.txt');
robots.includes(`Sitemap: ${SITE_URL}/sitemap.xml`)
  ? ok('robots.txt references sitemap at correct domain')
  : fail('robots.txt', `missing "Sitemap: ${SITE_URL}/sitemap.xml" line`);

// 5. Excluded pages remain reachable by URL and (except crm-roadmap) are noindexed
for (const { permalink, file, checkNoindex } of EXCLUDED_PAGES) {
  if (!fileExists(file)) {
    fail('excluded-page-reachable', `${permalink} — built file missing at ${file}`);
    continue;
  }
  ok(`${permalink} reachable (built file exists)`);

  if (checkNoindex) {
    const html = read(file);
    // head_custom.html emits "noindex, follow" (with space); the redirect
    // layout (used by the comparisons/* stubs) emits its own "noindex,follow"
    // (no space) — both satisfy R5.2's "remain reachable, but not indexed".
    /<meta name="robots" content="noindex,\s*follow">/.test(html)
      ? ok(`${permalink} emits noindex meta tag`)
      : fail('noindex-meta', `${permalink} missing <meta name="robots" content="noindex, follow">`);
  }
}

console.log(failures === 0 ? '\n✅ docs sitemap-cleanliness assertions passed' : `\n❌ ${failures} sitemap-cleanliness assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
