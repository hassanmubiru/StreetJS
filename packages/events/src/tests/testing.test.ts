// src/tests/testing.test.ts
// Unit tests for the testing utilities: FakeEvents recording + synchronous
// delivery, createMemoryEvents replay, and TestHarness (injected clock,
// recording, assertions, flush).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createFakeEvents, createMemoryEvents, TestHarness } from '../testing.js';
import { Event } from '../event.js';

interface AppEvents {
  'user.created': { id: string };
  'order.shipped': { id: string };
}

// ── FakeEvents ─────────────────────────────────────────────────────────────────

test('FakeEvents records publish calls (name, payload, options) and delivers to listeners', async () => {
  const fake = createFakeEvents<AppEvents>();
  const seen: string[] = [];
  fake.on('user.created', (u) => {
    seen.push(u.id);
  });

  await fake.publish('user.created', { id: 'u1' }, { tenantId: 't1' });
  fake.emit('order.shipped', { id: 'o1' });
  await fake.flush();

  assert.equal(fake.published.length, 2);
  assert.equal(fake.published[0]!.name, 'user.created');
  assert.deepEqual(fake.published[0]!.payload, { id: 'u1' });
  assert.deepEqual(fake.published[0]!.options, { tenantId: 't1' });
  assert.equal(fake.published[0]!.async, false);
  assert.equal(fake.published[1]!.name, 'order.shipped');
  assert.equal(fake.published[1]!.async, true);

  // Delivery still happens so side effects are observable.
  assert.deepEqual(seen, ['u1']);
  await fake.close();
});

test('FakeEvents records class-based publish and exposes assertion helpers', async () => {
  const fake = createFakeEvents<AppEvents>();
  class UserCreated extends Event<{ id: string }> {
    readonly type = 'user.created';
  }
  await fake.publish(new UserCreated({ id: 'u9' }));

  assert.equal(fake.wasPublished('user.created'), true);
  assert.equal(fake.wasPublished('order.shipped'), false);
  assert.deepEqual(fake.payloadsFor('user.created'), [{ id: 'u9' }]);

  fake.reset();
  assert.equal(fake.published.length, 0);
  await fake.close();
});

// ── MemoryEvents ────────────────────────────────────────────────────────────────

test('createMemoryEvents persists events and supports replay', async () => {
  const events = createMemoryEvents<AppEvents>();
  await events.publish('user.created', { id: 'u1' });
  await events.publish('order.shipped', { id: 'o1' });

  const replayed: string[] = [];
  events.on('**', (_p, ctx) => {
    replayed.push(ctx.event);
  });
  const count = await events.replay();
  assert.equal(count, 2);
  assert.deepEqual(replayed, ['user.created', 'order.shipped']);
  await events.close();
});

// ── TestHarness ──────────────────────────────────────────────────────────────

test('TestHarness uses an injected, advanceable clock for deterministic timestamps', async () => {
  const harness = new TestHarness<AppEvents>({ now: 1000 });
  let ts = -1;
  harness.events.on('user.created', (_p, ctx) => {
    ts = ctx.timestamp;
  });

  harness.advance(500);
  await harness.publish('user.created', { id: 'u1' });
  assert.equal(ts, 1500);
  assert.equal(harness.clockNow, 1500);
  await harness.close();
});

test('TestHarness records publishes and supports assertPublished / assertOrder', async () => {
  const harness = new TestHarness<AppEvents>();
  await harness.publish('user.created', { id: 'u1' });
  harness.emit('order.shipped', { id: 'o1' });
  await harness.flush();

  harness.assertPublished('user.created');
  harness.assertPublished('order.shipped');
  harness.assertOrder(['user.created', 'order.shipped']);

  assert.throws(() => harness.assertPublished('nope'), /was not published/);
  assert.throws(() => harness.assertOrder(['order.shipped']), /expected/);
  await harness.close();
});

test('TestHarness.advance rejects a negative delta', () => {
  const harness = new TestHarness<AppEvents>();
  assert.throws(() => harness.advance(-1), /non-negative/);
});
