// src/tests/testing-utilities.test.ts
// Unit tests for the Redis-free testing utilities (Task 2.3).
//
// Validates:
//   - Req 16.1: `FakeQueue` records every dispatch and schedule call and every
//     emitted lifecycle event, and drives execution synchronously via
//     runNext()/runAll() with no background loop.
//   - Req 16.3: `TestHarness` builds a Queue with an injected Clock and helpers
//     to enqueue jobs and advance the clock while running delayed promotion,
//     so a delayed job becomes reservable only once the clock reaches its due
//     time.
//   - Req 16.4: the utilities require no real Redis connection and no
//     wall-clock timing (all timing is driven by the harness's injected,
//     advanceable clock).
//
// Everything here is deterministic: FakeQueue uses a fixed `() => 0` clock and
// TestHarness uses its own mutable clock seeded at a known value. No socket is
// opened and no real time elapses.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FakeQueue, TestHarness } from '../testing.js';
import { Job } from '../job.js';
import { MemoryDriver } from '../drivers/memory.js';
import type { JobExecutionContext } from '../job.js';

// ── Test fixtures ────────────────────────────────────────────────────────────

interface GreetPayload {
  name: string;
}

/** A minimal concrete Job subclass used across the tests. */
class GreetJob extends Job<GreetPayload> {
  readonly type = 'greet';
}

// ── FakeQueue: records dispatch calls (Req 16.1) ─────────────────────────────

test('FakeQueue records a dispatch with job, options, resolved queue, and returned id', async () => {
  const fake = new FakeQueue();
  const job = new GreetJob({ name: 'ada' });
  const options = { queue: 'greetings', priority: 3 };

  const id = await fake.dispatch(job, options);

  assert.equal(fake.dispatched.length, 1);
  const record = fake.dispatched[0]!;
  assert.equal(record.id, id, 'record.id should equal the id returned by dispatch');
  assert.equal(record.job, job, 'record.job should be the exact job instance dispatched');
  assert.equal(record.options, options, 'record.options should be the options passed to dispatch');
  assert.equal(record.queue, 'greetings', 'record.queue should be the resolved named queue');
});

test('FakeQueue resolves the default queue when dispatch omits a queue', async () => {
  const fake = new FakeQueue();
  await fake.dispatch(new GreetJob({ name: 'ada' }));
  assert.equal(fake.dispatched[0]!.queue, 'default');
});

test('FakeQueue records multiple dispatches in call order', async () => {
  const fake = new FakeQueue();
  await fake.dispatch(new GreetJob({ name: 'first' }));
  await fake.dispatch(new GreetJob({ name: 'second' }));
  assert.equal(fake.dispatched.length, 2);
  assert.deepEqual(
    fake.dispatched.map((r) => (r.job.payload as GreetPayload).name),
    ['first', 'second'],
  );
});

// ── FakeQueue: records schedule calls (Req 16.1) ─────────────────────────────

test('FakeQueue records a schedule call without firing it on a timer', () => {
  const fake = new FakeQueue();
  const job = new GreetJob({ name: 'ada' });
  const options = { queue: 'cron-queue' };

  fake.schedule('*/5 * * * *', job, options);

  assert.equal(fake.scheduled.length, 1);
  const record = fake.scheduled[0]!;
  assert.equal(record.cron, '*/5 * * * *');
  assert.equal(record.job, job);
  assert.equal(record.options, options);
  // scheduling must not have run the handler or dispatched anything.
  assert.equal(fake.dispatched.length, 0);
  assert.equal(fake.events.length, 0);
});

// ── FakeQueue: drives execution synchronously (Req 16.1, 16.4) ───────────────

test('FakeQueue.runNext drives a single dispatched job through its handler synchronously', async () => {
  const fake = new FakeQueue();
  const seen: string[] = [];
  fake.register<GreetPayload>('greet', (payload) => {
    seen.push(payload.name);
  });

  await fake.dispatch(new GreetJob({ name: 'ada' }));
  assert.equal(fake.pendingCount, 1);

  const ran = await fake.runNext();
  assert.equal(ran, true, 'runNext should report a job was run');
  assert.deepEqual(seen, ['ada']);
  assert.equal(fake.pendingCount, 0);

  // Nothing left to run.
  assert.equal(await fake.runNext(), false);
});

test('FakeQueue.runAll drives every pending job and returns the count', async () => {
  const fake = new FakeQueue();
  const seen: string[] = [];
  fake.register<GreetPayload>('greet', (payload) => {
    seen.push(payload.name);
  });

  await fake.dispatch(new GreetJob({ name: 'a' }));
  await fake.dispatch(new GreetJob({ name: 'b' }));
  await fake.dispatch(new GreetJob({ name: 'c' }));

  const count = await fake.runAll();
  assert.equal(count, 3);
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(fake.pendingCount, 0);
});

test('FakeQueue resolves handlers registered by job subclass via registerClass', async () => {
  const fake = new FakeQueue();
  const seen: string[] = [];
  fake.registerClass(GreetJob, (payload) => {
    seen.push((payload as GreetPayload).name);
  });

  await fake.dispatch(new GreetJob({ name: 'grace' }));
  await fake.runAll();
  assert.deepEqual(seen, ['grace']);
});

// ── FakeQueue: records lifecycle events (Req 16.1) ───────────────────────────

