// packages/cli/src/tests/marzpay-scope-review.test.ts
// Scope-review assertion for the marzpay-scope-alignment feature (Task 14.3).
//
// Requirement 13.1 is a HARD architecture constraint: "THE MarzPay_Plugin
// refinement SHALL make no changes to `packages/core`." The feature's changes are
// confined to `packages/plugin-marzpay/`, `packages/cli/`, and `docs/`.
//
// This test is a lightweight, non-flaky guardrail that inspects the repository's
// version-control state and asserts that NO modified/added/staged/untracked path
// lives under `packages/core/`. It scopes to "this feature" two ways:
//
//   1. The working-tree + index changes (`git status --porcelain`). During feature
//      development these are exactly the feature's uncommitted edits, so an
//      accidental edit to `packages/core` is caught immediately.
//   2. (Optional) A diff against a base ref when one is determinable — supplied via
//      the `MARZPAY_SCOPE_BASE_REF` environment variable (e.g. the branch point in
//      CI). When set and resolvable, `git diff --name-only <base>...HEAD` is also
//      checked so the merged feature commits are scoped too.
//
// The test degrades gracefully: if git is unavailable or this is not a git
// checkout, it SKIPS rather than failing spuriously.
//
// Validates: Requirements 13.1

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const CORE_PREFIX = 'packages/core/';

/** Run a git command from the repo, returning trimmed stdout, or null on any failure. */
function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/** Resolve the repository root, or null when git/the repo is unavailable. */
function repoRoot(): string | null {
  const here = process.cwd();
  const top = git(['rev-parse', '--show-toplevel'], here);
  return top && top.length > 0 ? top : null;
}

/**
 * Parse the path portion out of one `git status --porcelain` (v1) line.
 * Handles the 2-char status + space prefix, rename arrows (`old -> new`), and
 * git's optional surrounding quotes for paths with special characters.
 */
function pathFromStatusLine(line: string): string | null {
  if (line.length <= 3) return null;
  let p = line.slice(3); // strip "XY " status prefix
  const arrow = p.indexOf(' -> ');
  if (arrow !== -1) p = p.slice(arrow + 4); // keep the rename destination
  p = p.trim();
  if (p.startsWith('"') && p.endsWith('"') && p.length >= 2) p = p.slice(1, -1);
  return p.length > 0 ? p : null;
}

/** Collect every path that this feature touches according to version control. */
function changedPaths(root: string): { paths: string[]; sources: string[] } {
  const sources: string[] = [];
  const set = new Set<string>();

  // (1) Working-tree + index + untracked changes.
  const status = git(['status', '--porcelain'], root);
  if (status !== null) {
    sources.push('git status --porcelain');
    for (const line of status.split('\n')) {
      if (line.trim() === '') continue;
      const p = pathFromStatusLine(line);
      if (p) set.add(p);
    }
  }

  // (2) Optional diff against a determinable base ref (scopes merged commits).
  const baseRef = process.env.MARZPAY_SCOPE_BASE_REF;
  if (baseRef && baseRef.trim() !== '') {
    const resolved = git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`], root);
    if (resolved) {
      const diff = git(['diff', '--name-only', `${baseRef}...HEAD`], root);
      if (diff !== null) {
        sources.push(`git diff --name-only ${baseRef}...HEAD`);
        for (const line of diff.split('\n')) {
          const p = line.trim();
          if (p) set.add(p);
        }
      }
    }
  }

  return { paths: [...set], sources };
}

describe('MarzPay scope review — no packages/core changes (Requirement 13.1)', () => {
  it('does not modify any file under packages/core — Validates: Requirements 13.1', (t) => {
    const root = repoRoot();
    if (root === null) {
      t.skip('git is unavailable or this is not a git checkout; scope review skipped');
      return;
    }

    const { paths, sources } = changedPaths(root);
    if (sources.length === 0) {
      t.skip('no version-control change source was available; scope review skipped');
      return;
    }

    const coreChanges = paths.filter((p) => p.startsWith(CORE_PREFIX));
    assert.deepEqual(
      coreChanges,
      [],
      `Requirement 13.1 forbids changes to ${CORE_PREFIX}, but these paths were modified ` +
        `(sources: ${sources.join(', ')}):\n  ${coreChanges.join('\n  ')}`,
    );
  });
});
