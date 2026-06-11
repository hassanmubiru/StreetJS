// tests/abuse-login-lockout-pbt.test.ts
// Property-based test for the Abuse_Engine (Phase 6, Requirement 7).
//
// Feature: consumer-platform-security, Property 15 — Login lockout threshold.
// Validates: Requirements 7.1, 7.2
//
// R7.1: "WHEN the number of failed login attempts for an account reaches the
// configured threshold within the configured window, THE Abuse_Engine SHALL
// place the account into Account_Lockout for the configured duration."
// R7.2: "WHILE an account is in Account_Lockout, THE Abuse_Engine SHALL refuse
// authentication attempts for that account and SHALL return a response
// indicating the lockout."
//
// This file proves, across arbitrary thresholds, windows, and lockout
// durations, that the engine implements the defining contract exactly:
//   - every failed attempt strictly below the threshold is permitted and leaves
//     the account un-locked,
//   - the attempt that makes the failure count *reach* the threshold trips the
//     lockout and is itself refused with a lockout-indicating decision,
//   - while the lockout window is active, EVERY subsequent authentication
//     attempt for that account (failed or successful) is refused with the
//     LOCKED_OUT reason and the configured lockout duration as retry hint,
//   - once the lockout window has fully elapsed the account is no longer locked.
//
// An injected clock and explicit per-signal timestamps make all window timing
// fully deterministic; the engine is driven over the real in-memory
// CounterStore so the property exercises the genuine sliding-window lockout
// logic with no mocks. Kept in its own *-pbt.test.ts file per the repo
// convention, ≥100 runs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { AbuseEngine, type AbuseConfig } from '../security/abuse.js';
import { InMemoryCounterStore } from '../security/store.js';

const NUM_RUNS = 150;

const BASE_TS = 1_000_000;
// A login window comfortably larger than any timeline this test constructs, so
// all recorded failures stay within the same window and the failure count
// accumulates monotonically — isolating the threshold behaviour under test.
const LOGIN_WINDOW_MS = 10_000_000;
const ACCOUNT = 'user-42';
const IP = '198.51.100.9';

/**
 * Build an engine whose behaviourally-relevant knobs for this property are the
 * login failure `threshold` and the `lockoutMs` duration. Signup / spray / score
 * thresholds are set high enough that they never interfere with lockout
 * bookkeeping, isolating R7.1/R7.2. An injected fixed clock backs the default
 * "now", and explicit timestamps drive every windowed decision.
 */
function makeEngine(threshold: number, lockoutMs: number): AbuseEngine {
  const clock = () => BASE_TS;
  const cfg: AbuseConfig = {
    loginFailureThreshold: threshold,
    loginWindowMs: LOGIN_WINDOW_MS,
    lockoutMs,
    signupThreshold: Number.MAX_SAFE_INTEGER,
    signupWindowMs: LOGIN_WINDOW_MS,
    sprayDistinctAccounts: Number.MAX_SAFE_INTEGER,
    sprayWindowMs: LOGIN_WINDOW_MS,
    // Never let the suspicious-activity score short-circuit a decision: this
    // property is strictly about the failed-login lockout threshold.
    scoreThreshold: Number.MAX_SAFE_INTEGER,
  };
  return new AbuseEngine(cfg, new InMemoryCounterStore({ clock }), undefined, { clock });
}

// ── Generators ────────────────────────────────────────────────────────────────

// Configured failure threshold (≥2 so there is a genuine "below the threshold"
// region to exercise) and the lockout duration once tripped.
const thresholdArb = fc.integer({ min: 2, max: 8 });
const lockoutMsArb = fc.integer({ min: 60_000, max: 3_600_000 });

// ── Property 15: login lockout threshold (R7.1/R7.2) ────────────────────────────