test('FakeQueue records job.started then job.completed for a successful handler', async () => {
  const fake = new FakeQueue();
  fake.register<GreetPayload>('greet', () => {
    /* success */
  });

  await fake.dispatch(new GreetJob({ name: 'ada' }));
  await fake.runNext();

  assert.deepEqual(
    fake.events.map((e) => e.event),
    ['job.started', 'job.completed'],
  );
});

test('FakeQueue emits recorded events to on() subscribers in order', async () => {
  const fake = new FakeQueue();
  fake.register<GreetPayload>('greet', () => {});
  const observed: string[] = [];
  fake.on('job.started', () => observed.push('started'));
  fake.on('job.completed', () => observed.push('completed'));

  await fake.dispatch(new GreetJob({ name: 'ada' }));
  await fake.runNext();

  assert.deepEqual(observed, ['started', 'completed']);
});

// ── FakeQueue: throwing handler → job.failed + dead-letter (Req 16.1) ────────

test('FakeQueue records job.failed and dead-letters a throwing handler', async () => {
  const fake = new FakeQueue();
  fake.register<GreetPayload>('greet', () => {
    throw new Error('boom');
  });

  const id = await fake.dispatch(new GreetJob({ name: 'ada' }));
  await fake.runNext();

  // job.started recorded, then job.failed (no job.completed).
  assert.deepEqual(
    fake.events.map((e) => e.event),
    ['job.started', 'job.failed'],
  );

  const dead = await fake.deadLetters.list();
  assert.equal(dead.length, 1);
  assert.equal(dead[0]!.id, id);
  assert.equal(dead[0]!.type, 'greet');
  assert.equal(dead[0]!.error.message, 'boom');
});

test('FakeQueue dead-letters a job dispatched with no registered handler', async () => {
  const fake = new FakeQueue();
  await fake.dispatch(new GreetJob({ name: 'ada' }));
  await fake.runNext();

  const dead = await fake.deadLetters.list();
  assert.equal(dead.length, 1);
  assert.match(dead[0]!.error.message, /No handler registered/);
});

// ── TestHarness: delayed promotion via advance (Req 16.3, 16.4) ──────────────

test('TestHarness uses a MemoryDriver and needs no Redis', () => {
  const harness = new TestHarness();
  assert.ok(harness.driver instanceof MemoryDriver, 'default driver should be an in-memory driver');
});

test('TestHarness seeds and exposes its mutable clock deterministically', async () => {
  const harness = new TestHarness({ now: 500 });
  assert.equal(harness.clockNow, 500);
  assert.equal(harness.clock(), 500);

  await harness.advance(250);
  assert.equal(harness.clockNow, 750);
  assert.equal(harness.clock(), 750);
});

test('TestHarness.advance rejects a negative delta', async () => {
  const harness = new TestHarness();
  await assert.rejects(() => harness.advance(-1), /non-negative/);
});

test('TestHarness: a delayed job is not reservable before advancing past its due time', async () => {
  const harness = new TestHarness({ now: 0 });
  await harness.enqueue(new GreetJob({ name: 'ada' }), { delay: 1000 });

  // Not yet due: nothing should be reservable.
  assert.deepEqual(await harness.reserveAll(), []);

  // Advance partway — still before the due time.
  await harness.advance(500);
  assert.deepEqual(await harness.reserveAll(), []);
});

test('TestHarness.advance promotes a delayed job once the clock reaches its due time', async () => {
  const harness = new TestHarness({ now: 0 });
  const id = await harness.enqueue(new GreetJob({ name: 'ada' }), { delay: 1000 });

  assert.deepEqual(await harness.reserveAll(), []);

  // Advance to exactly the due time; promotion should make it reservable.
  await harness.advance(1000);
  const reservations = await harness.reserveAll();
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0]!.envelope.id, id);
  assert.equal(reservations[0]!.queue, 'default');
});

test('TestHarness promotes a job scheduled with an absolute runAt', async () => {
  const harness = new TestHarness({ now: 0 });
  const id = await harness.enqueue(new GreetJob({ name: 'ada' }), { runAt: new Date(2000) });

  assert.deepEqual(await harness.reserveAll(), []);

  await harness.advance(1999);
  assert.deepEqual(await harness.reserveAll(), []);

  await harness.advance(1);
  const reservations = await harness.reserveAll();
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0]!.envelope.id, id);
});

test('TestHarness: an immediate (non-delayed) job is reservable without advancing', async () => {
  const harness = new TestHarness({ now: 0 });
  const id = await harness.enqueue(new GreetJob({ name: 'ada' }));
  const reservations = await harness.reserveAll();
  assert.equal(reservations.length, 1);
  assert.equal(reservations[0]!.envelope.id, id);
});

test('TestHarness runs a reserved job through its handler and records lifecycle events', async () => {
  const harness = new TestHarness({ now: 0 });
  const seen: Array<{ name: string; attempt: number }> = [];
  harness.register<GreetPayload>('greet', (payload, ctx: JobExecutionContext) => {
    seen.push({ name: payload.name, attempt: ctx.attempt });
  });

  await harness.enqueue(new GreetJob({ name: 'ada' }));
  const ran = await harness.runReady();

  assert.equal(ran, 1);
  assert.deepEqual(seen, [{ name: 'ada', attempt: 1 }]);
  harness.assertEvents(['job.started', 'job.completed']);
});
