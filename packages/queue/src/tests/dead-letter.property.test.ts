// src/tests/dead-letter.property.test.ts
// Property 3: Dead-letter after exactly `maxAttempts`.
// Feature: queue-framework, Property 3
//
// Validates:
//   - Req 6.1: WHEN a job always fails and its `maxAttempts` is >= 1, THE Worker
//     SHALL attempt the job at most `maxAttempts` times.
//   - Req 6.2: WHEN a job's `maxAttempts`-th attempt fails, THE Retry_Engine
//     SHALL move the envelope to the Dead_Letter_Queue exactly once, and THE
//     Worker SHALL NOT re-enqueue that job for any further attempt.
//
// This property is driven through the `TestHarness` with an injected,
// advanceable clock and no real Redis. An always-failing job (a registered
// handler that always throws) is enqueued with a random attempt ceiling
// `maxAttempts` in [1, 6] and a deterministic fixed backoff (delay 100ms, no
// jitter) so retry Due_Times are simple to advance to. The job is repeatedly
// run: each failure before exhaustion re-enqueues the job as a delayed retry
// (emitting `job.retry`), and the harness advances the clock to that retry's
// Due_Time so it becomes eligible again; the `maxAttempts`-th failure moves the
// job to the DLQ (emitting a terminal `job.failed`). The loop is bounded to
// `maxAttempts + 2` iterations so it can never spin.
//
// Assertions per run:
//   - the job is attempted at most `maxAttempts` times (exactly `maxAttempts`
//     `job.started` events) (Req 6.1);
//   - the job is moved to the DLQ exactly once (one dead-letter record for the
//     job id, exactly one terminal `job.failed` event) at the `maxAttempts`-th
//     failure (Req 6.2);
//   - after dead-lettering the job is never re-enqueued (further advance +
//     runReady runs nothing, the DLQ count stays 1, and ready/delayed are 0)
//     (Req 6.2).

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

/** A random attempt ceiling >= 1 (Req 6.1 precondition). */
const maxAttemptsArb = fc.integer({ min: 1, max: 6 });

// ── Property 3: dead-letter after exactly maxAttempts ─────────────────────────

test('Feature: queue-framework, Property 3 — an always-failing job is attempted at most maxAttempts times, dead-lettered exactly once, and never re-enqueued', async () => {
  await fc.assert(
    fc.asyncProperty(maxAttemptsArb, async (maxAttempts) => {
      const harness = new TestHarness();
      // Deterministic, finite retry delays so advancing to a retry's Due_Time is
      // a simple `advance(nextRunAt - clockNow)`. No jitter.
      const backoff: BackoffPolicy = { strategy: 'fixed', delay: 100 };

      // An always-throwing handler makes every execution a failure.
      harness.register('always-fail', () => {
        throw new Error('always fails');
      });

      const jobId = await harness.enqueue(new AlwaysFailJob({}), { maxAttempts, backoff });

      // Drive the job until it is dead-lettered, advancing to each retry's
      // Due_Time. Bounded so the loop can never spin (Req 6.2 guarantees at most
      // one terminal transition; +2 is generous slack).
      const maxIterations = maxAttempts + 2;
      let iterations = 0;
      let deadLettered = false;

      while (iterations < maxIterations) {
        iterations += 1;
        const seen = harness.events.length;
        // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
        const ran = await harness.runReady();
        assert.equal(ran, 1, `iteration ${iterations}: expected exactly one ready job to run`);

        const newEvents = harness.events.slice(seen);
        const failedEvent = newEvents.find((e) => e.event === 'job.failed');
        if (failedEvent) {
          deadLettered = true;
          break;
        }

        const retryEvent = newEvents.find((e) => e.event === 'job.retry');
        assert.ok(
          retryEvent,
          `iteration ${iterations}: a non-terminal failure must emit a job.retry event`,
        );
        const nextRunAt = (retryEvent.payload as QueueEventMap['job.retry']).nextRunAt;
        // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
        await harness.advance(nextRunAt - harness.clockNow);
      }

      // The job reached the DLQ (never spun past the bound).
      assert.ok(deadLettered, `job was not dead-lettered within ${maxIterations} iterations`);

      // Req 6.1: attempted at most `maxAttempts` times — exactly `maxAttempts`
      // `job.started` events were recorded.
      const startedCount = harness.events.filter((e) => e.event === 'job.started').length;
      assert.equal(
        startedCount,
        maxAttempts,
        `expected exactly ${maxAttempts} attempts (job.started), saw ${startedCount}`,
      );

      // Req 6.2: exactly one terminal `job.failed` event.
      const failedCount = harness.events.filter((e) => e.event === 'job.failed').length;
      assert.equal(failedCount, 1, `expected exactly one terminal job.failed, saw ${failedCount}`);

      // Req 6.2: moved to the DLQ exactly once — a single dead-letter record for
      // this job id.
      const dlq = await harness.driver.listDeadLetters('default', 1000);
      const forJob = dlq.filter((r) => r.id === jobId);
      assert.equal(forJob.length, 1, `expected exactly one DLQ record for the job, saw ${forJob.length}`);
      assert.equal(forJob[0]!.attempts, maxAttempts, 'DLQ record should record all consumed attempts');

      // Req 6.2: never re-enqueued after dead-lettering — advancing the clock far
      // and reserving again runs nothing, the DLQ count is unchanged, and there
      // are no ready or delayed jobs left.
      const eventsBefore = harness.events.length;
      await harness.advance(10_000);
      const ranAfter = await harness.runReady();
      assert.equal(ranAfter, 0, 'no job should run after dead-lettering');
      assert.equal(
        harness.events.length,
        eventsBefore,
        'no further lifecycle events after dead-lettering',
      );

      const stats = await harness.driver.stats('default');
      assert.equal(stats.deadLettered, 1, 'DLQ count should stay 1 after dead-lettering');
      assert.equal(stats.ready, 0, 'no ready jobs should remain after dead-lettering');
      assert.equal(stats.delayed, 0, 'no delayed jobs should remain after dead-lettering');

      await harness.close();
    }),
    { numRuns: 100 },
  );
});
