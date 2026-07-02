// src/tests/driver-init-failure.test.ts
// Task 15.4 — unit tests for driver init failure and NO silent fallback.
//
// A configured driver whose `init()` rejects must make the facade
// (`createQueue`) and the plugin entry point (`QueuePlugin.onLoad`) surface a
// DESCRIPTIVE error on first use, and must NEVER silently swap in the Memory
// driver (Req 13.3, 13.4).
//
// The facade initializes its driver lazily on first `dispatch()`/`work()` via
// `ensureInitialized()`, which calls `driver.init()` exactly once and, on
// rejection, wraps it in `"Queue driver failed to initialize: <message>"` and
// re-throws it on every await. The configured (failing) driver is never
// replaced — `queue.driver` stays identical to the injected instance.
//
// Validates:
//   - Req 13.3: a driver rejects init when its backend cannot be reached.
//   - Req 13.4: the facade surfaces a descriptive error and does NOT silently
//     fall back to the Memory driver.
//
// No Redis and no wall-clock timing are required: the failing driver is a small
// in-process fake whose `init()` rejects with a distinctive reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createQueue } from '../facade.js';
import { QueuePlugin } from '../plugin.js';
import { Job } from '../job.js';
import { MemoryDriver } from '../drivers/memory.js';
import type { QueueDriver, Reservation, QueueStats } from '../drivers/driver.js';
import type { JobEnvelope, DeadLetterRecord, SerializedError } from '../job.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** The distinctive reason the fake backend rejects init with (Req 13.3). */
const INIT_REJECTION_REASON = 'backend unreachable';

/** A minimal concrete Job used to drive a dispatch through the facade. */
class PingJob extends Job<{ n: number }> {
  readonly type = 'ping';
  constructor(n: number) {
    super({ n });
  }
}

/**
 * A fake {@link QueueDriver} whose `init()` always rejects, simulating a
 * configured backend that cannot be reached (Req 13.3). Every other method
 * throws if ever called — a correct facade must never touch storage/reservation
 * on a driver that failed to initialize, so reaching any of these is itself a
 * bug the test would surface. `health()` is safe/no-op so registering
 * observability against the driver (if it ever happened) would not blow up.
 */
class FailingInitDriver implements QueueDriver {
  /** Number of times `init()` was invoked; asserts single, cached init. */
  initCalls = 0;

  async init(): Promise<void> {
    this.initCalls += 1;
    throw new Error(INIT_REJECTION_REASON);
  }

  async enqueue(_queue: string, _envelope: JobEnvelope): Promise<void> {
    throw new Error('enqueue must not be called on a driver whose init rejected');
  }

  async enqueueDelayed(_queue: string, _envelope: JobEnvelope, _runAt: number): Promise<void> {
    throw new Error('enqueueDelayed must not be called on a driver whose init rejected');
  }

  async reserve(
    _queues: string[],
    _visibilityMs: number,
    _now: number,
  ): Promise<Reservation | null> {
    throw new Error('reserve must not be called on a driver whose init rejected');
  }

  async ack(_reservation: Reservation): Promise<void> {
    throw new Error('ack must not be called on a driver whose init rejected');
  }

  async nack(_reservation: Reservation, _runAt?: number): Promise<void> {
    throw new Error('nack must not be called on a driver whose init rejected');
  }

  async promoteDue(_now: number): Promise<number> {
    throw new Error('promoteDue must not be called on a driver whose init rejected');
  }

  async moveToDeadLetter(_reservation: Reservation, _error: SerializedError): Promise<void> {
    throw new Error('moveToDeadLetter must not be called on a driver whose init rejected');
  }

  async listDeadLetters(_queue: string | undefined, _limit: number): Promise<DeadLetterRecord[]> {
    throw new Error('listDeadLetters must not be called on a driver whose init rejected');
  }

  async removeDeadLetter(_jobId: string): Promise<DeadLetterRecord | null> {
    throw new Error('removeDeadLetter must not be called on a driver whose init rejected');
  }

  async flushDeadLetters(_queue?: string): Promise<number> {
    throw new Error('flushDeadLetters must not be called on a driver whose init rejected');
  }

  async stats(_queue?: string): Promise<QueueStats> {
    return { ready: 0, delayed: 0, deadLettered: 0, reserved: 0 };
  }

  async purge(_queue?: string): Promise<number> {
    return 0;
  }

  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    return { status: 'down', details: { reason: INIT_REJECTION_REASON } };
  }

  async close(): Promise<void> {
    // no-op
  }
}

