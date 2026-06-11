// tests/privacy-consent-pbt.test.ts
// Property-based test for the Privacy_Controls consent tracking (Phase 9, R10).
//
// Feature: consumer-platform-security, Property 23 — Consent enforcement
// reflects the latest decision.
// Validates: Requirements 10.5, 10.6
//
// R10.5: "WHEN a user grants or withdraws consent for a defined purpose, THE
// Privacy_Controls SHALL record the consent decision with the purpose and
// timestamp."
// R10.6: "WHILE a user has withdrawn consent for a defined purpose, THE
// Privacy_Controls SHALL refuse processing that depends on that purpose."
//
// This file proves, across arbitrary interleaved sequences of grant/withdraw
// decisions over a small (user, purpose) space, that the recorded consent state
// always reflects the LATEST decision per (user, purpose):
//   - the latest decision wins by timestamp; on a tie the most recently applied
//     `setConsent` call wins (matching the implementation contract),
//   - `hasConsent(user, purpose)` is true iff the latest decision is a grant,
//     and false when no decision has ever been recorded,
//   - `requireConsent(user, purpose)` throws `ConsentRequiredError` iff the
//     latest decision is a withdrawal, and passes when the latest decision is a
//     grant or when no decision has been recorded,
//   - decisions for one (user, purpose) never affect another pair.
//
// The controls are driven directly with no mocks; consent state lives entirely
// in process. Kept in its own *-pbt.test.ts file per the repo convention, with
// ≥100 runs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { PrivacyControls, ConsentRequiredError } from '../security/privacy.js';

const NUM_RUNS = 200;

// Small, fixed user/purpose spaces so generated decisions collide densely on
// the same (user, purpose) pairs, exercising the "latest wins" overwrite path.
const USERS = ['u0', 'u1', 'u2'] as const;
const PURPOSES = ['marketing', 'analytics', 'personalization'] as const;

const userArb = fc.constantFrom(...USERS);
const purposeArb = fc.constantFrom(...PURPOSES);

// A single decision: a (user, purpose) pair, a grant/withdraw flag, and a
// timestamp drawn from a small range so ties on `ts` occur and the tie-break
// (last applied wins) is exercised.
const decisionArb = fc.record({
  userId: userArb,
  purpose: purposeArb,
  granted: fc.boolean(),
  ts: fc.integer({ min: 0, max: 5 }),
});

// A sequence of decisions applied in order via setConsent.
const decisionsArb = fc.array(decisionArb, { minLength: 0, maxLength: 40 });

const pairKey = (userId: string, purpose: string): string => `${userId}\u0000${purpose}`;

/**
 * Compute the ground-truth latest decision per (user, purpose) by replaying the
 * sequence with the same rule as the implementation: a later decision overwrites
 * the stored one iff its `ts` is greater than or equal to the stored `ts`
 * (latest by timestamp, ties resolve to the most recently applied call).
 */
function expectedLatest(
  decisions: { userId: string; purpose: string; granted: boolean; ts: number }[],
): Map<string, { granted: boolean; ts: number }> {
  const latest = new Map<string, { granted: boolean; ts: number }>();
  for (const d of decisions) {
    const key = pairKey(d.userId, d.purpose);
    const existing = latest.get(key);
    if (!existing || d.ts >= existing.ts) {
      latest.set(key, { granted: d.granted, ts: d.ts });
    }
  }
  return latest;
}

// ── Property 23: consent enforcement reflects the latest decision (R10.5/R10.6) ──

// Feature: consumer-platform-security, Property 23: Consent enforcement
// reflects the latest decision
// Validates: Requirements 10.5, 10.6
describe('Property 23: consent enforcement reflects the latest decision', () => {
  it('hasConsent/requireConsent reflect the latest recorded decision per (user, purpose) (R10.5/R10.6)', () => {
    fc.assert(
      fc.property(decisionsArb, (decisions) => {
        const controls = new PrivacyControls();

        for (const d of decisions) {
          controls.setConsent(d);
        }

        const latest = expectedLatest(decisions);

        // For every (user, purpose) in the space, the observable consent state
        // must match the latest recorded decision exactly.
        for (const userId of USERS) {
          for (const purpose of PURPOSES) {
            const decision = latest.get(pairKey(userId, purpose));

            if (!decision) {
              // No decision recorded: not consented, and requireConsent passes
              // (there is nothing to refuse).
              assert.equal(
                controls.hasConsent(userId, purpose),
                false,
                `no decision for ${userId}/${purpose} must read as not consented`,
              );
              assert.doesNotThrow(
                () => controls.requireConsent(userId, purpose),
                `requireConsent must pass when no decision exists for ${userId}/${purpose}`,
              );
              continue;
            }

            // hasConsent mirrors the latest grant flag (R10.5/R10.6).
            assert.equal(
              controls.hasConsent(userId, purpose),
              decision.granted,
              `hasConsent for ${userId}/${purpose} must equal latest granted=${decision.granted}`,
            );

            if (decision.granted) {
              // Latest decision is a grant: processing is permitted.
              assert.doesNotThrow(
                () => controls.requireConsent(userId, purpose),
                `requireConsent must pass while latest decision for ${userId}/${purpose} is a grant`,
              );
            } else {
              // Latest decision is a withdrawal: processing is refused (R10.6).
              assert.throws(
                () => controls.requireConsent(userId, purpose),
                ConsentRequiredError,
                `requireConsent must refuse while latest decision for ${userId}/${purpose} is a withdrawal`,
              );
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a later decision overrides an earlier one for the same (user, purpose), flipping enforcement (R10.5/R10.6)', () => {
    // Drive a single pair through grant -> withdraw -> grant with strictly
    // increasing timestamps; enforcement must follow the most recent decision
    // at each step, proving the latest decision governs.
    fc.assert(
      fc.property(userArb, purposeArb, (userId, purpose) => {
        const controls = new PrivacyControls();

        controls.setConsent({ userId, purpose, granted: true, ts: 1 });
        assert.equal(controls.hasConsent(userId, purpose), true);
        assert.doesNotThrow(() => controls.requireConsent(userId, purpose));

        // Withdraw with a newer timestamp: enforcement now refuses.
        controls.setConsent({ userId, purpose, granted: false, ts: 2 });
        assert.equal(controls.hasConsent(userId, purpose), false);
        assert.throws(() => controls.requireConsent(userId, purpose), ConsentRequiredError);

        // Re-grant with a still-newer timestamp: enforcement permits again.
        controls.setConsent({ userId, purpose, granted: true, ts: 3 });
        assert.equal(controls.hasConsent(userId, purpose), true);
        assert.doesNotThrow(() => controls.requireConsent(userId, purpose));

        // A stale withdrawal (older timestamp) must NOT override the latest
        // grant: enforcement still reflects the newest decision.
        controls.setConsent({ userId, purpose, granted: false, ts: 1 });
        assert.equal(
          controls.hasConsent(userId, purpose),
          true,
          'a stale (older-ts) withdrawal must not override the latest grant',
        );
        assert.doesNotThrow(() => controls.requireConsent(userId, purpose));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
