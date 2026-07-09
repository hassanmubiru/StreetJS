// scripts/ci/validate-yaml.mjs
//
// Validate the syntax of every YAML file in the repo, in Node (js-yaml) so CI
// needs no extra Python/pip dependency (Scorecard Pinned-Dependencies: avoids an
// unpinned `pip install`). js-yaml is already available via packages/core's
// dev dependencies after the root `npm ci`.
//
//   - Walks the tree, skipping node_modules/ and .git/.
//   - Helm chart templates (infra/helm/**/templates/**) are Go-templated
//     ({{- ... }}), not valid YAML, so they are skipped.
//   - Parses every document in each file (loadAll) to catch syntax errors.
//   - For .github/workflows/*, the first document must be a mapping and should
//     carry a `name` key.
//
// Emits GitHub Actions ::error / ::warning annotations and exits non-zero if any
// file fails to parse.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { loadAll } from 'js-yaml';

let errors = 0;

/** Recursively collect .yml/.yaml paths, skipping node_modules and .git. */
function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // unreadable directory — skip
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const path = join(dir, entry);
    let st;
    try {
      st = statSync(path); // follows symlinks; throws on broken links
    } catch {
      continue; // broken symlink or vanished entry — skip
    }
    if (st.isDirectory()) {
      collect(path, out);
    } else if (entry.endsWith('.yml') || entry.endsWith('.yaml')) {
      out.push(path);
    }
  }
}

const files = [];
collect('.', files);

for (const path of files) {
  const norm = path.split(sep).join('/');

  // Helm chart templates are Go-templated, not valid YAML — skip them.
  if (norm.includes('infra/helm/') && norm.includes('/templates/')) continue;

  let docs;
  try {
    docs = loadAll(readFileSync(path, 'utf8'));
  } catch (e) {
    const msg = String(e.message ?? e).replace(/\n/g, ' | ');
    console.log(`::error title=YAML Syntax Error,file=${norm}::${msg}`);
    errors += 1;
    continue;
  }

  if (norm.includes('.github/workflows/')) {
    const root = docs[0];
    if (root === null || typeof root !== 'object' || Array.isArray(root)) {
      console.log(`::error title=Invalid Workflow,file=${norm}::Root must be a mapping`);
      errors += 1;
    } else if (!('name' in root)) {
      console.log(`::warning title=Missing name,file=${norm}::Workflow missing name key`);
    }
  }

  console.log(`  OK: ${norm}`);
}

if (errors) process.exit(1);
