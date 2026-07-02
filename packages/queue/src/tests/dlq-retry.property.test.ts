// src/tests/dlq-retry.property.test.ts
// Property 9: DLQ retry re-enqueues with a reset attempt count.
// Feature: queue-framework, Property 9
//
// Validates:
//   - Req 6.4: WHEN `deadLetters.retry(jobId)` is called, THE DeadLetterApi
//     SHALL remove the dead-letter record and re-enqueue an equivalent envelope
//     with `attempts` reset to 0, so the job is again eligible for up to
//     `maxAttempts` attempts.
//   - Req 6.5: WHEN `deadLetters.flush(queue?)` is called, THE DeadLetterApi
//     SHALL remove dead-letter records without re-enqueuing any job.
//
// Both properties are driven through the `TestHarness` with an injected,
// advanceable clock and no real Redis. The DLQ operations exercised here are the
// production facade `queue.deadLetters` surface (`retry`/`flush`) — the harness
// merely drives the underlying driver to get jobs into the DLQ deterministically
// and to observe eligibility afterwards.
//
// A job is dead-lettered by registering an always-throwing handler and driving
// the always-failing job (with a random attempt ceiling and a deterministic
// fixed backoff) until its terminal `job.failed` fires. Because the harness
// advances its own clock, retry Due_Times are reached with a simple
// `advance(nextRunAt - clockNow)`; all loops are bounded so they can never spin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { Job, type BackoffPolicy } from '../job.js';
import { TestHarness } from '../testing.js';
import type { QueueEventMap } from '../events.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

/** A job whose registered handler always throws, so every attempt fails. */
class AlwaysFailJob extends Job<Record<string, never>> {
  readonly type = 'always-fail';
}

/** A random attempt ceiling >= 1 (Req 6.1/6.4 precondition). */
const maxAttemptsArb = fc.integer({ min: 1, max: 6 });
/** A random, deterministic fixed backoff delay in ms (kept small and finite). */
const fixedDelayArb = fc.integer({ min: 50, max: 500 });
/** How many jobs to dead-letter for the flush property. */
const jobCountArb = fc.integer({ min: 1, max: 4 });

const ALWAYS_FAIL_TYPE = 'always-fail';

/**
 * Drive the currently-active always-failing single job (ready or delayed as a
 * retry) to its terminal `job.failed`, advancing the harness clock to each
 * retry's Due_Time. Returns once dead-lettered; throws if the bound is exceeded.
 * Only events at or after `sinceIndex` are considered so a fresh cycle can be
 * measured independently of an earlier one.
 */
async function driveToDeadLetter(
  harness: TestHarness,
  sinceIndex: number,
  maxAttempts: number,
): Promise<void> {
  const bound = maxAttempts + 3;
  for (let i = 0; i < bound; i += 1) {
    if (harness.events.slice(sinceIndex).some((e) => e.event === 'job.failed')) {
      return;
    }
    // Expose a delayed retry by advancing to the most recent retry's Due_Time.
    const retries = harness.events.slice(sinceIndex).filter((e) => e.event === 'job.retry');
    const lastRetry = retries[retries.length - 1];
    if (lastRetry) {
      const nextRunAt = (lastRetry.payload as QueueEventMap['job.retry']).nextRunAt;
      const delta = nextRunAt - harness.clockNow;
      if (delta > 0) {
        // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
        await harness.advance(delta);
      }
    }
    // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
    await harness.runReady();
  }
  if (!harness.events.slice(sinceIndex).some((e) => e.event === 'job.failed')) {
    throw new Error(`job was not dead-lettered within ${bound} iterations`);
  }
}

// ── Property 9 (retry): DLQ retry re-enqueues with a reset attempt count ──────

