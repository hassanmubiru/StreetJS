// src/tests/retry-backoff.property.test.ts
// Property 4: Retry/backoff delay is monotonic up to the cap.
// Feature: queue-framework, Property 4
//
// Validates:
//   - Req 5.2: an `exponential` backoff (base delay, multiplier >= 1, maxDelay
//     cap) yields a retry delay for attempt `n` that is non-decreasing in `n`
//     and never exceeds `maxDelay`.
//   - Req 5.3: a `fixed` backoff yields a constant retry delay for every attempt.
//   - Req 5.4: a scheduled retry's Due_Time equals the failure time plus the
//     computed backoff delay (`runAt = failureTime + delay`).
//
// The monotonicity/cap and fixed-constant assertions exercise the pure
// `computeBackoffDelay` engine directly across attempts (no jitter, so fully
// deterministic). The `runAt = failureTime + delay` assertion is driven through
// the `TestHarness` with an injected, advanceable clock and no real Redis: a job
// is enqueued with a backoff + retries, forced to fail, run, and the emitted
// `job.retry` event's `nextRunAt` is checked against `clockNow + delay` for each
// successive attempt.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { computeBackoffDelay } from '../retry.js';
import { Job, type BackoffPolicy } from '../job.js';
import { TestHarness } from '../testing.js';
import type { QueueEventMap } from '../events.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

/** A minimal concrete job whose only purpose is to be dispatched and retried. */
class RetryJob extends Job<Record<string, never>> {
  readonly type = 'retry-me';
}

/**
 * A finite, bounded numeric generator for delays in milliseconds. Bounded so the
 * exponential term stays well within `Number` range while still frequently
 * exceeding `maxDelay` (exercising the cap). No NaN / no infinities so the
 * arithmetic is total.
 */
const nonNegativeMs = (max: number): fc.Arbitrary<number> =>
  fc.double({ min: 0, max, noNaN: true, noDefaultInfinity: true });

/** A multiplier strictly >= 1 (may be fractional), per the exponential contract. */
const multiplierArb = fc.double({ min: 1, max: 5, noNaN: true, noDefaultInfinity: true });

/** Number of successive attempts to observe. */
const attemptsArb = fc.integer({ min: 1, max: 8 });

// ── Property 4a: exponential delay is non-decreasing and capped ───────────────

test('Feature: queue-framework, Property 4 — exponential backoff is non-decreasing in attempt and never exceeds maxDelay', () => {
  fc.assert(
    fc.property(
      nonNegativeMs(10_000),
      multiplierArb,
      nonNegativeMs(100_000),
      attemptsArb,
      (base, multiplier, maxDelay, attempts) => {
        const backoff: BackoffPolicy = {
          strategy: 'exponential',
          delay: base,
          multiplier,
          maxDelay,
          // No jitter: the delay is fully deterministic.
        };

        let previous = -Infinity;
        for (let n = 1; n <= attempts; n += 1) {
          const delay = computeBackoffDelay(n, backoff);
          // Never exceeds the cap (Req 5.2).
          assert.ok(
            delay <= maxDelay,
            `attempt ${n}: delay ${delay} exceeded maxDelay ${maxDelay}`,
          );
          // Non-decreasing in the attempt number (Req 5.2).
          assert.ok(
            delay >= previous,
            `attempt ${n}: delay ${delay} decreased below previous ${previous}`,
          );
          previous = delay;
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ── Property 4b: fixed delay is constant across attempts ──────────────────────

test('Feature: queue-framework, Property 4 — fixed backoff yields a constant delay for every attempt', () => {
  fc.assert(
    fc.property(
      nonNegativeMs(100_000),
      // An optional cap; a fixed delay is constant regardless of the cap.
      fc.option(nonNegativeMs(100_000), { nil: undefined }),
      attemptsArb,
      (base, maxDelay, attempts) => {
        const backoff: BackoffPolicy = {
          strategy: 'fixed',
          delay: base,
          maxDelay,
        };

        const first = computeBackoffDelay(1, backoff);
        for (let n = 1; n <= attempts; n += 1) {
          const delay = computeBackoffDelay(n, backoff);
          assert.equal(
            delay,
            first,
            `attempt ${n}: fixed delay ${delay} differed from first ${first}`,
          );
        }
        // The constant delay never exceeds a configured cap either.
        if (maxDelay !== undefined) {
          assert.ok(first <= maxDelay, `fixed delay ${first} exceeded maxDelay ${maxDelay}`);
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ── Property 4c: retry runAt equals failure time plus the delay ───────────────

test('Feature: queue-framework, Property 4 — each retry runAt equals failure time plus the computed backoff delay', async () => {
  await fc.assert(
    fc.asyncProperty(
      nonNegativeMs(10_000),
      multiplierArb,
      nonNegativeMs(100_000),
      attemptsArb,
      async (base, multiplier, maxDelay, attempts) => {
        const backoff: BackoffPolicy = {
          strategy: 'exponential',
          delay: base,
          multiplier,
          maxDelay,
          // No jitter → deterministic delay regardless of the rng.
        };

        const harness = new TestHarness();
        // retries = attempts → attempt ceiling = attempts + 1, so every one of
        // the `attempts` observed failures produces a retry (never a dead-letter).
        await harness.enqueue(new RetryJob({}), { backoff, retries: attempts });

        for (let n = 1; n <= attempts; n += 1) {
          const failureTime = harness.clockNow;
          const seen = harness.events.length;

          harness.failNext();
          const ran = await harness.runReady();
          assert.equal(ran, 1, `attempt ${n}: expected exactly one ready job to run`);

          const retryEvent = harness.events
            .slice(seen)
            .find((e) => e.event === 'job.retry');
          assert.ok(retryEvent, `attempt ${n}: expected a job.retry event`);

          const payload = retryEvent.payload as QueueEventMap['job.retry'];
          const expectedDelay = computeBackoffDelay(n, backoff);

          // runAt = failureTime + delay (Req 5.4).
          assert.equal(
            payload.nextRunAt,
            failureTime + expectedDelay,
            `attempt ${n}: nextRunAt ${payload.nextRunAt} !== failureTime ${failureTime} + delay ${expectedDelay}`,
          );

          // Advance to the retry's Due_Time so it becomes eligible for the next
          // reservation. The delta is exactly the (non-negative) delay.
          await harness.advance(payload.nextRunAt - harness.clockNow);
        }

        await harness.close();
      },
    ),
    { numRuns: 100 },
  );
});
