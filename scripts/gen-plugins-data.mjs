#!/usr/bin/env node
// scripts/gen-plugins-data.mjs
// Generates the plugin-marketplace data + pages from the real plugin packages.
// Source of truth = packages/plugin-*/package.json. Dependency-free; safe to run
// in CI before `jekyll build`. Re-run on any plugin add/version change.
//
// Outputs:
//   docs/_data/plugins.json                      marketplace data (committed)
//   docs/plugins/category/<cat>.md               one SEO page per category
//   docs/plugins/registry/<slug>.md              one detail page per plugin (/plugins/<slug>/)
//
// Run: node scripts/gen-plugins-data.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgsDir = join(root, 'packages');
const dataDir = join(root, 'docs', '_data');
const catDir = join(root, 'docs', 'plugins', 'category');
const regDir = join(root, 'docs', 'plugins', 'registry');

const CATEGORIES = [
  ['Database', /postgres|mysql|mongodb|sqlite|database|sql/i],
  ['Cache & KV', /redis|cache|key-value/i],
  ['Messaging', /kafka|rabbitmq|nats|amqp|queue|pubsub|messaging|streaming/i],
  ['Storage', /\bs3\b|r2|storage|object-storage|bucket/i],
  ['Payments', /stripe|paypal|billing|payments?/i],
  ['Auth & Identity', /auth0|clerk|firebase|supabase|oauth|identity|auth/i],
  ['Communications', /twilio|sendgrid|africastalking|sms|email|voice|notification/i],
  ['AI', /openai|ai|llm|embedding/i],
];
const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const yamlEsc = (s) => String(s).replace(/"/g, '\\"');

function categorize(name, keywords) {
  const hay = name + ' ' + (keywords || []).join(' ');
  for (const [cat, re] of CATEGORIES) if (re.test(hay)) return cat;
  return 'Other';
}

const dirs = readdirSync(pkgsDir).filter((d) => d.startsWith('plugin-'));
const plugins = [];
for (const d of dirs) {
  const pjPath = join(pkgsDir, d, 'package.json');
  if (!existsSync(pjPath)) continue;
  const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
  if (pj.private) continue;
  const short = pj.name.replace('@streetjs/plugin-', '');
  plugins.push({
    name: pj.name,
    slug: short,
    title: short.replace(/(^|-)([a-z])/g, (_, s, c) => (s ? ' ' : '') + c.toUpperCase()).trim(),
    description: (pj.description || '').replace(/\s*Signed manifest.*$/i, '').trim(),
    version: pj.version,
    category: categorize(pj.name, pj.keywords),
    catSlug: slugify(categorize(pj.name, pj.keywords)),
    tier: 'Official',
    npm: `https://www.npmjs.com/package/${pj.name}`,
    keywords: pj.keywords || [],
  });
}
plugins.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
const categories = [...new Set(plugins.map((p) => p.category))].sort();

// ── 1. data file ─────────────────────────────────────────────────────────────
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
writeFileSync(
  join(dataDir, 'plugins.json'),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: plugins.length, categories, plugins }, null, 2) + '\n',
);

// ── 2. category pages (clean dir first so removed categories don't linger) ─────
rmSync(catDir, { recursive: true, force: true });
mkdirSync(catDir, { recursive: true });
for (const cat of categories) {
  const cslug = slugify(cat);
  const inCat = plugins.filter((p) => p.category === cat);
  const fm = [
    '---',
    'layout:      default',
    `title:       "${yamlEsc(cat)} Plugins"`,
    `permalink:   /plugins/category/${cslug}/`,
    'nav_exclude: true',
    `description:  "Official StreetJS ${yamlEsc(cat)} plugins — signed, dependency-free, installable from npm."`,
    '---',
    '',
  ].join('\n');
  const rows = inCat
    .map((p) => `| [${p.name}](/StreetJS/plugins/${p.slug}/) | ${p.description} | \`v${p.version}\` | [npm](${p.npm}) |`)
    .join('\n');
  const body = [
    `# ${cat} Plugins`,
    '',
    `${inCat.length} official ${cat} plugin${inCat.length === 1 ? '' : 's'} for StreetJS. All are signed, dependency-free, and installable from npm. See the full [Plugin Marketplace](/StreetJS/plugins/marketplace/).`,
    '',
    '| Plugin | Description | Version | Links |',
    '|--------|-------------|---------|-------|',
    rows,
    '',
  ].join('\n');
  writeFileSync(join(catDir, `${cslug}.md`), fm + body);
}

// ── 3. per-plugin detail pages ────────────────────────────────────────────────
rmSync(regDir, { recursive: true, force: true });
mkdirSync(regDir, { recursive: true });
for (const p of plugins) {
  const cslug = slugify(p.category);
  const fm = [
    '---',
    'layout:      default',
    `title:       "${yamlEsc(p.name)}"`,
    `permalink:   /plugins/${p.slug}/`,
    'nav_exclude: true',
    `description:  "${yamlEsc(p.description)} Official, signed, dependency-free StreetJS plugin — install from npm."`,
    '---',
    '',
    '<script type="application/ld+json">',
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareSourceCode',
      name: p.name,
      description: p.description,
      codeRepository: 'https://github.com/hassanmubiru/StreetJS',
      programmingLanguage: 'TypeScript',
      runtimePlatform: 'Node.js >= 20',
      softwareVersion: p.version,
      license: 'https://opensource.org/licenses/MIT',
      isPartOf: { '@type': 'SoftwareApplication', name: 'StreetJS', applicationCategory: 'DeveloperApplication' },
    }),
    '</script>',
    '',
  ].join('\n');
  const body = [
    `# ${p.name}`,
    '',
    `**${p.description}**`,
    '',
    `- **Category:** [${p.category}](/StreetJS/plugins/category/${cslug}/)`,
    `- **Tier:** ${p.tier} (signed manifest, dependency-free)`,
    `- **Version:** \`v${p.version}\``,
    `- **npm:** [${p.name}](${p.npm})`,
    '',
    '## Install',
    '',
    '```bash',
    `npm install ${p.name}`,
    '```',
    '',
    '## Usage',
    '',
    'Register the plugin with the StreetJS plugin host. See the [Plugin System](/StreetJS/plugins/) guide for the full registration, capability, and signature-verification model, and the package README on npm for plugin-specific configuration.',
    '',
    `Browse more in the [Plugin Marketplace](/StreetJS/plugins/marketplace/) or other [${p.category}](/StreetJS/plugins/category/${cslug}/) plugins.`,
    '',
  ].join('\n');
  writeFileSync(join(regDir, `${p.slug}.md`), fm + body);
}

console.log(`Wrote plugins.json (${plugins.length} plugins), ${categories.length} category pages, ${plugins.length} detail pages.`);
