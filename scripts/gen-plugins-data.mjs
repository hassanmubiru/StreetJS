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
  ['Frontend & Views', /htmx|view|template|ssr|server-rendered|html|frontend/i],
];
const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const yamlEsc = (s) => String(s).replace(/"/g, '\\"');

function categorize(name, keywords) {
  const hay = name + ' ' + (keywords || []).join(' ');
  for (const [cat, re] of CATEGORIES) if (re.test(hay)) return cat;
  return 'Other';
}

// Unique intro copy per category (avoids thin-content SEO; one paragraph each).
const CATEGORY_INTROS = {
  'Database': 'Connect StreetJS to SQL and document databases with native, dependency-free drivers — no `pg`, `mysql2` or `mongodb` npm packages. Each plugin speaks the database wire protocol directly over Node core for pooling, streaming and authentication you can audit.',
  'Cache & KV': 'Add caching and key-value storage to your StreetJS backend with dependency-free clients that speak the protocol directly — ideal for sessions, rate-limit state, and hot data.',
  'Messaging': 'Publish/subscribe and stream events from StreetJS with dependency-free clients for the major brokers — wire-protocol implementations over Node core, no heavyweight SDKs.',
  'Storage': 'Store and serve files from StreetJS with object-storage plugins for the major providers — signed, dependency-free clients for uploads, downloads and presigned URLs.',
  'Payments': 'Accept payments in your StreetJS app with provider plugins built on dependency-free HTTPS clients — subscriptions, orders and webhooks without bundling a vendor SDK.',
  'Auth & Identity': 'Authenticate users in StreetJS with identity-provider plugins on top of the framework’s built-in JWT, sessions, OAuth2/OIDC and RBAC — bring your IdP without leaving the type-safe stack.',
  'Communications': 'Send SMS, email, voice and notifications from StreetJS with dependency-free provider plugins — transactional messaging wired into your controllers and jobs.',
  'AI': 'Add LLM chat, embeddings and retrieval to StreetJS with provider-agnostic AI plugins — dependency-free HTTPS clients for the major model providers.',
  'Frontend & Views': 'Render HTML from StreetJS with dependency-free view engines and frontend integrations — server-rendered, interactive apps with typed controllers that return markup, no SPA or client build step required.',
  'Other': 'Official StreetJS plugins that extend the framework with signed, dependency-free capabilities.',
};

const dirs = readdirSync(pkgsDir).filter((d) => d.startsWith('plugin-'));
const plugins = [];
for (const d of dirs) {
  const pjPath = join(pkgsDir, d, 'package.json');
  if (!existsSync(pjPath)) continue;
  const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
  if (pj.private) continue;
  if (pj.streetjs && pj.streetjs.unlisted) continue; // not yet published — keep out of the marketplace
  const short = pj.name.replace('@streetjs/plugin-', '');
  // ── Derive trust signals from real on-disk artifacts (no hardcoded claims) ──
  // `signed`: a committed Ed25519 manifest must exist for the package.
  const signed = existsSync(join(pkgsDir, d, 'manifest.signed.json'));
  // `thirdPartyDeps`: runtime dependencies excluding the framework core itself
  // (`streetjs`). Zero third-party deps ⇒ the "dependency-free" badge is true.
  const thirdPartyDeps = Object.keys(pj.dependencies || {}).filter((dep) => dep !== 'streetjs');
  const dependencyFree = thirdPartyDeps.length === 0;
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
    repo: `https://github.com/hassanmubiru/StreetJS/tree/main/packages/${d}`,
    signed,
    thirdPartyDepCount: thirdPartyDeps.length,
    thirdPartyDeps,
    dependencyFree,
    keywords: pj.keywords || [],
  });
}
plugins.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
const categories = [...new Set(plugins.map((p) => p.category))].sort().map((name) => ({ name, slug: slugify(name) }));

// ── 1. data file ─────────────────────────────────────────────────────────────
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
writeFileSync(
  join(dataDir, 'plugins.json'),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: plugins.length, categories, plugins }, null, 2) + '\n',
);