test('Feature: queue-framework, Property 9 — deadLetters.retry removes the record and re-enqueues with attempts reset to 0, granting a fresh maxAttempts budget', async () => {
  await fc.assert(
    fc.asyncProperty(maxAttemptsArb, fixedDelayArb, async (maxAttempts, delay) => {
      const harness = new TestHarness();
      const backoff: BackoffPolicy = { strategy: 'fixed', delay };

      // Always-throwing handler → every execution fails.
      harness.register(ALWAYS_FAIL_TYPE, () => {
        throw new Error('always fails');
      });

      const jobId = await harness.enqueue(new AlwaysFailJob({}), { maxAttempts, backoff });

      // ── Cycle 1: drive the job into the DLQ. ──────────────────────────────
      await driveToDeadLetter(harness, 0, maxAttempts);

      // It took exactly `maxAttempts` attempts to dead-letter the first time.
      const cycle1Attempts = harness.events.filter((e) => e.event === 'job.started').length;
      assert.equal(
        cycle1Attempts,
        maxAttempts,
        `cycle 1 should take exactly ${maxAttempts} attempts, saw ${cycle1Attempts}`,
      );

      // The DLQ holds exactly one record for the job before retry.
      const dlqBefore = await harness.queue.deadLetters.list('default');
      const recordsBefore = dlqBefore.filter((r) => r.id === jobId);
      assert.equal(recordsBefore.length, 1, 'exactly one DLQ record before retry');
      assert.equal(
        recordsBefore[0]!.attempts,
        maxAttempts,
        'the DLQ record records all consumed attempts',
      );

      // ── retry: remove the record and re-enqueue with attempts reset. ──────
      await harness.queue.deadLetters.retry(jobId);

      // Req 6.4: the dead-letter record is removed.
      const dlqAfterRetry = await harness.queue.deadLetters.list('default');
      assert.equal(
        dlqAfterRetry.filter((r) => r.id === jobId).length,
        0,
        'retry removes the dead-letter record',
      );
      const statsAfterRetry = await harness.driver.stats('default');
      assert.equal(statsAfterRetry.deadLettered, 0, 'DLQ count is decremented by retry');

      // Req 6.4: the job is re-enqueued as READY with attempts reset to 0. A
      // fresh reserve therefore consumes attempt 1 of a full `maxAttempts` budget
      // (the MemoryDriver increments attempts at reserve, so reset-to-0 yields 1
      // after the first reserve).
      const cycle2Start = harness.events.length;
      const reservation = await harness.driver.reserve(['default'], 30_000, harness.clockNow);
      assert.ok(reservation, 'the retried job is reservable (re-enqueued as ready)');
      assert.equal(reservation.envelope.id, jobId, 'the same job id is re-enqueued');
      assert.equal(
        reservation.envelope.attempts,
        1,
        'attempts reset to 0 → first reserve consumes attempt 1 of the fresh budget',
      );
      assert.equal(
        reservation.envelope.maxAttempts,
        maxAttempts,
        'the fresh attempt budget equals the original maxAttempts',
      );

      // Run that first fresh attempt (fails), then drive the rest to a second
      // dead-lettering.
      await harness.run(reservation);
      await driveToDeadLetter(harness, cycle2Start, maxAttempts);

      // Req 6.4: eligible for up to `maxAttempts` again — the fresh cycle took
      // exactly `maxAttempts` attempts to dead-letter, i.e. a full fresh budget.
      const cycle2Attempts = harness.events
        .slice(cycle2Start)
        .filter((e) => e.event === 'job.started').length;
      assert.equal(
        cycle2Attempts,
        maxAttempts,
        `retried job should get a fresh budget of exactly ${maxAttempts} attempts, saw ${cycle2Attempts}`,
      );

      // And it is once again in the DLQ exactly once with all attempts consumed.
      const dlqAfterCycle2 = await harness.queue.deadLetters.list('default');
      const recordsAfter = dlqAfterCycle2.filter((r) => r.id === jobId);
      assert.equal(recordsAfter.length, 1, 'exactly one DLQ record after the fresh cycle');
      assert.equal(
        recordsAfter[0]!.attempts,
        maxAttempts,
        'the fresh cycle again consumes exactly maxAttempts attempts',
      );

      await harness.close();
    }),
    { numRuns: 100 },
  );
});

// ── Property 9 (flush): flush removes records without re-enqueuing any ────────

test('Feature: queue-framework, Property 9 — deadLetters.flush removes all dead-letter records without re-enqueuing any job', async () => {
  await fc.assert(
    fc.asyncProperty(jobCountArb, fc.boolean(), async (jobCount, scopedFlush) => {
      const harness = new TestHarness();

      // Always-throwing handler and maxAttempts=1 so a single run dead-letters
      // every job immediately (no retry Due_Times to advance to).
      harness.register(ALWAYS_FAIL_TYPE, () => {
        throw new Error('always fails');
      });

      const jobIds: string[] = [];
      for (let i = 0; i < jobCount; i += 1) {
        // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
        const id = await harness.enqueue(new AlwaysFailJob({}), { maxAttempts: 1 });
        jobIds.push(id);
      }

      // One sweep reserves and runs every ready job; each fails and dead-letters
      // immediately (attempts 1 >= maxAttempts 1).
      const ran = await harness.runReady();
      assert.equal(ran, jobCount, `all ${jobCount} jobs should run once`);

      const dlqBefore = await harness.queue.deadLetters.list('default');
      assert.equal(dlqBefore.length, jobCount, `DLQ should hold all ${jobCount} records`);
      const statsBefore = await harness.driver.stats('default');
      assert.equal(statsBefore.deadLettered, jobCount, 'stats agree on DLQ size before flush');

      // ── flush: remove records, re-enqueue nothing. ───────────────────────
      const removed = await harness.queue.deadLetters.flush(scopedFlush ? 'default' : undefined);
      assert.equal(removed, jobCount, `flush should report removing all ${jobCount} records`);

      // Req 6.5: the DLQ is now empty.
      const dlqAfter = await harness.queue.deadLetters.list('default');
      assert.equal(dlqAfter.length, 0, 'flush empties the dead-letter store');

      // Req 6.5: nothing was re-enqueued — no ready or delayed jobs remain and a
      // fresh reservation sweep returns nothing.
      const statsAfter = await harness.driver.stats('default');
      assert.equal(statsAfter.deadLettered, 0, 'no dead-letter records remain after flush');
      assert.equal(statsAfter.ready, 0, 'flush re-enqueues nothing (no ready jobs)');
      assert.equal(statsAfter.delayed, 0, 'flush re-enqueues nothing (no delayed jobs)');

      const reservations = await harness.reserveAll();
      assert.equal(reservations.length, 0, 'no job becomes reservable after a flush');

      await harness.close();
    }),
    { numRuns: 100 },
  );
});
