#!/usr/bin/env node
// scripts/sync-labels.mjs
// Applies the label manifest in `.github/labels.yml` to the current repository
// using the GitHub CLI (`gh`, preinstalled on GitHub-hosted runners). This makes
// the manifest the single source of truth: labels referenced by the issue
// templates (bug/triage/enhancement) and the community program (good-first-issue,
// mentorship-available, …) actually exist on the live repo.
//
// Dependency-free: a tiny parser for the manifest's flat list format (no YAML lib).
// Non-destructive: creates missing labels and updates color/description of
// existing ones (`gh label create --force`); it never deletes labels.
//
// Usage:
//   node scripts/sync-labels.mjs            # apply via `gh label create --force`
//   node scripts/sync-labels.mjs --dry-run  # print the actions, call nothing
//
// Requires (non-dry-run): `gh` authenticated with a token that has `issues: write`
// (the workflow supplies GITHUB_TOKEN). Run from CI or locally inside the repo.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, '.github', 'labels.yml');
const dryRun = process.argv.includes('--dry-run');

/**
 * Parse the flat label manifest. Expected per-entry shape:
 *   - name: <name>            (may be quoted)
 *     color: "<hex>"
 *     description: <text>      (may be quoted)
 * Comment (`#`) and blank lines are ignored.
 */
function parseLabels(text) {
  const labels = [];
  let cur = null;
  const unquote = (s) => s.trim().replace(/^["']|["']$/g, '');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const nameMatch = line.match(/^\s*-\s*name:\s*(.+)$/);
    if (nameMatch) {
      if (cur) labels.push(cur);
      cur = { name: unquote(nameMatch[1]), color: '', description: '' };
      continue;
    }
    const colorMatch = line.match(/^\s*color:\s*(.+)$/);
    if (colorMatch && cur) { cur.color = unquote(colorMatch[1]); continue; }
    const descMatch = line.match(/^\s*description:\s*(.+)$/);
    if (descMatch && cur) { cur.description = unquote(descMatch[1]); continue; }
  }
  if (cur) labels.push(cur);
  return labels;
}

const labels = parseLabels(readFileSync(manifestPath, 'utf8'));
if (labels.length === 0) {
  console.error('[sync-labels] No labels parsed from .github/labels.yml — aborting.');
  process.exit(1);
}

let failures = 0;
for (const { name, color, description } of labels) {
  if (!name || !color) {
    console.error(`[sync-labels] Skipping malformed entry: ${JSON.stringify({ name, color })}`);
    failures++;
    continue;
  }
  const args = ['label', 'create', name, '--color', color, '--description', description, '--force'];
  if (dryRun) {
    console.log(`[dry-run] gh ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    continue;
  }
  const res = spawnSync('gh', args, { stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`[sync-labels] Failed to sync label "${name}" (exit ${res.status}).`);
    failures++;
  } else {
    console.log(`[sync-labels] Synced "${name}".`);
  }
}

console.log(`[sync-labels] ${labels.length} labels processed${dryRun ? ' (dry run)' : ''}, ${failures} failure(s).`);
process.exit(failures > 0 && !dryRun ? 1 : 0);
