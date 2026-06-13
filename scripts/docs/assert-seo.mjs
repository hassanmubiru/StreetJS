// Asserts the built Jekyll docs site contains the expected SEO artifacts.
// Run after `jekyll build` against the output dir:
//   SITE_DIR=docs/_site node scripts/docs/assert-seo.mjs
//
// Checks: sitemap.xml, robots.txt (→ sitemap), Open Graph + description meta on
// the home page, and the just-the-docs search index. Exits non-zero on failure.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SITE = process.env.SITE_DIR || 'docs/_site';
let failures = 0;
const ok = (n) => console.log('  ok  ' + n);
const fail = (n, why) => { failures++; console.log(`  FAIL ${n}: ${why}`); };

function fileExists(rel) {
  return existsSync(join(SITE, rel));
}
function read(rel) {
  return existsSync(join(SITE, rel)) ? readFileSync(join(SITE, rel), 'utf8') : '';
}

// 1. sitemap.xml (jekyll-sitemap)
fileExists('sitemap.xml')
  ? ok('sitemap.xml generated')
  : fail('sitemap.xml', 'missing — is jekyll-sitemap in plugins?');

// 2. robots.txt references the sitemap
const robots = read('robots.txt');
/sitemap/i.test(robots) ? ok('robots.txt references sitemap') : fail('robots.txt', 'missing or no Sitemap line');

// 3. home page SEO meta (jekyll-seo-tag)
const index = read('index.html');
/<meta property="og:title"/i.test(index) ? ok('og:title present') : fail('og:title', 'missing on home page');
/<meta property="og:description"|<meta name="description"/i.test(index)
  ? ok('description/og:description present')
  : fail('description', 'missing on home page');
/<meta name="twitter:card"/i.test(index) ? ok('twitter:card present') : fail('twitter:card', 'missing');
/"@context"\s*:\s*"https?:\/\/schema.org"/i.test(index) || /<script type="application\/ld\+json"/i.test(index)
  ? ok('structured data (JSON-LD) present')
  : fail('structured-data', 'no JSON-LD on home page');

// 4. docs search index (just-the-docs, search_enabled)
fileExists('assets/js/search-data.json')
  ? ok('docs search index generated')
  : fail('search-index', 'assets/js/search-data.json missing');

console.log(failures === 0 ? '\n✅ docs SEO assertions passed' : `\n❌ ${failures} SEO assertion(s) failed`);
process.exit(failures === 0 ? 0 : 1);
