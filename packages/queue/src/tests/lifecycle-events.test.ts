// src/tests/lifecycle-events.test.ts
// Task 11.2 — unit tests for typed lifecycle event emission (Req 11.1–11.5).
//
// Asserts that the queue emits its typed lifecycle events at the correct
// transitions and with the documented payloads:
//   - Req 11.1: `job.started`   when a worker begins executing            { ctx }
//   - Req 11.2: `job.completed`  on success (with `durationMs`)            { ctx, durationMs }
//   - Req 11.3: `job.retry`      on re-enqueue (serialized error, next     { ctx, error, nextRunAt, nextAttempt }
//                                Due_Time, next attempt number)
//   - Req 11.4: `job.failed`     terminal, on dead-lettering (serialized   { ctx, error }
//                                error)
//   - Req 11.5: `job.timeout`    when a per-attempt timeout fires          { ctx, timeoutMs }
//
// started/completed/retry/failed are asserted through the `TestHarness` and its
// `assertEvents` helper: the harness drives execution deterministically with an
// injected, advanceable clock and no real Redis, recording the ordered event
// stream. `job.timeout` is NOT modelled by the harness executor (a per-attempt
// timeout is a real-timer concern owned by the real worker), so it is covered
// through the REAL worker (`createQueue().work()`) with a small timeout and a
// slow, abort-aware handler, subscribing via `queue.on('job.timeout', ...)`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Job } from '../job.js';
import { TestHarness } from '../testing.js';
import { createQueue } from '../facade.js';
import type { QueueEventMap } from '../events.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface EmailPayload {
  readonly to: string;
}

/** A simple job type used across the harness lifecycle tests. */
class SendEmailJob extends Job<EmailPayload> {
  readonly type = 'send-email';
}

const EMAIL_TYPE = 'send-email';

/** Narrow a union lifecycle payload to one carrying a numeric `durationMs`. */
function hasNumericDuration(payload: QueueEventMap[keyof QueueEventMap]): boolean {
  return typeof (payload as { durationMs?: unknown }).durationMs === 'number';
}

/** Narrow a union lifecycle payload to one carrying a serialized error. */
function hasSerializedError(payload: QueueEventMap[keyof QueueEventMap]): boolean {
  const error = (payload as { error?: { name?: unknown; message?: unknown } }).error;
  return (
    !!error && typeof error.name === 'string' && typeof error.message === 'string'
  );
}

// ── Req 11.1 + 11.2: job.started then job.completed (with durationMs) ──────────

test('a succeeding job emits job.started then job.completed with a numeric durationMs (Req 11.1, 11.2)', async () => {
  const harness = new TestHarness({ now: 1_000 });

  let handlerRan = false;
  harness.register<EmailPayload>(EMAIL_TYPE, () => {
    handlerRan = true;
  });

  await harness.enqueue(new SendEmailJob({ to: 'ada@example.com' }));
  const ran = await harness.runReady();
  assert.equal(ran, 1, 'exactly one job runs');
  assert.equal(handlerRan, true, 'the handler executed');

  // The event stream is exactly [job.started, job.completed], and the completed
  // payload carries a numeric durationMs (Req 11.2).
  harness.assertEvents([
    'job.started',
    { event: 'job.completed', where: hasNumericDuration },
  ]);

  // The started/completed payloads carry the execution context for this job.
  const started = harness.events[0]!;
  const completed = harness.events[1]!;
  assert.equal(started.event, 'job.started');
  assert.equal(started.payload.ctx.type, EMAIL_TYPE);
  assert.equal(started.payload.ctx.queue, 'default');
  assert.equal(started.payload.ctx.attempt, 1);

  assert.equal(completed.event, 'job.completed');
  const durationMs = (completed.payload as QueueEventMap['job.completed']).durationMs;
  assert.equal(typeof durationMs, 'number');
  assert.ok(durationMs >= 0, 'durationMs is non-negative');

  await harness.close();
});

// ── Req 11.3: job.retry on re-enqueue with the documented payload ──────────────

test('a failing job with a remaining attempt emits job.started then job.retry with error, nextRunAt, and nextAttempt (Req 11.3)', async () => {
  // Injected clock so the retry Due_Time is deterministic. Default backoff is
  // exponential 1s base, so the first retry Due_Time is failureTime + 1000ms.
  const START = 10_000;
  const harness = new TestHarness({ now: START });

  // An always-throwing handler makes the single run fail. maxAttempts: 2 leaves
  // one attempt remaining, so the retry engine re-enqueues (rather than DLQ).
  harness.register<EmailPayload>(EMAIL_TYPE, () => {
    throw new Error('smtp unavailable');
  });

  await harness.enqueue(new SendEmailJob({ to: 'grace@example.com' }), { maxAttempts: 2 });
  const ran = await harness.runReady();
  assert.equal(ran, 1, 'exactly one job runs on this pass');

  // The stream is exactly [job.started, job.retry] with the documented payload:
  // a serialized error, a numeric next Due_Time, and the next attempt number.
  harness.assertEvents([
    'job.started',
    {
      event: 'job.retry',
      where: (payload) =>
        hasSerializedError(payload) &&
        typeof (payload as QueueEventMap['job.retry']).nextRunAt === 'number' &&
        (payload as QueueEventMap['job.retry']).nextAttempt === 2,
    },
  ]);

  // Inspect the retry payload directly for the documented fields.
  const retry = harness.events[1]!;
  assert.equal(retry.event, 'job.retry');
  const retryPayload = retry.payload as QueueEventMap['job.retry'];
  assert.equal(retryPayload.error.message, 'smtp unavailable', 'serialized error carries the thrown message');
  // The first attempt was consumed (attempt 1); the next attempt is 2.
  assert.equal(retryPayload.ctx.attempt, 1, 'the started/failed attempt is the 1st');
  assert.equal(retryPayload.nextAttempt, 2, 'the next attempt number is 2');
  // Default exponential backoff (1s base, exponent 0 for the first retry) →
  // Due_Time is failureTime (START) + 1000ms.
  assert.equal(retryPayload.nextRunAt, START + 1_000, 'next Due_Time is failureTime + backoff delay');

  await harness.close();
});

