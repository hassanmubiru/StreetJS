// src/tests/dispatch-defaults.test.ts
// Unit tests for dispatch defaults and attempt-ceiling precedence (Task 5.5).
//
// Unlike job-envelope.test.ts (which exercises the pure `buildEnvelope`
// function), these tests drive the real `createQueue` facade over a real
// `MemoryDriver` and inspect what was actually enqueued by reserving it back
// out of the driver. This exercises the full dispatch path (option merge,
// default resolution, attempt-ceiling resolution, enqueue) end-to-end.
//
// Validates:
//   - Req 2.5: a dispatch with no target queue lands on the "default" queue.
//   - Req 8.3: a dispatch with no priority gets priority 0.
//   - Req 5.6/5.8: `retries` takes precedence over `maxAttempts` when both are
//     provided (attempt ceiling = retries + 1, ignoring maxAttempts).
//
// The queue is built with an injected fixed clock and a MemoryDriver we hold a
// reference to; no Redis and no wall-clock timing are required.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createQueue } from '../facade.js';
import { Job } from '../job.js';
import { MemoryDriver } from '../drivers/memory.js';
import type { Reservation } from '../drivers/driver.js';
import type { Clock } from 'streetjs';

// ── Test fixtures ────────────────────────────────────────────────────────────

interface GreetPayload {
  name: string;
}

/** A minimal concrete Job subclass used to exercise dispatch. */
class GreetJob extends Job<GreetPayload> {
  readonly type = 'greet';
}

/** A fixed, deterministic clock so timing is reproducible. */
const FIXED_NOW = 1000;
const fixedClock: Clock = () => FIXED_NOW;

/** A large visibility lease so the reservation never expires mid-test. */
const VISIBILITY_MS = 60_000;

/**
 * Build a queue over a MemoryDriver we control, dispatch the job, then reserve
 * the enqueued envelope back out so the test can assert what was stored.
 */
async function dispatchAndReserve(
  job: GreetJob,
  options?: ConstructorParameters<typeof GreetJob>[1],
  queues: string[] = ['default'],
): Promise<Reservation> {
  const driver = new MemoryDriver();
  const queue = createQueue({ driver, clock: fixedClock });
  await queue.dispatch(job, options);
  const reservation = await driver.reserve(queues, VISIBILITY_MS, FIXED_NOW);
  assert.ok(reservation, 'expected the dispatched job to be reservable');
  return reservation;
}

// ── Default target queue (Req 2.5) ───────────────────────────────────────────

test('dispatch with no target queue lands on the "default" queue', async () => {
  const reservation = await dispatchAndReserve(new GreetJob({ name: 'ada' }));
  assert.equal(reservation.queue, 'default');
  assert.equal(reservation.envelope.queue, 'default');
});

test('dispatch with no target queue is not reservable from a non-default queue', async () => {
  const driver = new MemoryDriver();
  const queue = createQueue({ driver, clock: fixedClock });
  await queue.dispatch(new GreetJob({ name: 'ada' }));
  const reservation = await driver.reserve(['other'], VISIBILITY_MS, FIXED_NOW);
  assert.equal(reservation, null);
});

// ── Default priority (Req 8.3) ────────────────────────────────────────────────

test('dispatch with no priority gets priority 0', async () => {
  const reservation = await dispatchAndReserve(new GreetJob({ name: 'ada' }));
  assert.equal(reservation.envelope.priority, 0);
});

test('dispatch with an explicit priority preserves that priority', async () => {
  const reservation = await dispatchAndReserve(new GreetJob({ name: 'ada' }), { priority: 7 });
  assert.equal(reservation.envelope.priority, 7);
});

// ── Attempt-ceiling precedence (Req 5.6, 5.8) ─────────────────────────────────

test('retries takes precedence over maxAttempts when both are provided', async () => {
  // retries (2) + 1 = 3, ignoring the provided maxAttempts of 10. Assert the
  // ceiling (maxAttempts on the envelope), not `attempts` — reserve increments
  // `attempts` to 1 as it consumes the first attempt.
  const reservation = await dispatchAndReserve(new GreetJob({ name: 'ada' }), {
    retries: 2,
    maxAttempts: 10,
  });
  assert.equal(reservation.envelope.maxAttempts, 3);
  // Sanity: reserve consumes exactly one attempt.
  assert.equal(reservation.envelope.attempts, 1);
});

test('only retries resolves the attempt ceiling to retries + 1', async () => {
  const reservation = await dispatchAndReserve(new GreetJob({ name: 'ada' }), { retries: 4 });
  assert.equal(reservation.envelope.maxAttempts, 5);
});

test('only maxAttempts resolves the attempt ceiling to maxAttempts', async () => {
  const reservation = await dispatchAndReserve(new GreetJob({ name: 'ada' }), { maxAttempts: 6 });
  assert.equal(reservation.envelope.maxAttempts, 6);
});

test('neither retries nor maxAttempts defaults the attempt ceiling to 1 (no retry)', async () => {
  const reservation = await dispatchAndReserve(new GreetJob({ name: 'ada' }));
  assert.equal(reservation.envelope.maxAttempts, 1);
});
