// src/tests/leadership-report-governance.test.ts
// Governance test (Task 19.4, Requirement 12.4): the Platform Leadership report
// `platform-leadership.report.json` MUST be produced EXCLUSIVELY by the
// aggregator path — `computeLeadership()` in
// `packages/core/src/verification/aggregator.ts`, serialized by the
// `street verify --aggregate` driver. There must be NO hand-authored report and
// NO alternate writer that computes or sets the leadership decision by hand.
//
// This is a static, offline governance check. It walks the monorepo source tree
// and asserts:
//
//   1. Every source file that WRITES a file named `platform-leadership.report.json`
//      also goes through the aggregator (references `computeLeadership` or imports
//      the aggregator module). A writer that bypasses the aggregator is a
//      hand-authored / alternate writer and fails the check (Req 12.4).
//
//   2. No source file hand-sets a leadership `decision` to the literal `GRANTED`
//      or `WITHHELD` outside the aggregator module — the decision is computed,
//      never authored (Req 12.4).
//
//   3. No `platform-leadership.report.json` is committed as source. The report is
//      only ever a generated Verification Artifact (under the gitignored
//      `verification-artifacts/`), never source-controlled / hand-authored.
//
// No network, no credentials, no built packages — pure filesystem inspection.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Locate the monorepo root from the compiled test file ─────────────────────

/** Walk up until we find the directory that contains both `packages/` and `scripts/`. */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (
      existsSync(join(dir, 'packages')) &&
      existsSync(join(dir, 'packages', 'core', 'src', 'verification', 'aggregator.ts'))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the monorepo root from the test location');
}

const REPO_ROOT = findRepoRoot();

// The canonical aggregator module — the single, sanctioned source of the decision.
const AGGREGATOR_REL = join('packages', 'core', 'src', 'verification', 'aggregator.ts');

// The report filename the governance rule protects.
const REPORT_FILENAME = 'platform-leadership.report.json';

// Source roots to scan (TypeScript/JavaScript sources + the verification scripts).
const SCAN_ROOTS = ['packages', 'scripts'];

// Directories we never treat as first-party source for this governance check.
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'dist-test',
  '.git',
  'coverage',
  'example',
  'examples',
  'verification-artifacts',
]);

const SOURCE_EXTENSIONS = ['.ts', '.js', '.mjs', '.cjs'];

/** True for test files — they reference these tokens deliberately and are not writers. */
function isTestFile(relPath: string): boolean {
  const parts = relPath.split(sep);
  if (parts.includes('tests') || parts.includes('test')) return true;
  return /\.(test|spec)\.(ts|js|mjs|cjs)$/.test(relPath);
}

function isSourceFile(name: string): boolean {
  if (name.endsWith('.d.ts')) return false;
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Recursively collect first-party source files under the scan roots. */
function collectSourceFiles(): string[] {
  const out: string[] = [];

  function walk(absDir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.') && entry !== '.github') continue;
      if (EXCLUDED_DIR_NAMES.has(entry)) continue;
      const abs = join(absDir, entry);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs);
      } else if (st.isFile() && isSourceFile(entry)) {
        out.push(abs);
      }
    }
  }

  for (const root of SCAN_ROOTS) {
    const absRoot = join(REPO_ROOT, root);
    if (existsSync(absRoot)) walk(absRoot);
  }
  return out;
}

// Detects a filesystem write of any kind in a source file.
const WRITE_API =
  /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|outputFile(?:Sync)?|writeArtifactAtomic|fsp?\.write|>\s*\S*platform-leadership\.report\.json)\b/;

// Markers that prove a file goes through the sanctioned aggregator path.
const AGGREGATOR_MARKER =
  /\b(computeLeadership|PLATFORM_LEADERSHIP_CAPABILITIES|LeadershipReport)\b|verification\/aggregator/;

// A leadership decision being hand-set to a literal (outside the aggregator).
const HAND_SET_DECISION = /\bdecision\b\s*[:=]\s*['"`](GRANTED|WITHHELD)['"`]/;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Platform Leadership report governance (Req 12.4)', () => {
  it('finds the canonical aggregator module that owns the decision', () => {
    const aggregatorAbs = join(REPO_ROOT, AGGREGATOR_REL);
    assert.ok(existsSync(aggregatorAbs), `expected the aggregator at ${AGGREGATOR_REL}`);
    const src = readFileSync(aggregatorAbs, 'utf8');
    assert.match(
      src,
      /export function computeLeadership\b/,
      'computeLeadership() must be the single, exported source of the leadership decision',
    );
  });

  it('writes the report only through the aggregator path — no alternate writer (Req 12.4)', () => {
    const files = collectSourceFiles();
    assert.ok(files.length > 0, 'expected to scan at least one source file');

    const offenders: string[] = [];

    for (const abs of files) {
      const relPath = relative(REPO_ROOT, abs);
      if (isTestFile(relPath)) continue; // tests reference the tokens deliberately

      const src = readFileSync(abs, 'utf8');
      if (!src.includes(REPORT_FILENAME)) continue; // does not touch the report at all

      // The file names the report. If it also performs a write, it is a writer
      // and MUST go through the aggregator path.
      if (WRITE_API.test(src) && !AGGREGATOR_MARKER.test(src)) {
        offenders.push(relPath);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `These files write "${REPORT_FILENAME}" without going through computeLeadership()/the aggregator. ` +
        `The report must be produced exclusively by the aggregator path (Req 12.4): ${offenders.join(', ')}`,
    );
  });

  it('never hand-sets the leadership decision outside the aggregator (Req 12.4)', () => {
    const files = collectSourceFiles();
    const offenders: string[] = [];

    for (const abs of files) {
      const relPath = relative(REPO_ROOT, abs);
      if (isTestFile(relPath)) continue;
      if (relPath === AGGREGATOR_REL) continue; // the aggregator computes the literal

      const src = readFileSync(abs, 'utf8');
      if (HAND_SET_DECISION.test(src)) {
        offenders.push(relPath);
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `These files hand-set a leadership decision to GRANTED/WITHHELD outside the aggregator. ` +
        `The decision must be computed by computeLeadership(), never authored (Req 12.4): ${offenders.join(', ')}`,
    );
  });

  it('keeps no hand-authored leadership report in source control (Req 12.4)', () => {
    // The report is only ever a generated artifact under the gitignored
    // verification-artifacts/ tree. A committed report anywhere in the source
    // roots would be hand-authored evidence — forbidden.
    const committed: string[] = [];

    function walk(absDir: string): void {
      let entries: string[];
      try {
        entries = readdirSync(absDir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        if (EXCLUDED_DIR_NAMES.has(entry)) continue; // excludes verification-artifacts/
        const abs = join(absDir, entry);
        let st;
        try {
          st = statSync(abs);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          walk(abs);
        } else if (entry === REPORT_FILENAME) {
          committed.push(relative(REPO_ROOT, abs));
        }
      }
    }

    for (const root of SCAN_ROOTS) {
      const absRoot = join(REPO_ROOT, root);
      if (existsSync(absRoot)) walk(absRoot);
    }

    assert.deepEqual(
      committed,
      [],
      `Found hand-authored "${REPORT_FILENAME}" committed as source: ${committed.join(', ')}. ` +
        `The report must only ever be produced by the aggregator (Req 12.4).`,
    );
  });
});