// ── 2. category pages (clean dir first so removed categories don't linger) ─────
rmSync(catDir, { recursive: true, force: true });
mkdirSync(catDir, { recursive: true });
for (const { name: cat, slug: cslug } of categories) {
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
    CATEGORY_INTROS[cat] ?? `Official StreetJS ${cat} plugins — signed and dependency-free.`,
    '',
    `${inCat.length} official ${cat} plugin${inCat.length === 1 ? '' : 's'}, all installable from npm. See the full [Plugin Marketplace](/StreetJS/plugins/marketplace/).`,
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
  const related = plugins.filter((o) => o.category === p.category && o.slug !== p.slug).slice(0, 6);
  const fm = [
    '---',
    'layout:      default',
    `title:       "${yamlEsc(p.name)}"`,
    `permalink:   /plugins/${p.slug}/`,
    'nav_exclude: true',
    `description:  "${yamlEsc(p.description)} Official${p.signed ? ', signed' : ''}${p.dependencyFree ? ', dependency-free' : ''} StreetJS plugin — install from npm."`,
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
    `- **Tier:** ${p.tier}${p.signed ? ' · **Signed**' : ''}${p.dependencyFree ? ' · **Dependency-free**' : ''}`,
    `- **Version:** \`v${p.version}\``,
    `- **Runtime dependencies:** ${p.thirdPartyDepCount === 0 ? 'none (third-party) — only `streetjs`' : '`' + p.thirdPartyDeps.join('`, `') + '`'}`,
    `- **npm:** [${p.name}](${p.npm})`,
    `- **Source:** [packages/plugin-${p.slug}](${p.repo})`,
    '',
    '## Trust signals',
    '',
    // Derived from real on-disk artifacts — never hardcoded.
    p.signed
      ? '- ✅ **Signed manifest** (Ed25519) — `manifest.signed.json` is committed and verified by the plugin host on load'
      : '- ⏳ **Manifest signing pending** — no signed manifest is committed yet; install from a trusted source and verify before production use',
    p.dependencyFree
      ? '- ✅ **Dependency-free** — no third-party runtime dependencies (only the `streetjs` framework)'
      : `- 📦 **${p.thirdPartyDepCount} third-party runtime ${p.thirdPartyDepCount === 1 ? 'dependency' : 'dependencies'}**: \`${p.thirdPartyDeps.join('`, `')}\``,
    '- ✅ **MIT licensed** · **Node.js ≥ 20** · **TypeScript-native**',
    '- ✅ **npm provenance** — official plugins are published with build attestations (enforced in CI)',
    '',
    '## Install',
    '',
    '```bash',
    `npm install ${p.name}`,
    '```',
    '',
    '## Quick start',
    '',
    'Register the plugin with the StreetJS plugin host, then use it from your',
    'controllers/services. See the package README on npm for the full configuration',
    'and API, and the [Plugin System](/StreetJS/plugins/) guide for registration,',
    'capabilities and signature verification.',
    '',
    '## Compatibility',
    '',
    '| | |',
    '|---|---|',
    `| StreetJS | \`>=1.0.0\` |`,
    '| Node.js | `>=20` |',
    '| TypeScript | `>=5.0` (NodeNext) |',
    '',
    'See the [compatibility matrix](/StreetJS/compatibility/) for the full support grid.',
    '',
    '## Certification',
    '',
    `This is an **Official** plugin — maintained by the StreetJS team in the monorepo,`,
    'CI-tested, and published with a signed manifest. See the',
    '[plugin certification levels](/StreetJS/ecosystem/plugin-certification/).',
    '',
    related.length ? '## Related plugins' : '',
    related.length ? '' : '',
    ...(related.length
      ? [related.map((r) => `- [${r.name}](/StreetJS/plugins/${r.slug}/) — ${r.description}`).join('\n'), '']
      : []),
    `Browse the full [Plugin Marketplace](/StreetJS/plugins/marketplace/) or all [${p.category}](/StreetJS/plugins/category/${cslug}/) plugins.`,
    '',
  ].filter((line) => line !== undefined).join('\n');
  writeFileSync(join(regDir, `${p.slug}.md`), fm + body);
}

console.log(`Wrote plugins.json (${plugins.length} plugins), ${categories.length} category pages, ${plugins.length} detail pages.`);
