// src/tests/at-least-once.property.test.ts
// Property test for at-least-once delivery with a bounded attempt ceiling.
//
// Feature: queue-framework, Property 5: At-least-once delivery with a bounded
//   attempt ceiling
// Validates: Requirements 14.1, 14.2
//
// Req 14.1: WHEN jobs are dispatched and workers may crash such that un-acked
//   reservations let their Visibility_Lease expire, THE Queue_Package SHALL
//   eventually deliver every job to a handler at least once.
// Req 14.2: THE Queue_Package SHALL execute a job to a successful ack no more
//   than `maxAttempts` times in total, and SHALL ack a successful job exactly
//   once without re-delivering it.
//
// Strategy: generate a set of jobs, each with a planned number of "crashes"
// (un-acked reservations) before it finally succeeds, and a random attempt
// ceiling. Drive the MemoryDriver directly through the TestHarness with an
// injected, advanceable clock (no Redis, no wall-clock timing):
//
//   1. `reserveAll()` reserves every ready job (attempts consumed at reserve).
//   2. For a job that still has planned crashes, we SIMULATE a worker crash by
//      dropping the reservation — we never ack/nack it, so its Visibility_Lease
//      stays held. Then `advance(visibilityMs + 1)` expires the lease so the
//      next `reserveAll()` reclaims it (MemoryDriver.reserve reclaims expired
//      leases) and re-delivers it.
//   3. For a job whose crashes are exhausted, we `run()` it — the harness
//      executes the registered handler and acks on success.
//
// Assertions (faithful to the DOCUMENTED at-least-once, not exactly-once,
// semantics):
//   - Every job is delivered (reserved) at least once and ultimately succeeds
//     (its handler runs and completes), satisfying at-least-once (Req 14.1).
//   - A job that has succeeded is NEVER re-delivered afterward, and is acked
//     exactly once (exactly one `job.completed`), so it is executed to a
//     successful ack exactly once — never more than `maxAttempts` (Req 14.2).
//   - After every job succeeds, the driver holds no ready/delayed/reserved copy
//     of any job and none are in the dead-letter queue (no re-delivery, no DLQ).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { Job } from '../job.js';
import { TestHarness } from '../testing.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

/** A job whose handler always succeeds; crashes are simulated by the harness. */
class CrashJob extends Job<{ index: number }> {
  readonly type = 'crash-job';
}

/** Visibility lease used by the harness; a crashed lease is reclaimed after it. */
const VISIBILITY_MS = 1000;

interface JobSpec {
  /** Number of times the job is reserved then abandoned (worker crash) first. */
  readonly crashes: number;
  /** Attempt ceiling for the job. */
  readonly maxAttempts: number;
  /** Priority, so reservation order across the batch is non-trivial. */
  readonly priority: number;
}

// ── Property 5 ────────────────────────────────────────────────────────────────

