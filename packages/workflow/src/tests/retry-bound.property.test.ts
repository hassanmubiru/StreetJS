// src/tests/retry-bound.property.test.ts
// Property 4: Retry attempts never exceed maxAttempts.
// Feature: workflow-engine, Property 4
//
// Validates:
//   - Req 26.5: the property tests SHALL assert that the number of attempts of
//     an Activity never exceeds its configured `maxAttempts` (retry-bound).
//   - Req 6.2: WHEN an attempt fails and the consumed attempt count is less than
//     `maxAttempts`, another attempt is scheduled after the backoff delay.
//   - Req 6.7: WHEN an attempt fails and the consumed attempt count equals
//     `maxAttempts`, the Activity is treated as terminally failed.
//   - Req 6.8: WHERE no Retry_Policy is configured, the Activity is invoked at
//     most once.
//
// For a random `maxAttempts` (>= 1) and a random backoff policy, an activity
// that ALWAYS throws is invoked EXACTLY `maxAttempts` times (never more): we
// count the real invocations of the activity fn and assert the count equals
// `maxAttempts`, and that the returned `CommandOutcome` is `failed` with
// `attempts === maxAttempts`. The no-Retry_Policy case must invoke the activity
// exactly once. An immediate `delay` is injected so the test never waits for a
// real backoff timer, and a fixed `rng` keeps the `jitter` strategy
// deterministic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { createActivityExecutor } from '../executor.js';
import type { Backoff, RetryPolicy } from '../types.js';

// ── Injected collaborators (no real waiting, deterministic randomness) ─────────

/** A delay that resolves immediately so no real backoff timer elapses. */
const immediateDelay = async (): Promise<void> => {};

/** A fixed rng in [0, 1) so the `jitter` strategy is reproducible under test. */
const fixedRng = (): number => 0.5;

// ── Generators ─────────────────────────────────────────────────────────────────

/** A finite, non-negative delay in milliseconds. */
const nonNegativeMs = (max: number): fc.Arbitrary<number> =>
  fc.double({ min: 0, max, noNaN: true, noDefaultInfinity: true });

/** A random backoff policy across all four strategies (Req 6.3–6.6). */
const backoffArb: fc.Arbitrary<Backoff> = fc.oneof(
  fc.record({
    strategy: fc.constant<'fixed'>('fixed'),
    delayMs: nonNegativeMs(1_000),
  }),
  fc.record({
    strategy: fc.constant<'linear'>('linear'),
    baseMs: nonNegativeMs(1_000),
    maxDelayMs: nonNegativeMs(10_000),
  }),
  fc.record({
    strategy: fc.constant<'exponential'>('exponential'),
    baseMs: nonNegativeMs(1_000),
    multiplier: fc.double({ min: 1, max: 5, noNaN: true, noDefaultInfinity: true }),
    maxDelayMs: nonNegativeMs(10_000),
  }),
  fc.record({
    strategy: fc.constant<'jitter'>('jitter'),
    maxDelayMs: nonNegativeMs(10_000),
  }),
);

/** A total attempt ceiling (initial + retries), always >= 1. */
const maxAttemptsArb = fc.integer({ min: 1, max: 25 });

// ── Property 4a: with a Retry_Policy → invoked EXACTLY maxAttempts times ────────

test('Feature: workflow-engine, Property 4 — a persistently-failing activity is invoked exactly maxAttempts times and terminally fails', async () => {
  await fc.assert(
    fc.asyncProperty(maxAttemptsArb, backoffArb, async (maxAttempts, backoff) => {
      const executor = createActivityExecutor({ delay: immediateDelay, rng: fixedRng });

      // Count the REAL invocations of the activity fn. The activity always throws
      // so every attempt is a failure and the executor must exhaust the policy.
      let invocations = 0;
      const activity = (): never => {
        invocations += 1;
        throw new Error(`boom #${invocations}`);
      };

      const retry: RetryPolicy = { maxAttempts, backoff };
      const outcome = await executor.run({ seq: 1, activity, options: { retry } });

      // Bound (Req 26.5, 6.2): the activity is invoked EXACTLY maxAttempts times,
      // never more — one initial attempt plus (maxAttempts - 1) scheduled retries.
      assert.equal(
        invocations,
        maxAttempts,
        `invoked ${invocations} times, expected exactly maxAttempts ${maxAttempts}`,
      );

      // Terminal failure (Req 6.7): the outcome is `failed` and its recorded
      // attempt count equals maxAttempts.
      assert.equal(outcome.status, 'failed', `expected failed outcome, got ${outcome.status}`);
      assert.equal(
        outcome.attempts,
        maxAttempts,
        `outcome.attempts ${outcome.attempts} !== maxAttempts ${maxAttempts}`,
      );
    }),
    { numRuns: 100 },
  );
});

// ── Property 4b: with NO Retry_Policy → invoked at most once (exactly once) ─────

test('Feature: workflow-engine, Property 4 — with no Retry_Policy a failing activity is invoked at most once', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer(), async (seq) => {
      const executor = createActivityExecutor({ delay: immediateDelay, rng: fixedRng });

      let invocations = 0;
      const activity = (): never => {
        invocations += 1;
        throw new Error('boom');
      };

      // No `retry` option: the activity must run at most once (Req 6.8).
      const outcome = await executor.run({ seq, activity });

      assert.equal(invocations, 1, `invoked ${invocations} times, expected exactly once`);
      assert.equal(outcome.status, 'failed', `expected failed outcome, got ${outcome.status}`);
      assert.equal(outcome.attempts, 1, `outcome.attempts ${outcome.attempts} !== 1`);
    }),
    { numRuns: 100 },
  );
});