/**
 * Matcher asserting the surfaced error is DESCRIPTIVE (mentions initialization
 * failure) AND carries the underlying reason (Req 13.3/13.4).
 */
function isDescriptiveInitError(err: unknown): err is Error {
  assert.ok(err instanceof Error, 'expected an Error instance');
  assert.match(
    err.message,
    /failed to initialize/i,
    'error message must describe an initialization failure (Req 13.4)',
  );
  assert.match(
    err.message,
    new RegExp(INIT_REJECTION_REASON),
    'error message must include the underlying reason (Req 13.3)',
  );
  return true;
}

/** A minimal fake SandboxedApp exposing only the surface `onLoad` may touch. */
const fakeApp = { use: () => {}, on: () => {} };

// ── createQueue: dispatch surfaces a descriptive error, no fallback ──────────

test('dispatch on a failing-init driver rejects with a descriptive error (Req 13.4)', async () => {
  const failingDriver = new FailingInitDriver();
  const queue = createQueue({ driver: failingDriver });

  await assert.rejects(() => queue.dispatch(new PingJob(1)), isDescriptiveInitError);

  // No silent fallback: the configured (failing) driver is still in place —
  // asserted by identity, not just type (Req 13.4).
  assert.strictEqual(queue.driver, failingDriver, 'queue.driver must remain the configured driver');
  assert.ok(
    !(queue.driver instanceof MemoryDriver),
    'must NOT silently fall back to the MemoryDriver',
  );
});

test('init is attempted exactly once and its rejection is re-surfaced on every dispatch', async () => {
  const failingDriver = new FailingInitDriver();
  const queue = createQueue({ driver: failingDriver });

  await assert.rejects(() => queue.dispatch(new PingJob(1)), isDescriptiveInitError);
  await assert.rejects(() => queue.dispatch(new PingJob(2)), isDescriptiveInitError);

  // The cached init promise means init() itself runs only once even though the
  // rejection is observed on every dispatch (Req 13.4).
  assert.equal(failingDriver.initCalls, 1, 'init must be attempted exactly once (cached)');
  assert.strictEqual(queue.driver, failingDriver);
});

// ── work(): worker does not silently succeed against Memory ──────────────────

test('work() on a failing-init driver never processes and surfaces the error via dispatch', async () => {
  const failingDriver = new FailingInitDriver();
  const queue = createQueue({ driver: failingDriver });

  const processed: number[] = [];
  queue.register<{ n: number }>('ping', (payload) => {
    processed.push(payload.n);
  });

  // Starting a worker kicks off initialization; the worker swallows the
  // readiness rejection and stops without reserving — it must not silently
  // process anything against a Memory fallback.
  const worker = queue.work({ pollIntervalMs: 5 });
  worker.start();

  // Give the worker a chance to (incorrectly) reserve/process if it were going
  // to fall back to Memory.
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.deepEqual(processed, [], 'worker must not process anything on a failed-init driver');

  // The init rejection remains observable through the dispatch path, and the
  // configured driver is still the failing one (no fallback, Req 13.4).
  await assert.rejects(() => queue.dispatch(new PingJob(1)), isDescriptiveInitError);
  assert.strictEqual(queue.driver, failingDriver);
  assert.ok(!(queue.driver instanceof MemoryDriver));

  await queue.close();
});

// ── QueuePlugin.onLoad: no fallback; error surfaces on first use ─────────────

test('QueuePlugin.onLoad keeps the failing driver and surfaces the error on first use (Req 13.4)', async () => {
  const failingDriver = new FailingInitDriver();
  const plugin = new QueuePlugin({ driver: failingDriver });

  // onLoad constructs the facade (createQueue) but does NOT itself dispatch, so
  // it resolves without triggering init.
  await plugin.onLoad(fakeApp as never);

  const queue = plugin.queue;
  assert.ok(queue, 'plugin.queue must be constructed after onLoad');

  // No silent fallback: the plugin's queue still owns the configured failing
  // driver by identity (Req 13.4).
  assert.strictEqual(queue.driver, failingDriver, 'plugin.queue.driver must be the configured driver');
  assert.ok(!(queue.driver instanceof MemoryDriver), 'plugin must NOT fall back to MemoryDriver');

  // The init rejection surfaces (descriptively) when the plugin's queue is
  // first used.
  await assert.rejects(() => queue.dispatch(new PingJob(1)), isDescriptiveInitError);

  // Tear down: onUnload closes the queue (close() is safe on a failing driver
  // whose close() is a no-op).
  await plugin.onUnload(fakeApp as never);
});