// ── Req 11.4: terminal job.failed on dead-lettering ───────────────────────────

test('a failing job with no remaining attempts emits job.started then a terminal job.failed with a serialized error (Req 11.4)', async () => {
  const harness = new TestHarness({ now: 2_000 });

  harness.register<EmailPayload>(EMAIL_TYPE, () => {
    throw new Error('permanent failure');
  });

  // maxAttempts: 1 → the single failed attempt exhausts the budget and the job
  // is dead-lettered, emitting the terminal job.failed (no job.retry).
  await harness.enqueue(new SendEmailJob({ to: 'linus@example.com' }), { maxAttempts: 1 });
  const ran = await harness.runReady();
  assert.equal(ran, 1, 'exactly one job runs');

  harness.assertEvents([
    'job.started',
    { event: 'job.failed', where: hasSerializedError },
  ]);

  const failed = harness.events[1]!;
  assert.equal(failed.event, 'job.failed');
  const failedPayload = failed.payload as QueueEventMap['job.failed'];
  assert.equal(failedPayload.ctx.type, EMAIL_TYPE);
  assert.equal(failedPayload.ctx.attempt, 1, 'dead-lettered on the single (first) attempt');
  assert.equal(failedPayload.error.message, 'permanent failure', 'serialized error carries the thrown message');
  assert.equal(typeof failedPayload.error.name, 'string', 'serialized error carries a name');

  // The job really landed in the DLQ (terminal transition), and no retry fired.
  const dl = await harness.queue.deadLetters.list('default');
  assert.equal(dl.length, 1, 'the job was dead-lettered exactly once');
  assert.equal(harness.events.filter((e) => e.event === 'job.retry').length, 0, 'no retry was emitted');

  await harness.close();
});

// ── Req 11.5: job.timeout via the REAL worker (real timers) ────────────────────
//
// The TestHarness executor does not model per-attempt timeouts (that is the real
// worker's setTimeout/AbortSignal concern), so `job.timeout` is covered here
// through `createQueue().work()` with a small timeout and a slow, abort-aware
// handler. We subscribe with `queue.on('job.timeout', ...)` and assert the
// documented payload: `{ ctx, timeoutMs }`.

/** A job whose handler runs longer than its per-attempt timeout. */
class SlowJob extends Job<{ n: number }> {
  readonly type = 'slow';
  constructor(n: number) {
    super({ n });
  }
}

/** Await until `predicate` (sync or async) holds or the deadline passes. */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('a per-attempt timeout emits job.timeout with the configured timeoutMs and the execution context (Req 11.5)', async () => {
  const queue = createQueue();

  // The handler awaits longer than the timeout but observes the abort signal so
  // it can cooperatively stop once the per-attempt timeout fires.
  queue.register<{ n: number }>('slow', async (_payload, ctx) => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 200);
      timer.unref?.();
      ctx.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });

  const timeoutEvents: QueueEventMap['job.timeout'][] = [];
  queue.on('job.timeout', (e) => {
    timeoutEvents.push(e);
  });
  let startedEmitted = false;
  queue.on('job.started', () => {
    startedEmitted = true;
  });

  // timeout: 20ms per attempt; maxAttempts: 1 so the timed-out attempt exhausts
  // the budget and the job dead-letters (deterministic terminal state to await).
  await queue.dispatch(new SlowJob(7), { timeout: 20, maxAttempts: 1 });

  const worker = queue.work({ pollIntervalMs: 5 });
  worker.start();

  await waitFor(async () => (await queue.driver.listDeadLetters(undefined, 1000)).length === 1);
  await queue.close();

  // job.started fired when the worker began executing (Req 11.1), and
  // job.timeout fired exactly once with the documented payload (Req 11.5).
  assert.equal(startedEmitted, true, 'job.started was emitted when execution began');
  assert.equal(timeoutEvents.length, 1, 'job.timeout emitted exactly once');
  const timeoutPayload = timeoutEvents[0]!;
  assert.equal(timeoutPayload.timeoutMs, 20, 'job.timeout carries the configured timeoutMs');
  assert.equal(timeoutPayload.ctx.type, 'slow', 'job.timeout carries the execution context');
  assert.equal(timeoutPayload.ctx.attempt, 1, 'the timed-out attempt is the 1st');
});
