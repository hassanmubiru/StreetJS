// src/tests/worker-concurrency.property.test.ts
// Property test for the worker concurrency bound.
//
// Feature: queue-framework, Property 6: Worker concurrency never exceeds the
//   configured limit
// Validates: Requirements 7.1, 7.2
//
// Req 7.1: WHILE a Worker is configured with concurrency `C`, THE Worker SHALL
//   never execute more than `C` jobs simultaneously for any arrival pattern of
//   ready jobs.
// Req 7.2: WHILE the number of in-flight jobs in a Worker equals its
//   concurrency limit, THE Worker SHALL defer reserving additional jobs until a
//   slot is freed.
//
// Strategy: the TestHarness executor models reservations serially and therefore
// cannot exhibit true simultaneous execution, so the concurrency BOUND is
// exercised against the REAL worker (`createQueue().work({ concurrency })`).
// A gating handler increments a shared in-flight counter on entry, records the
// running peak, then blocks on a release gate before decrementing on exit. By
// holding many jobs in-flight at once we force the worker to saturate; the
// worker must never let the observed peak exceed `C` for any random `C` and any
// arrival pattern (some jobs dispatched before `start()`, the rest after).
//
// Each run is kept small and fast (few jobs, 1ms poll, gates released promptly)
// and every run fully drains and `await queue.close()`s so no timers leak
// between runs. Real timers are involved, so `numRuns` stays at 100 with a tight
// per-run budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { createQueue } from '../facade.js';
import { Job } from '../job.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

/** A minimal concrete Job used solely to occupy a worker slot while gated. */
class GatedJob extends Job<{ index: number }> {
  readonly type = 'gated';
  constructor(index: number) {
    super({ index });
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ── Property 6 ────────────────────────────────────────────────────────────────

test('Feature: queue-framework, Property 6 — worker never executes more jobs simultaneously than its configured concurrency', async () => {
  await fc.assert(
    fc.asyncProperty(
      // Random concurrency bound C.
      fc.integer({ min: 1, max: 5 }),
      // Random total number of jobs (kept small so each run drains quickly).
      fc.integer({ min: 1, max: 8 }),
      // Random arrival pattern: how many jobs are dispatched BEFORE the worker
      // starts; the remainder arrive AFTER it is already running.
      fc.integer({ min: 0, max: 8 }),
      async (concurrency, jobCount, preSplitRaw) => {
        const preSplit = Math.min(preSplitRaw, jobCount);

        const queue = createQueue();

        // Shared instrumentation observed from inside the handler.
        let inFlight = 0;
        let peak = 0;
        let done = 0;
        // Resolvers for jobs currently parked in the handler (holding a slot).
        const gates: Array<() => void> = [];

        queue.register<{ index: number }>('gated', async () => {
          inFlight += 1;
          if (inFlight > peak) {
            peak = inFlight;
          }
          // Park here holding the slot until the driver loop releases us. This
          // is what lets multiple jobs be simultaneously in-flight so the bound
          // is actually stressed.
          await new Promise<void>((resolve) => {
            gates.push(resolve);
          });
          inFlight -= 1;
          done += 1;
        });

        try {
          // Arrival pattern part 1: dispatch `preSplit` jobs before starting.
          for (let i = 0; i < preSplit; i += 1) {
            // eslint-disable-next-line no-await-in-loop -- sequential dispatch is intended
            await queue.dispatch(new GatedJob(i));
          }

          const worker = queue.work({ concurrency, pollIntervalMs: 1 });
          worker.start();

          // Arrival pattern part 2: dispatch the remaining jobs after start so
          // they arrive while the worker is already running.
          for (let i = preSplit; i < jobCount; i += 1) {
            // eslint-disable-next-line no-await-in-loop -- sequential dispatch is intended
            await queue.dispatch(new GatedJob(i));
          }

          // Drain: repeatedly release any parked jobs so freed slots refill,
          // until every job has completed. The bound is asserted continuously
          // via `peak` recorded on handler entry.
          const deadline = Date.now() + 5000;
          while (done < jobCount) {
            if (Date.now() > deadline) {
              throw new Error(
                `drain timed out: done=${done}/${jobCount} inFlight=${inFlight} peak=${peak} C=${concurrency}`,
              );
            }
            // The worker must never have parked more than C jobs at once.
            assert.ok(
              gates.length <= concurrency,
              `parked ${gates.length} jobs simultaneously exceeds concurrency ${concurrency}`,
            );
            while (gates.length > 0) {
              gates.shift()!();
            }
            // eslint-disable-next-line no-await-in-loop -- let the worker refill freed slots
            await sleep(2);
          }

          await worker.stop();
        } finally {
          // Release any stragglers so a graceful close can never hang, then
          // fully close so no poll timer leaks into the next run.
          while (gates.length > 0) {
            gates.shift()!();
          }
          await queue.close();
        }

        // Primary invariant (Req 7.1/7.2): the observed simultaneous peak never
        // exceeds the configured bound.
        assert.ok(
          peak <= concurrency,
          `observed peak ${peak} exceeded configured concurrency ${concurrency}`,
        );
        // Sanity: with at least one job, work actually ran (guards against a
        // vacuously-true peak of 0 that would make the bound check meaningless).
        assert.ok(peak >= 1, 'expected at least one job to have executed');
      },
    ),
    { numRuns: 100 },
  );
});
