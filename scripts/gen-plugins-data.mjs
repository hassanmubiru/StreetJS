#!/usr/bin/env node
// scripts/gen-plugins-data.mjs
// Generates docs/_data/plugins.json for the plugin marketplace (Workstream 1).
// Source of truth = packages/plugin-*/package.json (name, description, version,
// keywords). Category is inferred from keywords/name. Dependency-free; safe to run
// in CI before `jekyll build`. Re-run on any plugin add/change.
//
// Run: node scripts/gen-plugins-data.mjs
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgsDir = join(root, 'packages');
const outDir = join(root, 'docs', '_data');

// keyword/name -> category (first match wins)
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
    tier: 'Official',
    npm: `https://www.npmjs.com/package/${pj.name}`,
    keywords: pj.keywords || [],
  });
}
plugins.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

const categories = [...new Set(plugins.map((p) => p.category))].sort();
const data = { generated: new Date().toISOString().slice(0, 10), count: plugins.length, categories, plugins };

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'plugins.json'), JSON.stringify(data, null, 2) + '\n');
console.log(`Wrote docs/_data/plugins.json — ${plugins.length} plugins, ${categories.length} categories`);
