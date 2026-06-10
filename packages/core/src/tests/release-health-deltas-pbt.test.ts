// tests/release-health-deltas-pbt.test.ts
// Property-based test for the Release Engineering health-delta logic (Req 11.4).
// Kept in its own file so the universal "deltas are exact" property is exercised
// across many generated (current, previous) tallies without clobbering the
// bounded-score property (Property 28) or the validation property (Property 29).
//
// Requirement 11.4: the release report covers dependency freshness, test trends,
// and vulnerability trends as counts AND as deltas relative to the previous
// release. For every metric, the reported delta must equal `current − previous`
// exactly, and the reported count must equal the current tally.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  computeHealthMetrics,
  buildReleaseReport,
  type HealthCounts,
  type HealthMetrics,
} from '../release/scorecard.js';

const NUM_RUNS = 200; // ≥ 100 runs as required.

// The three health dimensions covered by Requirement 11.4.
const DIMENSIONS = ['dependencyFreshness', 'testTrends', 'vulnerabilityTrends'] as const;

// ── Generators ────────────────────────────────────────────────────────────────
//
// Health counts are arbitrary integers. We use a wide integer range (including
// negatives, zero, and large magnitudes) so the delta is shown to be a pure
// subtraction that holds for every pair rather than only for "nice" values.
const countArb: fc.Arbitrary<number> = fc.integer({ min: -1_000_000, max: 1_000_000 });

const healthCountsArb: fc.Arbitrary<HealthCounts> = fc.record({
  dependencyFreshness: countArb,
  testTrends: countArb,
  vulnerabilityTrends: countArb,
});

// Feature: platform-leadership-gaps, Property 30: Release health deltas are exact
// Validates: Requirements 11.4
describe('Property 30: release health deltas are exact', () => {
  it('computeHealthMetrics reports count = current and delta = current − previous for every dimension', () => {
    fc.assert(
      fc.property(healthCountsArb, healthCountsArb, (current, previous) => {
        const metrics: HealthMetrics = computeHealthMetrics(current, previous);

        for (const dim of DIMENSIONS) {
          // The count is exactly the current tally for that dimension.
          assert.equal(metrics[dim].count, current[dim]);
          // The delta is exactly `current − previous` for that dimension.
          assert.equal(metrics[dim].deltaVsPrevious, current[dim] - previous[dim]);
          // Reconstructing previous from count − delta returns the previous tally.
          assert.equal(metrics[dim].count - metrics[dim].deltaVsPrevious, previous[dim]);
        }

        // Only the three declared dimensions are reported (no leaked buckets).
        assert.deepEqual(Object.keys(metrics).sort(), [...DIMENSIONS].sort());
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the deltas carried into buildReleaseReport are the same exact tally', () => {
    fc.assert(
      fc.property(healthCountsArb, healthCountsArb, (current, previous) => {
        const report = buildReleaseReport({
          version: '1.0.0',
          scorecard: { security: 0, reliability: 0, coverage: 0, performance: 0 },
          changelog: '',
          health: { current, previous },
          timestamp: '2024-01-01T00:00:00.000Z',
        });

        for (const dim of DIMENSIONS) {
          assert.equal(report.health[dim].count, current[dim]);
          assert.equal(report.health[dim].deltaVsPrevious, current[dim] - previous[dim]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a zero delta is reported iff the tallies are unchanged', () => {
    fc.assert(
      fc.property(healthCountsArb, healthCountsArb, (current, previous) => {
        const metrics = computeHealthMetrics(current, previous);
        for (const dim of DIMENSIONS) {
          assert.equal(metrics[dim].deltaVsPrevious === 0, current[dim] === previous[dim]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
