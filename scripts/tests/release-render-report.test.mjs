// scripts/tests/release-render-report.test.mjs
//
// Unit tests for the Release Engineering report renderer (Requirement 11.3 /
// 11.5 / 11.6). These exercise the renderer's pure decision + presentation
// logic and its input loading, without spawning the CommandRunner. The runner
// integration (artifact emission + exit-code propagation) is covered by the
// `release.scorecard` Verification Artifact produced in CI.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  RELEASE_DIMENSIONS,
  DEFAULT_MIN_SCORE,
  resolveThresholds,
  evaluateControls,
  renderMarkdown,
} from '../release/lib.mjs';
import { buildAndEvaluate, loadInputs, resolveVersion } from '../release/render-report.mjs';

const PASSING_SCORECARD = {
  security: 95,
  reliability: 90,
  coverage: 85,
  performance: 88,
};
const ZERO_HEALTH = {
  current: { dependencyFreshness: 0, testTrends: 0, vulnerabilityTrends: 0 },
  previous: { dependencyFreshness: 0, testTrends: 0, vulnerabilityTrends: 0 },
};

/**
 * A changelog with a non-empty entry for `version`. The core `validateReleaseNotes`
 * requires non-empty, non-heading content directly under the version heading
 * (it stops at the next heading), so the notes are placed immediately below.
 */
function changelogWith(version) {
  return `# Changelog\n\n## [${version}] — 2026-01-01\n\nReal, non-empty release notes for this version.\n`;
}

const tmpFiles = [];
function tmpInputs(obj) {
  const dir = mkdtempSync(join(tmpdir(), 'release-test-'));
  const path = join(dir, 'inputs.json');
  writeFileSync(path, JSON.stringify(obj));
  tmpFiles.push(dir);
  return path;
}

after(() => {
  for (const dir of tmpFiles) rmSync(dir, { recursive: true, force: true });
});

describe('resolveThresholds (Req 11.6)', () => {
  it('defaults every dimension to DEFAULT_MIN_SCORE', () => {
    const t = resolveThresholds({}, {}, {});
    for (const dim of RELEASE_DIMENSIONS) assert.equal(t[dim], DEFAULT_MIN_SCORE);
  });

  it('applies a uniform RELEASE_MIN_SCORE env override', () => {
    const t = resolveThresholds({}, {}, { RELEASE_MIN_SCORE: '70' });
    for (const dim of RELEASE_DIMENSIONS) assert.equal(t[dim], 70);
  });

  it('honors precedence: flag > inputs > env > default', () => {
    const t = resolveThresholds(
      { thresholds: { security: 60, reliability: 60 } },
      { 'min-security': '99' },
      { RELEASE_MIN_SCORE: '50' },
    );
    assert.equal(t.security, 99); // flag wins
    assert.equal(t.reliability, 60); // inputs win over env
    assert.equal(t.coverage, 50); // env wins over default
    assert.equal(t.performance, 50);
  });

  it('ignores non-numeric overrides so the bar cannot be silently weakened', () => {
    const t = resolveThresholds({ thresholds: { security: 'oops' } }, { 'min-coverage': 'nope' }, {});
    assert.equal(t.security, DEFAULT_MIN_SCORE);
    assert.equal(t.coverage, DEFAULT_MIN_SCORE);
  });
});

