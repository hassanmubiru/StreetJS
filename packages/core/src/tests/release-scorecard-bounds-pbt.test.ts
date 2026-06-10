// tests/release-scorecard-bounds-pbt.test.ts
// Property-based test for the Release Engineering scorecard bounding (Req 11.1).
// Kept in its own file so the universal property is exercised across many
// generated scorecards without clobbering example/edge-case unit tests.
//
// Req 11.1: the Release Scorecard scores security, reliability, coverage, and
// performance each on a 0–100 numeric scale. The pure helpers `boundScorecard`
// (and `buildReleaseReport`, which delegates to it) guarantee every produced
// dimension is a finite number in [MIN_SCORE, MAX_SCORE] = [0, 100] regardless
// of the raw inputs (negatives, out-of-range, fractional, or non-finite).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  boundScorecard,
  buildReleaseReport,
  MIN_SCORE,
  MAX_SCORE,
  type ReleaseScorecard,
} from '../release/scorecard.js';

const NUM_RUNS = 100;

const DIMENSIONS = ['security', 'reliability', 'coverage', 'performance'] as const;

// ── Generators ────────────────────────────────────────────────────────────────
//
// Cover the whole input space for a single score: arbitrary doubles (incl.
// negatives, fractions, and extreme magnitudes), the non-finite trio
// (NaN, +Infinity, -Infinity), and a dense band straddling the [0, 100] bounds
// so the edges are hit frequently.
const scoreArb: fc.Arbitrary<number> = fc.oneof(
  fc.double({ noDefaultInfinity: false, noNaN: false }),
  fc.double({ min: -1e9, max: 1e9, noNaN: true }),
  fc.constantFrom(NaN, Infinity, -Infinity),
  fc.integer({ min: -50, max: 150 }),
  fc.constantFrom(
    -0,
    -0.0001,
    0,
    0.5,
    99.999,
    100,
    100.0001,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
  ),
);

const scorecardArb: fc.Arbitrary<ReleaseScorecard> = fc.record({
  security: scoreArb,
  reliability: scoreArb,
  coverage: scoreArb,
  performance: scoreArb,
});

function assertBounded(scorecard: ReleaseScorecard): void {
  for (const dim of DIMENSIONS) {
    const value = scorecard[dim];
    assert.equal(typeof value, 'number', `${dim} must be a number`);
    assert.ok(Number.isFinite(value), `${dim} (${value}) must be finite`);
    assert.ok(
      value >= MIN_SCORE && value <= MAX_SCORE,
      `${dim} (${value}) must lie within [${MIN_SCORE}, ${MAX_SCORE}]`,
    );
  }
}

// Feature: platform-leadership-gaps, Property 28: Release scores are bounded
// Validates: Requirements 11.1
describe('Property 28: release scores are bounded', () => {
  it('boundScorecard produces every dimension as a finite number in [0, 100]', () => {
    fc.assert(
      fc.property(scorecardArb, (raw) => {
        assertBounded(boundScorecard(raw));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('buildReleaseReport emits a scorecard bounded to [0, 100] for any raw input', () => {
    fc.assert(
      fc.property(scorecardArb, (raw) => {
        const report = buildReleaseReport({
          version: '1.2.3',
          scorecard: raw,
          changelog: '## 1.2.3\n\n- a change\n',
          health: {
            current: { dependencyFreshness: 0, testTrends: 0, vulnerabilityTrends: 0 },
            previous: { dependencyFreshness: 0, testTrends: 0, vulnerabilityTrends: 0 },
          },
          timestamp: '2024-01-01T00:00:00.000Z',
        });
        assertBounded(report.scorecard);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('preserves in-range scores exactly while clamping out-of-range ones', () => {
    fc.assert(
      fc.property(scorecardArb, (raw) => {
        const bounded = boundScorecard(raw);
        for (const dim of DIMENSIONS) {
          const input = raw[dim];
          const output = bounded[dim];
          if (Number.isNaN(input)) {
            // NaN collapses to MIN_SCORE.
            assert.equal(output, MIN_SCORE, `NaN ${dim} should collapse to MIN`);
          } else if (input > MAX_SCORE) {
            // Above range (including +Infinity) clamps down to MAX.
            assert.equal(output, MAX_SCORE, `above-range ${dim} should clamp to MAX`);
          } else if (input < MIN_SCORE) {
            // Below range (including -Infinity) clamps up to MIN.
            assert.equal(output, MIN_SCORE, `below-range ${dim} should clamp to MIN`);
          } else {
            // In-range finite values are preserved exactly.
            assert.equal(output, input, `in-range ${dim} should be preserved`);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