// Feature: consumer-platform-security, Property 15: Login lockout threshold
// Validates: Requirements 7.1, 7.2
describe('Property 15: login lockout threshold', () => {
  it('permits failures below the threshold, locks out exactly at the threshold, and refuses while locked (R7.1/R7.2)', async () => {
    // A batch of probe attempts that occur while the lockout window is still
    // active. `failed` is varied so we prove BOTH failed and successful probes
    // are refused while locked out. Each probe carries a non-negative offset
    // from the trip time that stays within the lockout window.
    const probesArb = fc.array(
      fc.record({ failed: fc.boolean(), offsetFraction: fc.double({ min: 0, max: 1, noNaN: true }) }),
      { minLength: 1, maxLength: 10 },
    );

    await fc.assert(
      fc.asyncProperty(thresholdArb, lockoutMsArb, probesArb, async (threshold, lockoutMs, probes) => {
        const engine = makeEngine(threshold, lockoutMs);

        // Every failed attempt below the threshold must be permitted and must
        // leave the account un-locked.
        for (let i = 1; i < threshold; i++) {
          const decision = await engine.recordLoginAttempt({ ip: IP, accountId: ACCOUNT, failed: true, ts: BASE_TS });
          assert.equal(decision.allowed, true, `failure #${i} (< threshold ${threshold}) must be permitted`);
          assert.equal(
            await engine.isLockedOut(ACCOUNT, BASE_TS),
            false,
            `account must not be locked after only ${i} failure(s)`,
          );
        }

        // The attempt that makes the failure count REACH the threshold trips the
        // lockout (R7.1) and is itself refused with a lockout-indicating
        // decision (R7.2).
        const tripping = await engine.recordLoginAttempt({ ip: IP, accountId: ACCOUNT, failed: true, ts: BASE_TS });
        assert.equal(tripping.allowed, false, 'reaching the threshold must refuse the attempt');
        assert.equal(tripping.reason, 'LOCKED_OUT', 'the refusal must indicate a lockout');
        assert.equal(tripping.retryAfterMs, lockoutMs, 'the lockout duration is surfaced as the retry hint');
        assert.equal(await engine.isLockedOut(ACCOUNT, BASE_TS), true, 'account is in Account_Lockout once tripped');

        // WHILE the lockout window is active, every authentication attempt for
        // the account is refused with LOCKED_OUT, regardless of success/failure
        // (R7.2). Probes land within [BASE_TS, BASE_TS + lockoutMs].
        for (const { failed, offsetFraction } of probes) {
          const ts = BASE_TS + Math.floor(offsetFraction * lockoutMs);
          const decision = await engine.recordLoginAttempt({ ip: IP, accountId: ACCOUNT, failed, ts });
          assert.equal(decision.allowed, false, `attempt at +${ts - BASE_TS}ms must be refused while locked out`);
          assert.equal(decision.reason, 'LOCKED_OUT', 'a locked-out refusal must indicate the lockout');
          assert.equal(decision.retryAfterMs, lockoutMs, 'the lockout retry hint is the configured duration');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('does not lock out an account whose failures never reach the threshold (R7.1)', async () => {
    // Record strictly fewer failures than the threshold; the account must stay
    // un-locked and every such attempt must be permitted.
    await fc.assert(
      fc.asyncProperty(
        thresholdArb,
        lockoutMsArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        async (threshold, lockoutMs, fillFraction) => {
          const engine = makeEngine(threshold, lockoutMs);

          // Number of failures strictly below the threshold: 0 .. threshold-1.
          const failures = Math.floor(fillFraction * (threshold - 1));

          for (let i = 0; i < failures; i++) {
            const decision = await engine.recordLoginAttempt({
              ip: IP,
              accountId: ACCOUNT,
              failed: true,
              ts: BASE_TS,
            });
            assert.equal(decision.allowed, true, 'sub-threshold failures must be permitted');
          }

          assert.equal(
            await engine.isLockedOut(ACCOUNT, BASE_TS),
            false,
            `account with ${failures} failure(s) (< threshold ${threshold}) must not be locked`,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('clears the lockout once the configured duration fully elapses (R7.1)', async () => {
    // Trip a lockout with all failures at BASE_TS, then evaluate strictly after
    // the lockout window has rolled past the trip time: the account is no longer
    // locked, demonstrating the lockout lasts exactly the configured duration.
    await fc.assert(
      fc.asyncProperty(thresholdArb, lockoutMsArb, async (threshold, lockoutMs) => {
        const engine = makeEngine(threshold, lockoutMs);

        for (let i = 0; i < threshold; i++) {
          await engine.recordLoginAttempt({ ip: IP, accountId: ACCOUNT, failed: true, ts: BASE_TS });
        }
        assert.equal(await engine.isLockedOut(ACCOUNT, BASE_TS), true, 'precondition: account is locked out');

        // One millisecond past the lockout window relative to the trip time: the
        // lockout marker recorded at BASE_TS has rolled off.
        const afterLockout = BASE_TS + lockoutMs + 1;
        assert.equal(
          await engine.isLockedOut(ACCOUNT, afterLockout),
          false,
          'lockout must clear once its configured duration has fully elapsed',
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
