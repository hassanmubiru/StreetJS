// src/tests/worker-timeout-nohandler.test.ts
// Task 6.8 — unit tests for per-attempt timeout handling and no-handler
// dead-lettering in the real worker (via createQueue().work()).
//
//  1. A job that exceeds its `timeout` fires the execution `AbortSignal`, emits
//     `job.timeout` with the configured `timeoutMs`, and is routed through the
//     retry engine as a FAILURE (with maxAttempts:1 it dead-letters after the
//     single attempt). (Req 14.4)
//  2. A reserved job whose `type` has NO registered handler is moved STRAIGHT to
//     the DLQ with a descriptive error, bypassing the retry engine entirely (no
//     `job.retry` is emitted). (Req 2.4)
//
// These use a real `MemoryDriver` and a real worker with real timers, so the
// timeout is small (20ms) and the handler awaits a longer, abort-aware delay.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../facade.js';
import { Job } from '../job.js';

/** A job whose handler runs longer than its per-attempt timeout. */
class SlowJob extends Job<{ n: number }> {
  readonly type = 'slow';
  constructor(n: number) {
    super({ n });
  }
}

/** A job whose `type` is deliberately never registered with a handler. */
class OrphanJob extends Job<{ n: number }> {
  readonly type = 'orphan';
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

test('per-attempt timeout fires the AbortSignal, emits job.timeout, and routes as a failure to the DLQ (Req 14.4)', async () => {
  const queue = createQueue();

  let signalAborted = false;
  // The handler awaits a delay LONGER than the timeout, but observes the abort
  // signal so it can cooperatively stop once the per-attempt timeout fires.
  queue.register<{ n: number }>('slow', async (_payload, ctx) => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 200);
      timer.unref?.();
      ctx.signal.addEventListener('abort', () => {
        signalAborted = true;
        clearTimeout(timer);
        resolve();
      });
    });
  });

  const timeoutEvents: Array<{ timeoutMs: number; type: string }> = [];
  queue.on('job.timeout', (e) => {
    timeoutEvents.push({ timeoutMs: e.timeoutMs, type: e.ctx.type });
  });
  let retryEmitted = false;
  queue.on('job.retry', () => {
    retryEmitted = true;
  });

  // timeout: 20ms per attempt; maxAttempts: 1 so a single timed-out attempt
  // exhausts the budget and the retry engine dead-letters the job.
  await queue.dispatch(new SlowJob(1), { timeout: 20, maxAttempts: 1 });

  const worker = queue.work({ pollIntervalMs: 5 });
  worker.start();

  // Wait until the job has been routed to the DLQ as a failure.
  await waitFor(async () => {
    const dl = await queue.driver.listDeadLetters(undefined, 1000);
    return dl.length === 1;
  });
  await queue.close();

  // The AbortSignal fired on timeout (cooperative cancellation observed).
  assert.equal(signalAborted, true, 'the execution AbortSignal fired on timeout');

  // job.timeout was emitted exactly once with the configured timeoutMs.
  assert.equal(timeoutEvents.length, 1, 'job.timeout emitted once');
  assert.equal(timeoutEvents[0]!.timeoutMs, 20);
  assert.equal(timeoutEvents[0]!.type, 'slow');

  // The timeout was routed through the retry engine as a failure. With
  // maxAttempts:1 the single attempt is exhausted, so the job dead-letters.
  const dl = await queue.driver.listDeadLetters(undefined, 1000);
  assert.equal(dl.length, 1, 'the timed-out job landed in the DLQ');
  assert.equal(dl[0]!.type, 'slow');
  assert.equal(dl[0]!.attempts, 1, 'the single attempt was consumed');
  assert.match(dl[0]!.error.message, /timeout/i, 'the DLQ error describes the timeout');

  const status = worker.status();
  assert.equal(status.failed, 1, 'the timeout counted as a failure');
  assert.equal(status.processed, 0, 'the timed-out job was never processed successfully');
  // With maxAttempts:1 the single timed-out attempt is exhausted, so the retry
  // engine dead-letters rather than re-enqueues — no job.retry is emitted.
  assert.equal(retryEmitted, false, 'no retry once the attempt budget is exhausted');
});

test('a reserved job with no registered handler is moved straight to the DLQ with a descriptive error, bypassing retries (Req 2.4)', async () => {
  const queue = createQueue();

  // Deliberately register NO handler for the 'orphan' type.
  const failedEvents: Array<{ type: string; message: string }> = [];
  queue.on('job.failed', (e) => {
    failedEvents.push({ type: e.ctx.type, message: e.error.message });
  });
  let retryEmitted = false;
  queue.on('job.retry', () => {
    retryEmitted = true;
  });

  // Give the job a generous attempt budget to prove the no-handler path does
  // NOT consult the retry engine: despite maxAttempts:5 it dead-letters at once.
  await queue.dispatch(new OrphanJob(1), { maxAttempts: 5 });

  const worker = queue.work({ pollIntervalMs: 5 });
  worker.start();

  await waitFor(async () => {
    const dl = await queue.driver.listDeadLetters(undefined, 1000);
    return dl.length === 1;
  });
  // Give any (erroneous) retry a chance to be emitted.
  await new Promise((resolve) => setTimeout(resolve, 40));
  await queue.close();

  // The job bypassed the retry engine: no retry was ever scheduled/emitted.
  assert.equal(retryEmitted, false, 'no-handler failure did not consult the retry engine');

  const dl = await queue.driver.listDeadLetters(undefined, 1000);
  assert.equal(dl.length, 1, 'the orphan job landed straight in the DLQ');
  assert.equal(dl[0]!.type, 'orphan');
  assert.equal(dl[0]!.attempts, 1, 'dead-lettered on the first (and only) attempt');
  assert.match(dl[0]!.error.message, /no handler/i, 'the DLQ error describes the missing handler');

  // The terminal job.failed event carried the same descriptive error.
  assert.equal(failedEvents.length, 1, 'job.failed emitted once');
  assert.equal(failedEvents[0]!.type, 'orphan');
  assert.match(failedEvents[0]!.message, /no handler/i);

  const status = worker.status();
  assert.equal(status.failed, 1);
  assert.equal(status.processed, 0);
});
