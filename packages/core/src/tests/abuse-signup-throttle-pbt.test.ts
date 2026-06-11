// tests/abuse-signup-throttle-pbt.test.ts
// Property-based test for the Abuse_Engine (Phase 6, Requirement 7).
//
// Feature: consumer-platform-security, Property 16 — Signup throttling
// threshold.
// Validates: Requirements 7.3
//
// R7.3: "WHEN the number of signup attempts from a single source reaches the
// configured threshold within the configured window, THE Abuse_Engine SHALL
// throttle further signup attempts from that source."
//
// This file proves, across arbitrary thresholds, windows, and sequences of
// signup attempts from a single source, that `recordSignupAttempt` reflects the
// defining criterion exactly: an attempt is permitted while the per-source
// count within the sliding window is below the configured `signupThreshold`,
// and is throttled (HTTP-shaped SIGNUP_THROTTLED decision) once the count
// reaches the threshold. In particular:
//   - the (1-indexed) i-th in-window attempt is allowed iff i < threshold,
//   - attempts that have aged past the sliding window do not count toward the
//     threshold, so the source is permitted again once earlier attempts expire.
//
// An injected clock and explicit per-attempt timestamps make all window timing
// fully deterministic; the engine is driven over the real in-memory
// CounterStore so the property exercises the actual sliding-window throttling
// logic with no mocks. Kept in its own *-pbt.test.ts file per the repo
// convention, with ≥100 runs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { AbuseEngine, type AbuseConfig } from '../security/abuse.js';
import { InMemoryCounterStore } from '../security/store.js';

const NUM_RUNS = 100;

const BASE_TS = 1_000_000;
const IP = '198.51.100.23';

/**
 * Build an engine whose only behaviourally-relevant knobs for this property are
 * `signupThreshold` and `signupWindowMs`. Login / spray / score thresholds are
 * set high enough that they never interfere with signup bookkeeping, isolating
 * R7.3.
 */
function makeEngine(signupThreshold: number, signupWindowMs: number): AbuseEngine {
  const clock = () => BASE_TS;
  const cfg: AbuseConfig = {
    loginFailureThreshold: 1_000_000, // never trip a lockout during this test
    loginWindowMs: signupWindowMs,
    lockoutMs: signupWindowMs,
    signupThreshold,
    signupWindowMs,
    sprayDistinctAccounts: 1_000_000, // never classify a spray during this test
    sprayWindowMs: signupWindowMs,
    scoreThreshold: Number.MAX_SAFE_INTEGER, // never trip the score response
  };
  return new AbuseEngine(cfg, new InMemoryCounterStore({ clock }), undefined, { clock });
}

// ── Generators ────────────────────────────────────────────────────────────────

// Threshold spanning small/boundary values up through larger populations.
const thresholdArb = fc.integer({ min: 1, max: 12 });

// Number of signup attempts to drive, spanning below/at/above the threshold.
const attemptCountArb = fc.integer({ min: 1, max: 20 });

const windowArb = fc.integer({ min: 1_000, max: 600_000 });

// ── Property 16: signup throttling threshold (R7.3) ─────────────────────────────

// Feature: consumer-platform-security, Property 16: Signup throttling threshold
// Validates: Requirements 7.3
describe('Property 16: signup throttling threshold', () => {
  it('permits attempts below the threshold and throttles once the in-window count reaches it (R7.3)', async () => {
    await fc.assert(
      fc.asyncProperty(thresholdArb, attemptCountArb, windowArb, async (threshold, attempts, windowMs) => {
        const engine = makeEngine(threshold, windowMs);

        // All attempts share one timestamp, so they all fall inside the window;
        // the running count after the i-th attempt is exactly i.
        for (let i = 1; i <= attempts; i++) {
          const decision = await engine.recordSignupAttempt(IP, BASE_TS);

          // The throttle trips when the count reaches the threshold: count == i,
          // so the attempt is allowed iff i < threshold.
          const expectedAllowed = i < threshold;
          assert.equal(
            decision.allowed,
            expectedAllowed,
            `attempt #${i} with threshold ${threshold}: expected allowed=${expectedAllowed}`,
          );

          if (!expectedAllowed) {
            assert.equal(decision.reason, 'SIGNUP_THROTTLED', 'throttled attempts must report SIGNUP_THROTTLED');
            assert.equal(decision.retryAfterMs, windowMs, 'throttled decision should advise the window as retry-after');
          } else {
            assert.equal(decision.reason, undefined, 'permitted attempts must carry no rejection reason');
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('permits a source again once earlier attempts age past the sliding window (R7.3)', async () => {
    await fc.assert(
      fc.asyncProperty(thresholdArb, windowArb, async (threshold, windowMs) => {
        const engine = makeEngine(threshold, windowMs);

        // Saturate the window: drive exactly `threshold` attempts so the source
        // is throttled (count reaches the threshold on the final attempt).
        let last;
        for (let i = 0; i < threshold; i++) {
          last = await engine.recordSignupAttempt(IP, BASE_TS);
        }
        assert.equal(last!.allowed, false, 'source should be throttled once the threshold is reached');

        // Strictly after the window has rolled past every recorded attempt
        // (now - windowMs > BASE_TS), all earlier attempts are excluded, so the
        // next attempt's count is 1 again and is permitted whenever threshold>1.
        const afterWindow = BASE_TS + windowMs + 1;
        const decision = await engine.recordSignupAttempt(IP, afterWindow);
        const expectedAllowed = 1 < threshold;
        assert.equal(
          decision.allowed,
          expectedAllowed,
          'aged-out attempts must not count toward the throttle threshold',
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
