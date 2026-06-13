// scripts/check-tag-version.mjs
// Verifies a release tag's version matches the published packages' versions at
// the tagged commit. Used by the pre-push hook to stop "phantom" tags (a v*.*.*
// tag created at a commit whose package.json versions don't match), which is
// what the publish workflow's version-match gate rejects after the fact.
//
// Usage:
//   node scripts/check-tag-version.mjs <tag> [commit-ish]
//     <tag>        e.g. v1.0.7 (leading 'v' optional)
//     [commit-ish] commit to read package.json from (default: the tag/HEAD)
//
// Exits 0 if all of streetjs (core), @streetjs/core (core-compat), and
// @streetjs/cli equal the tag version; non-zero otherwise.

import { execFileSync } from 'node:child_process';

const PKGS = [
  ['streetjs', 'packages/core/package.json'],
  ['@streetjs/core (compat)', 'packages/core-compat/package.json'],
  ['@streetjs/cli', 'packages/cli/package.json'],
];

const rawTag = process.argv[2];
if (!rawTag) {
  console.error('check-tag-version: usage: node scripts/check-tag-version.mjs <tag> [commit-ish]');
  process.exit(2);
}
const tagVersion = rawTag.replace(/^v/, '');
const commitish = process.argv[3] || rawTag;

function versionAt(path) {
  // Read the file as it exists at the given commit (falls back to working tree).
  let content;
  try {
    content = execFileSync('git', ['show', `${commitish}:${path}`], { encoding: 'utf8' });
  } catch {
    content = execFileSync('cat', [path], { encoding: 'utf8' });
  }
  return JSON.parse(content).version;
}

let mismatch = false;
for (const [name, path] of PKGS) {
  let v;
  try {
    v = versionAt(path);
  } catch (err) {
    console.error(`  ✗ ${name}: could not read ${path} (${err.message})`);
    mismatch = true;
    continue;
  }
  if (v !== tagVersion) {
    console.error(`  ✗ ${name}: ${v} ≠ tag ${tagVersion}  (${path})`);
    mismatch = true;
  } else {
    console.error(`  ✓ ${name}: ${v}`);
  }
}

if (mismatch) {
  console.error(`\n✗ Tag ${rawTag} does not match all package versions at ${commitish}.`);
  console.error('  Bump every package to the tag version (in lockstep, incl. the');
  console.error('  core-compat streetjs pin + lockfile) before tagging. Aborting.');
  process.exit(1);
}
console.error(`\n✓ Tag ${rawTag} matches all package versions.`);
process.exit(0);