test('Feature: queue-framework, Property 5 — every job is delivered at least once despite crashes, and a succeeding job is acked exactly once and never re-delivered', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          crashes: fc.integer({ min: 0, max: 3 }),
          maxAttempts: fc.integer({ min: 1, max: 3 }),
          priority: fc.integer({ min: -2, max: 2 }),
        }),
        { minLength: 1, maxLength: 8 },
      ),
      async (specs: JobSpec[]) => {
        const harness = new TestHarness({ visibilityMs: VISIBILITY_MS });
        try {
          // Handler always succeeds; a "crash" is simulated by never running it.
          harness.register('crash-job', () => {
            /* success */
          });

          const remainingCrashes = new Map<string, number>();
          const deliveries = new Map<string, number>();
          const succeeded = new Map<string, boolean>();
          const maxAttemptsById = new Map<string, number>();
          const plannedCrashes = new Map<string, number>();

          for (let i = 0; i < specs.length; i += 1) {
            const spec = specs[i]!;
            // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
            const id = await harness.enqueue(new CrashJob({ index: i }), {
              maxAttempts: spec.maxAttempts,
              priority: spec.priority,
            });
            remainingCrashes.set(id, spec.crashes);
            plannedCrashes.set(id, spec.crashes);
            deliveries.set(id, 0);
            succeeded.set(id, false);
            maxAttemptsById.set(id, spec.maxAttempts);
          }

          // A generous, finite bound: each job needs (crashes + 1) delivery
          // rounds at most, plus slack. Guards against any accidental infinite
          // loop so a real bug surfaces as a failure, not a hang.
          const guardLimit =
            specs.reduce((total, spec) => total + spec.crashes, 0) + specs.length + 10;
          let guard = 0;

          while ([...succeeded.values()].some((done) => !done)) {
            guard += 1;
            assert.ok(guard <= guardLimit, `drive loop exceeded guard limit ${guardLimit}`);

            // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
            const reservations = await harness.reserveAll();

            if (reservations.length === 0) {
              // Remaining jobs are crashed leases not yet expired: advance past
              // the visibility lease so the next reserve reclaims them.
              // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
              await harness.advance(VISIBILITY_MS + 1);
              continue;
            }

            let anyCrashed = false;
            for (const reservation of reservations) {
              const id = reservation.envelope.id;
              deliveries.set(id, deliveries.get(id)! + 1);

              // Req 14.2: a successfully-acked job must never be re-delivered.
              assert.equal(
                succeeded.get(id),
                false,
                `job ${id} was re-delivered after a successful ack`,
              );

              const crashesLeft = remainingCrashes.get(id)!;
              if (crashesLeft > 0) {
                // Simulate a worker crash: leave the reservation un-acked so its
                // Visibility_Lease expires and the job is reclaimed/redelivered.
                remainingCrashes.set(id, crashesLeft - 1);
                anyCrashed = true;
              } else {
                // Crashes exhausted: execute the handler and ack on success.
                // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
                await harness.run(reservation);
                succeeded.set(id, true);
              }
            }

            if (anyCrashed) {
              // Expire the abandoned leases so they are reclaimed next round.
              // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
              await harness.advance(VISIBILITY_MS + 1);
            }
          }

          // ── Post-conditions ──────────────────────────────────────────────

          // Count lifecycle events per job id from the recorded event stream.
          const startedCount = new Map<string, number>();
          const completedCount = new Map<string, number>();
          let failedEvents = 0;
          let retryEvents = 0;
          let timeoutEvents = 0;
          for (const { event, payload } of harness.events) {
            const id = (payload as { ctx: { id: string } }).ctx.id;
            if (event === 'job.started') {
              startedCount.set(id, (startedCount.get(id) ?? 0) + 1);
            } else if (event === 'job.completed') {
              completedCount.set(id, (completedCount.get(id) ?? 0) + 1);
            } else if (event === 'job.failed') {
              failedEvents += 1;
            } else if (event === 'job.retry') {
              retryEvents += 1;
            } else if (event === 'job.timeout') {
              timeoutEvents += 1;
            }
          }

          // No job in this property ever fails/retries/times out — every job
          // eventually succeeds, so only started/completed are expected.
          assert.equal(failedEvents, 0, 'expected no job.failed events (nothing dead-lettered)');
          assert.equal(retryEvents, 0, 'expected no job.retry events');
          assert.equal(timeoutEvents, 0, 'expected no job.timeout events');

          for (const id of maxAttemptsById.keys()) {
            // Req 14.1: delivered (reserved) at least once, and its handler ran.
            assert.ok(deliveries.get(id)! >= 1, `job ${id} was never delivered`);
            assert.ok(
              (startedCount.get(id) ?? 0) >= 1,
              `job ${id} handler never started (not delivered to a handler)`,
            );

            // Each planned crash causes exactly one re-delivery, then success:
            // total deliveries == crashes + 1 (proves reclaim/redelivery works).
            assert.equal(
              deliveries.get(id),
              plannedCrashes.get(id)! + 1,
              `job ${id} delivery count should equal crashes + 1`,
            );

            // Req 14.2: acked exactly once (exactly one successful completion),
            // which is never more than maxAttempts.
            assert.equal(
              completedCount.get(id),
              1,
              `job ${id} should be acked/completed exactly once`,
            );
            assert.ok(
              completedCount.get(id)! <= maxAttemptsById.get(id)!,
              `job ${id} completed more than maxAttempts times`,
            );

            // Handler started exactly once too (only the successful run).
            assert.equal(
              startedCount.get(id),
              1,
              `job ${id} handler should have started exactly once (the successful run)`,
            );
          }

          // Req 14.2: after every job succeeds, no copy remains anywhere in the
          // driver (never re-delivered) and none is in the dead-letter queue.
          const stats = await harness.driver.stats();
          assert.equal(stats.ready, 0, 'no ready jobs should remain');
          assert.equal(stats.delayed, 0, 'no delayed jobs should remain');
          assert.equal(stats.reserved, 0, 'no reserved jobs should remain');
          assert.equal(stats.deadLettered, 0, 'no dead-lettered jobs should remain');

          const dead = await harness.driver.listDeadLetters(undefined, -1);
          assert.equal(dead.length, 0, 'no succeeding job should be dead-lettered');
        } finally {
          await harness.close();
        }
      },
    ),
    { numRuns: 100 },
  );
});
