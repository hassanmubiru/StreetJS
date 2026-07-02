// src/tests/emitter.test.ts
// Unit tests for the subscription registry (emitter.ts): registration-order
// resolution across exact and wildcard subscriptions, unsubscribe, once
// bookkeeping (the `once` flag; delivery-side removal is the facade's job),
// counts, and clear.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Emitter } from '../emitter.js';
import type { EventContext } from '../event.js';

const noop = (): void => {};
const CTX: EventContext = { event: 'x', id: 'id', timestamp: 0, metadata: {} };

test('resolve returns exact and wildcard matches in registration order', () => {
  const em = new Emitter();
  const order: string[] = [];
  em.add('user.created', () => order.push('exact-1'));
  em.add('user.*', () => order.push('wild-1'));
  em.add('user.created', () => order.push('exact-2'));
  em.add('**', () => order.push('wild-all'));

  const subs = em.resolve('user.created');
  for (const s of subs) {
    void s.listener(undefined, CTX);
  }

  // Interleaved strictly by registration order regardless of exact vs wildcard.
  assert.deepEqual(order, ['exact-1', 'wild-1', 'exact-2', 'wild-all']);
});

test('resolve excludes non-matching subscriptions', () => {
  const em = new Emitter();
  em.add('user.created', noop);
  em.add('order.*', noop);
  em.add('payment.**', noop);

  assert.equal(em.resolve('user.created').length, 1);
  assert.equal(em.resolve('order.shipped').length, 1);
  assert.equal(em.resolve('payment.captured.v2').length, 1);
  assert.equal(em.resolve('unrelated.event').length, 0);
});

test('unsubscribe removes an exact subscription and is idempotent', () => {
  const em = new Emitter();
  const off = em.add('user.created', noop);
  assert.equal(em.resolve('user.created').length, 1);
  off();
  assert.equal(em.resolve('user.created').length, 0);
  off(); // idempotent
  assert.equal(em.listenerCount('user.created'), 0);
});

test('unsubscribe removes a wildcard subscription', () => {
  const em = new Emitter();
  const off = em.add('user.*', noop);
  assert.equal(em.patternCount(), 1);
  off();
  assert.equal(em.patternCount(), 0);
  assert.equal(em.resolve('user.created').length, 0);
});

test('listenerCount(name) counts matching exact + wildcard; listenerCount() counts all', () => {
  const em = new Emitter();
  em.add('user.created', noop);
  em.add('user.*', noop);
  em.add('order.shipped', noop);

  assert.equal(em.listenerCount('user.created'), 2); // exact + wildcard
  assert.equal(em.listenerCount('order.shipped'), 1);
  assert.equal(em.listenerCount(), 3); // total registered
  assert.equal(em.patternCount(), 1);
});

test('a snapshot from resolve is stable if a listener unsubscribes mid-delivery', () => {
  const em = new Emitter();
  const seen: string[] = [];
  let offB: (() => void) | undefined;
  em.add('e', () => {
    seen.push('a');
    offB?.(); // cancel B during A's delivery
  });
  offB = em.add('e', () => seen.push('b'));

  const subs = em.resolve('e');
  for (const s of subs) {
    if (s.active) void s.listener(undefined, CTX);
    else seen.push('skipped-inactive');
  }
  // The snapshot still contains B, but its `active` flag flipped to false, so a
  // delivery loop that checks `active` skips it — no crash, deterministic.
  assert.deepEqual(seen, ['a', 'skipped-inactive']);
});

test('clear removes every subscription', () => {
  const em = new Emitter();
  em.add('user.created', noop);
  em.add('user.*', noop);
  em.clear();
  assert.equal(em.listenerCount(), 0);
  assert.equal(em.patternCount(), 0);
  assert.equal(em.resolve('user.created').length, 0);
});
