// src/tests/facade.test.ts
// Unit tests for the typed facade (facade.ts): both publish forms, exact +
// wildcard subscriptions, ordered synchronous delivery, once, unsubscribe,
// per-listener error isolation, ordered fire-and-forget dispatch, and stats.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEvents } from '../facade.js';
import { Event } from '../event.js';

interface User {
  readonly id: string;
  readonly email: string;
}
interface Order {
  readonly id: string;
  readonly total: number;
}

interface AppEvents {
  'user.created': User;
  'user.updated': User;
  'order.shipped': Order;
  'order.cancelled': Order;
}

// ── Publish (string form) + typed listener ─────────────────────────────────────

test('publish(name, payload) delivers the typed payload to an exact listener', async () => {
  const events = createEvents<AppEvents>();
  const seen: User[] = [];
  events.on('user.created', (user) => {
    // `user` is typed as User here.
    seen.push(user);
  });

  await events.publish('user.created', { id: 'u1', email: 'a@b.com' });
  assert.deepEqual(seen, [{ id: 'u1', email: 'a@b.com' }]);
  await events.close();
});

// ── Publish (class form) ───────────────────────────────────────────────────────

test('publish(new Event(...)) routes by the event type and delivers the payload', async () => {
  const events = createEvents<AppEvents>();
  class UserCreated extends Event<User> {
    readonly type = 'user.created';
  }
  const seen: User[] = [];
  events.on('user.created', (user) => {
    seen.push(user);
  });

  const ctx = await events.publish(new UserCreated({ id: 'u2', email: 'c@d.com' }));
  assert.equal(ctx.event, 'user.created');
  assert.deepEqual(seen, [{ id: 'u2', email: 'c@d.com' }]);
  await events.close();
});

// ── Ordered synchronous delivery ───────────────────────────────────────────────

test('publish delivers to listeners in registration order and awaits all of them', async () => {
  const events = createEvents<AppEvents>();
  const order: number[] = [];
  events.on('user.created', async () => {
    await new Promise((r) => setTimeout(r, 5));
    order.push(1);
  });
  events.on('user.created', () => {
    order.push(2);
  });
  events.on('user.created', async () => {
    await new Promise((r) => setTimeout(r, 1));
    order.push(3);
  });

  await events.publish('user.created', { id: 'u', email: 'e@f.com' });
  // Sequential + ordered despite differing delays.
  assert.deepEqual(order, [1, 2, 3]);
  await events.close();
});

// ── Wildcard subscriptions ─────────────────────────────────────────────────────

test('a `user.*` listener receives all single-segment user events with ctx.event set', async () => {
  const events = createEvents<AppEvents>();
  const received: Array<{ event: string; payload: User }> = [];
  events.on('user.*', (payload, ctx) => {
    received.push({ event: ctx.event, payload: payload as User });
  });

  await events.publish('user.created', { id: 'u1', email: 'a@b.com' });
  await events.publish('user.updated', { id: 'u1', email: 'a2@b.com' });
  await events.publish('order.shipped', { id: 'o1', total: 10 }); // must NOT match

  assert.deepEqual(received.map((r) => r.event), ['user.created', 'user.updated']);
  await events.close();
});

test('a `**` listener receives every event', async () => {
  const events = createEvents<AppEvents>();
  const names: string[] = [];
  events.on('**', (_p, ctx) => {
    names.push(ctx.event);
  });

  await events.publish('user.created', { id: 'u', email: 'a@b.com' });
  await events.publish('order.shipped', { id: 'o', total: 5 });
  assert.deepEqual(names, ['user.created', 'order.shipped']);
  await events.close();
});

// ── once ───────────────────────────────────────────────────────────────────────

test('once delivers exactly one time then removes itself', async () => {
  const events = createEvents<AppEvents>();
  let count = 0;
  events.once('user.created', () => {
    count += 1;
  });

  await events.publish('user.created', { id: 'u', email: 'a@b.com' });
  await events.publish('user.created', { id: 'u', email: 'a@b.com' });
  assert.equal(count, 1);
  assert.equal(events.listenerCount('user.created'), 0);
  await events.close();
});

// ── unsubscribe ────────────────────────────────────────────────────────────────

test('the unsubscribe function removes a listener and is idempotent', async () => {
  const events = createEvents<AppEvents>();
  let count = 0;
  const off = events.on('user.created', () => {
    count += 1;
  });

  await events.publish('user.created', { id: 'u', email: 'a@b.com' });
  off();
  off(); // idempotent
  await events.publish('user.created', { id: 'u', email: 'a@b.com' });
  assert.equal(count, 1);
  await events.close();
});

// ── Error isolation ─────────────────────────────────────────────────────────────

test('a throwing listener is isolated: siblings still run and publish resolves', async () => {
  const errors: unknown[] = [];
  const events = createEvents<AppEvents>({ onError: (err) => errors.push(err) });
  const seen: string[] = [];

  events.on('user.created', () => {
    seen.push('before');
  });
  events.on('user.created', () => {
    throw new Error('boom');
  });
  events.on('user.created', () => {
    seen.push('after');
  });

  // publish must resolve (not reject) despite the throwing listener.
  await events.publish('user.created', { id: 'u', email: 'a@b.com' });

  assert.deepEqual(seen, ['before', 'after']);
  assert.equal(errors.length, 1);
  assert.equal((errors[0] as Error).message, 'boom');
  assert.equal(events.stats().failed, 1);
  assert.equal(events.stats().delivered, 2);
  await events.close();
});

// ── Fire-and-forget ordered async dispatch ──────────────────────────────────────

test('publishAsync/emit deliver in publish order and close() drains them', async () => {
  const events = createEvents<AppEvents>();
  const order: number[] = [];
  events.on('order.shipped', async (o) => {
    // Earlier events use a longer delay; ordered dispatch must still preserve order.
    await new Promise((r) => setTimeout(r, o.total));
    order.push(o.total);
  });

  events.publishAsync('order.shipped', { id: 'o1', total: 15 });
  events.emit('order.shipped', { id: 'o2', total: 1 });
  events.publishAsync('order.shipped', { id: 'o3', total: 8 });

  await events.close(); // drains the ordered async tail
  assert.deepEqual(order, [15, 1, 8]); // strict publish order, not completion order
});

// ── stats ────────────────────────────────────────────────────────────────────

test('stats reports published/delivered/failed/listeners/patterns', async () => {
  const events = createEvents<AppEvents>();
  events.on('user.created', () => {});
  events.on('user.*', () => {});

  await events.publish('user.created', { id: 'u', email: 'a@b.com' });

  const s = events.stats();
  assert.equal(s.published, 1);
  assert.equal(s.delivered, 2); // exact + wildcard both matched
  assert.equal(s.failed, 0);
  assert.equal(s.listeners, 2);
  assert.equal(s.patterns, 1);
  await events.close();
});
