// tests/kafka-lost-message-accounting-pbt.test.ts
// Property-based test for the Kafka chaos / cold-start lost-message accounting
// logic (Req 9.8, Property 25). Kept in its own file so the universal
// "accounting is exact" property is exercised across many generated
// (produced, deliveredToCommitted) tallies without clobbering the gate-timeout
// property (Property 24) or the example/edge-case unit tests elsewhere.
//
// Requirement 9.8: the Kafka verification run outcome is recorded in a
// Verification Artifact that includes the parameter values, the pass count, and
// the lost-message count. A lost message is a produced message that is never
// delivered to a committed consumer, so for ANY tally:
//
//   lostCount = produced − deliveredToCommitted
//   passed    = (lostCount === 0)
//
// The pure accounting function `accountLostMessages` is the single source of
// truth the live probe (scripts/reliability/kafka-account.mjs) defers to, so
// validating it offline validates the accounting that the artifact records.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { accountLostMessages } from '../transports/kafka/chaos-accounting.js';

const NUM_RUNS = 200; // ≥ 100 runs as required.

// ── Generators ──────────────────────────────────────────────────────────────
//
// A valid tally is a pair of non-negative integer counts where the number of
// messages delivered to a COMMITTED consumer cannot exceed the number produced
// (a consumer cannot commit-and-deliver more than was produced). We generate
// `produced` first, then constrain `deliveredToCommitted` to [0, produced] so
// the generator stays inside the real input space the accounting accepts. The
// wide upper bound exercises both tiny tallies and full-scale (100+) runs.
const validTallyArb: fc.Arbitrary<{ produced: number; deliveredToCommitted: number }> = fc
  .integer({ min: 0, max: 100_000 })
  .chain((produced) =>
    fc
      .integer({ min: 0, max: produced })
      .map((deliveredToCommitted) => ({ produced, deliveredToCommitted })),
  );

// Feature: platform-leadership-gaps, Property 25: Lost-message accounting is exact
// Validates: Requirements 9.8
describe('Property 25: lost-message accounting is exact', () => {
  it('records lostCount = produced − deliveredToCommitted and passed iff lostCount === 0', () => {
    fc.assert(
      fc.property(validTallyArb, ({ produced, deliveredToCommitted }) => {
        const account = accountLostMessages(produced, deliveredToCommitted);

        // The recorded parameter values are carried through unchanged.
        assert.equal(account.produced, produced);
        assert.equal(account.deliveredToCommitted, deliveredToCommitted);

        // The lost-message count is exactly the difference (never negative,
        // never fabricated).
        assert.equal(account.lostCount, produced - deliveredToCommitted);
        assert.ok(account.lostCount >= 0, `lostCount must be >= 0, got ${account.lostCount}`);

        // The run is a pass iff nothing was lost.
        assert.equal(account.passed, account.lostCount === 0);
        assert.equal(account.passed, produced === deliveredToCommitted);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a fully-delivered tally always passes with zero lost', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (produced) => {
        const account = accountLostMessages(produced, produced);
        assert.equal(account.lostCount, 0);
        assert.equal(account.passed, true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects impossible tallies rather than fabricating a negative loss', () => {
    fc.assert(
      // deliveredToCommitted strictly greater than produced is impossible: a
      // consumer cannot commit-and-deliver more than was produced. The
      // accounting must throw instead of reporting a negative lostCount.
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (produced, excess) => {
          assert.throws(() => accountLostMessages(produced, produced + excess), RangeError);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