describe('evaluateControls (Req 11.3 / 11.6)', () => {
  const thresholds = resolveThresholds({}, {}, {});

  it('passes when validation and every scorecard dimension are satisfied', () => {
    const { report, controlsResult } = buildAndEvaluate({
      version: '1.2.3',
      changelog: changelogWith('1.2.3'),
      scorecard: PASSING_SCORECARD,
      health: ZERO_HEALTH,
      thresholds,
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(controlsResult.passed, true);
    assert.deepEqual(controlsResult.failedControls, []);
    assert.equal(report.validation.semverOk, true);
    assert.equal(report.validation.releaseNotesOk, true);
  });

  it('fails the semver control for an invalid version (Req 11.3)', () => {
    const { controlsResult } = buildAndEvaluate({
      version: '1.2',
      changelog: changelogWith('1.2'),
      scorecard: PASSING_SCORECARD,
      health: ZERO_HEALTH,
      thresholds,
    });
    assert.equal(controlsResult.passed, false);
    assert.ok(controlsResult.failedControls.includes('semver'));
  });

  it('fails the release-notes control when no entry exists for the version (Req 11.3)', () => {
    const { controlsResult } = buildAndEvaluate({
      version: '1.2.3',
      changelog: changelogWith('9.9.9'), // entry exists, but for a different version
      scorecard: PASSING_SCORECARD,
      health: ZERO_HEALTH,
      thresholds,
    });
    assert.equal(controlsResult.passed, false);
    assert.ok(controlsResult.failedControls.includes('release-notes'));
  });

  it('fails the scorecard control when a dimension is below its threshold (Req 11.6)', () => {
    const { controlsResult } = buildAndEvaluate({
      version: '1.2.3',
      changelog: changelogWith('1.2.3'),
      scorecard: { ...PASSING_SCORECARD, coverage: 10 },
      health: ZERO_HEALTH,
      thresholds,
    });
    assert.equal(controlsResult.passed, false);
    assert.ok(controlsResult.failedControls.includes('scorecard:coverage'));
    assert.ok(!controlsResult.failedControls.includes('scorecard:security'));
  });

  it('every control carries an explanatory detail string', () => {
    const { report } = buildAndEvaluate({
      version: '1.2.3',
      changelog: changelogWith('1.2.3'),
      scorecard: PASSING_SCORECARD,
      health: ZERO_HEALTH,
      thresholds,
    });
    const res = evaluateControls(report, thresholds);
    for (const c of res.controls) {
      assert.equal(typeof c.detail, 'string');
      assert.ok(c.detail.length > 0);
    }
  });
});

describe('renderMarkdown (Req 11.5)', () => {
  it('renders scorecard, validation, health, and enforced-control sections', () => {
    const { report, controlsResult } = buildAndEvaluate({
      version: '1.2.3',
      changelog: changelogWith('1.2.3'),
      scorecard: PASSING_SCORECARD,
      health: ZERO_HEALTH,
      thresholds: resolveThresholds({}, {}, {}),
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const md = renderMarkdown(report, controlsResult);
    assert.ok(md.includes('# Release Report — 1.2.3'));
    assert.ok(md.includes('## Scorecard'));
    assert.ok(md.includes('## Validation'));
    assert.ok(md.includes('## Health Metrics'));
    assert.ok(md.includes('## Enforced Controls'));
    assert.ok(md.includes('✅ PASS'));
  });

  it('lists failed controls when enforcement fails', () => {
    const { report, controlsResult } = buildAndEvaluate({
      version: '1.2',
      changelog: changelogWith('1.2'),
      scorecard: PASSING_SCORECARD,
      health: ZERO_HEALTH,
      thresholds: resolveThresholds({}, {}, {}),
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    const md = renderMarkdown(report, controlsResult);
    assert.ok(md.includes('❌ FAIL'));
    assert.ok(md.includes('Failed controls'));
  });
});

describe('loadInputs', () => {
  it('returns absent + zero scorecard when no path is given (no evidence ⇒ no credit)', () => {
    const loaded = loadInputs(undefined);
    assert.equal(loaded.present, false);
    for (const dim of RELEASE_DIMENSIONS) assert.equal(loaded.scorecard[dim], 0);
  });

  it('throws when the inputs file is missing', () => {
    assert.throws(() => loadInputs('/nonexistent/release-inputs.json'), /not found/);
  });

  it('defaults missing scorecard dimensions and health counts to zero', () => {
    const path = tmpInputs({ scorecard: { security: 90 }, health: { current: { testTrends: 5 } } });
    const loaded = loadInputs(path);
    assert.equal(loaded.present, true);
    assert.equal(loaded.scorecard.security, 90);
    assert.equal(loaded.scorecard.reliability, 0);
    assert.equal(loaded.health.current.testTrends, 5);
    assert.equal(loaded.health.current.dependencyFreshness, 0);
    assert.equal(loaded.health.previous.vulnerabilityTrends, 0);
  });
});

describe('resolveVersion', () => {
  it('prefers the --version flag', () => {
    assert.equal(resolveVersion({ version: '3.4.5' }, {}), '3.4.5');
  });

  it('falls back to RELEASE_VERSION env', () => {
    assert.equal(resolveVersion({}, { RELEASE_VERSION: '6.7.8' }), '6.7.8');
  });

  it('falls back to the core package version when neither is set', () => {
    const v = resolveVersion({}, {});
    assert.match(v, /^\d+\.\d+\.\d+$/);
  });
});
