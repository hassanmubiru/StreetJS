// src/tests/worker-rate-limit.test.ts
// Task 6.3 — unit tests for per-queue rate limiting in the worker.
// The worker enforces a configured `R`-per-`W` quota BEFORE starting a reserved
// job: under the quota it records the start and runs; at the quota it defers the
// job via nack to a later Due_Time (never dropped) and processes it once the
// window admits it. A rate deferral must not consume an attempt toward
// maxAttempts (it is transparent to the retry budget).
// (Req 9.1, 9.2, 9.3, 9.4)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../facade.js';
import { Job } from '../job.js';

class NoopJob extends Job<{ n: number }> {
  readonly type = 'noop';
  constructor(n: number) {
    super({ n });
  }
}

/** Await until `predicate` holds or the deadline passes. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('worker starts at most R jobs per window and defers the excess (Req 9.1, 9.2, 9.4)', async () => {
  // Deterministic, advanceable clock so the rate window is fully controlled.
  let now = 0;
  const queue = createQueue({
    clock: () => now,
    rateLimits: { default: { requests: 2, window: 1000 } },
  });

  const started: Array<{ n: number; at: number; attempt: number }> = [];
  queue.register<{ n: number }>('noop', (payload, ctx) => {
    started.push({ n: payload.n, at: now, attempt: ctx.attempt });
  });

  await queue.dispatch(new NoopJob(1));
  await queue.dispatch(new NoopJob(2));
  await queue.dispatch(new NoopJob(3));

  const worker = queue.work({ pollIntervalMs: 5 });
  worker.start();

  // Only the first R=2 jobs may start in the window [0, 1000]; the 3rd is
  // deferred (nacked to a later Due_Time), never dropped.
  await waitFor(() => started.length === 2);
  // Give the loop a chance to (incorrectly) start the 3rd if the limit leaked.
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(started.length, 2, 'no more than R=2 jobs started within the window');

  // The excess job is deferred (delayed), not dropped and not dead-lettered.
  const deferredStats = await queue.driver.stats('default');
  assert.equal(deferredStats.ready, 0);
  assert.equal(deferredStats.delayed, 1, 'excess job deferred to the delayed set');
  assert.equal(deferredStats.deadLettered, 0, 'excess job is not dropped/dead-lettered');

  // Open the next window: advance past W and promote the due (deferred) job.
  now += 1001;
  await queue.driver.promoteDue(now);

  await waitFor(() => started.length === 3);
  await queue.close();

  // All three jobs ran exactly once, deferral preserved delivery.
  assert.deepEqual(
    started.map((s) => s.n).sort((a, b) => a - b),
    [1, 2, 3],
  );
  // Two jobs started in the first window, one in the second — never > R per window.
  assert.equal(started.filter((s) => s.at === 0).length, 2);
  assert.equal(started.filter((s) => s.at === 1001).length, 1);

  // A rate deferral must NOT burn an attempt: the deferred job still runs on its
  // first attempt (reserve→defer decremented the attempt; re-reserve restored it).
  for (const s of started) {
    assert.equal(s.attempt, 1, `job ${s.n} ran on attempt 1 (rate deferral transparent to budget)`);
  }

  const status = worker.status();
  assert.equal(status.processed, 3);
  assert.equal(status.failed, 0, 'rate deferrals are never counted as failures');
});

test('no rate limit configured for a queue → jobs run without deferral (Req 9.1)', async () => {
  let now = 0;
  const queue = createQueue({
    clock: () => now,
    // Limit is on "other", not on "default", so default jobs are unthrottled.
    rateLimits: { other: { requests: 1, window: 1000 } },
  });

  const started: number[] = [];
  queue.register<{ n: number }>('noop', (payload) => {
    started.push(payload.n);
  });

  for (let i = 0; i < 5; i += 1) {
    await queue.dispatch(new NoopJob(i));
  }

  const worker = queue.work({ pollIntervalMs: 5 });
  worker.start();

  await waitFor(() => started.length === 5);
  await queue.close();

  assert.equal(started.length, 5);
  const stats = await queue.driver.stats('default');
  assert.equal(stats.delayed, 0, 'unthrottled queue defers nothing');
});
