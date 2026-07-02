// src/tests/rate-limit.property.test.ts
// Property test for per-queue rate limiting.
//
// Feature: queue-framework, Property 7: Per-queue rate limiting never exceeds
//   the configured quota
// Validates: Requirements 9.1, 9.2, 9.3
//
// Req 9.1: WHERE a per-queue limit of `R` requests per window `W` is configured,
//   THE Rate_Limiter SHALL ensure the number of jobs started for that queue
//   within any window of length `W` never exceeds `R`.
// Req 9.2: IF reserving a job would exceed the configured per-queue quota, THEN
//   THE Worker SHALL nack the reservation to a later Due_Time rather than
//   dropping the job.
// Req 9.3: WHEN a rate-limited job's window admits further processing, THE
//   Worker SHALL process the deferred job automatically.
//
// Strategy: run a REAL queue (MemoryDriver) with a REAL worker over an INJECTED,
// controllable clock (`() => now`). Configure `default` with a random
// `R`-per-`W` quota, dispatch a random burst of `N` jobs, and drive time by
// hand: at each fixed clock value the worker admits at most `R` starts and
// defers (nacks) the excess into the delayed set; we then advance the clock past
// the window and `promoteDue` to open the next window. Each handler records the
// clock value at which it started. We assert:
//   1. every dispatched job eventually runs exactly once (started === N) and
//      none is dropped/dead-lettered (deadLettered === 0) — deferral preserves
//      delivery (Req 9.2, 9.3);
//   2. for ANY window [t, t+W) over the collected start times, the number of
//      jobs started in that window never exceeds `R` (Req 9.1);
//   3. a rate deferral is transparent to the retry budget — every job runs on
//      attempt 1 (deferral is not a failed attempt).
// No Redis and no wall-clock timing decisions are used: all rate decisions key
// off the injected clock; real timers only pace the poll loop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { createQueue } from '../facade.js';
import { Job } from '../job.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

/** A minimal job whose handler simply records when it started. */
class BurstJob extends Job<{ n: number }> {
  readonly type = 'burst';
  constructor(n: number) {
    super({ n });
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Await until an (optionally async) predicate holds, or throw on timeout. */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 4000,
  stepMs = 2,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await sleep(stepMs);
  }
}

/**
 * The maximum number of starts that fall within any half-open window
 * `[t, t+W)` anchored at each observed start time. This is the observable
 * quantity Req 9.1 bounds by `R`.
 */
function maxStartsInAnyWindow(startTimes: readonly number[], windowMs: number): number {
  let worst = 0;
  for (const t of startTimes) {
    let count = 0;
    for (const s of startTimes) {
      if (s >= t && s < t + windowMs) {
        count += 1;
      }
    }
    if (count > worst) {
      worst = count;
    }
  }
  return worst;
}

// ── Property 7 ────────────────────────────────────────────────────────────────

test('Feature: queue-framework, Property 7 — starts per window never exceed R and excess jobs are deferred, not dropped', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 4 }), // R: requests admitted per window
      fc.integer({ min: 10, max: 1000 }), // W: window length in ms
      fc.integer({ min: 1, max: 8 }), // N: burst size dispatched at once
      async (R, W, N) => {
        // Injected, hand-advanced clock: all rate decisions key off `now`.
        let now = 0;
        const queue = createQueue({
          clock: () => now,
          rateLimits: { default: { requests: R, window: W } },
        });

        const started: Array<{ n: number; at: number; attempt: number }> = [];
        queue.register<{ n: number }>('burst', (payload, ctx) => {
          started.push({ n: payload.n, at: now, attempt: ctx.attempt });
        });

        // Dispatch the whole burst up front (all immediately eligible at now=0).
        for (let i = 0; i < N; i += 1) {
          // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
          await queue.dispatch(new BurstJob(i));
        }

        const worker = queue.work({ pollIntervalMs: 2 });
        worker.start();

        try {
          // A window is fully drained when nothing is ready and nothing is
          // in-flight: the worker has admitted all it can for the current clock
          // value and pushed the excess into the delayed set.
          const settled = async (): Promise<boolean> => {
            const stats = await queue.driver.stats('default');
            return stats.ready === 0 && worker.status().inFlight === 0;
          };

          // Drive one window at a time: let the current window drain, then open
          // the next by advancing the clock past `W` and promoting due jobs.
          for (;;) {
            // eslint-disable-next-line no-await-in-loop -- sequential windows
            await waitFor(settled);

            if (started.length >= N) {
              break; // every dispatched job has run
            }

            // eslint-disable-next-line no-await-in-loop
            const stats = await queue.driver.stats('default');
            if (stats.delayed === 0) {
              // No ready, no in-flight, no delayed, yet not all started → a job
              // was dropped. Stop and let the assertions below flag it.
              break;
            }

            // Open a fresh window: advance strictly past W (the store counts the
            // window inclusively, so +1 clears the previous window's hits) and
            // promote the deferred jobs so the worker can admit the next batch.
            now += W + 1;
            // eslint-disable-next-line no-await-in-loop
            await queue.driver.promoteDue(now);
          }

          const finalStats = await queue.driver.stats('default');
          const startTimes = started.map((s) => s.at);

          // (1) Delivery preserved: every job ran exactly once, none dropped.
          assert.equal(started.length, N, `expected all ${N} jobs to start, got ${started.length}`);
          assert.equal(
            new Set(started.map((s) => s.n)).size,
            N,
            'each dispatched job started exactly once',
          );
          assert.equal(finalStats.deadLettered, 0, 'no job was dropped/dead-lettered by rate limiting');
          assert.equal(finalStats.ready, 0);
          assert.equal(finalStats.delayed, 0);

          // (2) The quota invariant (Req 9.1): no window of length W contains
          // more than R starts.
          const worstWindow = maxStartsInAnyWindow(startTimes, W);
          assert.ok(
            worstWindow <= R,
            `a window of length ${W} contained ${worstWindow} starts, exceeding R=${R} ` +
              `(start times: ${JSON.stringify(startTimes)})`,
          );

          // (3) A rate deferral is transparent to the retry budget: every job
          // ran on its first attempt (deferral is not a failed attempt).
          for (const s of started) {
            assert.equal(s.attempt, 1, `job ${s.n} ran on attempt 1 (deferral is not a failure)`);
          }
          assert.equal(worker.status().failed, 0, 'rate deferrals are never counted as failures');
        } finally {
          // Always close to stop the poll loop and avoid leaked timers.
          await queue.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});
