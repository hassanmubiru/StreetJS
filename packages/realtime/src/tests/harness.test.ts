// src/tests/harness.test.ts
// Self-test for the fake-connection harness (Task 2.2). Exercises
// `createHarness()`, `ManualClock`, and `simulateClose(conn)` to validate:
//   - Req 16.3: the harness drives a `ChannelHub` with no network socket.
//   - Req 16.4: `simulateClose(conn)` removes the connection from every room
//     via the same close path a live `StreetSocket` uses.
//   - Supporting behavior: injected clock stamps event timestamps and drives
//     typing-TTL expiry deterministically (Req 6.3), and rate-limit windows are
//     deterministic when the clock's `now` backs a `RateLimitStore` (Req 11).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHarness, ManualClock, simulateClose, FakeConnection } from '../index.js';
import { ChannelEvents, InMemoryRateLimitStore } from 'streetjs';

test('createHarness drives a ChannelHub in memory with no socket (Req 16.3)', () => {
  const h = createHarness();
  try {
    const a = h.connect({ id: 'a' });
    const b = h.connect({ id: 'b' });

    h.join('room', 'alice', a);
    h.join('room', 'bob', b);

    assert.deepEqual(h.presence('room').sort(), ['alice', 'bob']);
    assert.equal(h.memberCount('room'), 2);

    // Broadcast delivers to members; exclusion is honored.
    h.broadcast('room', 'message', { text: 'hi' }, { exceptConnId: a.id });
    assert.equal(a.eventsOfType('message').length, 0);
    assert.equal(b.eventsOfType('message').length, 1);
    assert.deepEqual(b.lastEvent()?.payload, { text: 'hi' });
  } finally {
    h.close();
  }
});

test('presence:join is delivered to other connections, not the joiner', () => {
  const h = createHarness();
  try {
    const a = h.connect({ id: 'a' });
    h.join('room', 'alice', a);
    const b = h.connect({ id: 'b' });
    h.join('room', 'bob', b);

    // `a` sees bob's join; `b` (the joiner) does not see its own join event.
    assert.equal(a.eventsOfType(ChannelEvents.PresenceJoin).length, 1);
    assert.equal(b.eventsOfType(ChannelEvents.PresenceJoin).length, 0);
  } finally {
    h.close();
  }
});

test('simulateClose removes a connection from every room (Req 16.4)', () => {
  const h = createHarness();
  try {
    const a = h.connect({ id: 'a' });
    const b = h.connect({ id: 'b' });
    h.join('room1', 'alice', a);
    h.join('room2', 'alice', a);
    h.join('room1', 'bob', b);

    assert.equal(h.memberCount('room1'), 2);
    assert.equal(h.memberCount('room2'), 1);

    simulateClose(a);

    // alice removed from both rooms; bob observes a presence:leave in room1.
    assert.deepEqual(h.presence('room1'), ['bob']);
    assert.equal(h.memberCount('room2'), 0);
    assert.equal(b.eventsOfType(ChannelEvents.PresenceLeave).length, 1);
    assert.equal(a.closed, true);
  } finally {
    h.close();
  }
});

test('ManualClock stamps event timestamps and advances deterministically', () => {
  const h = createHarness({ clockStartMs: 1000 });
  try {
    const a = h.connect({ id: 'a' });
    const b = h.connect({ id: 'b' });
    h.join('room', 'alice', a);
    h.join('room', 'bob', b);

    h.broadcast('room', 'm1', 1);
    h.advance(50);
    h.broadcast('room', 'm2', 2);

    const events = b.eventsOfType('m1').concat(b.eventsOfType('m2'));
    assert.equal(events[0]?.ts, 1000);
    assert.equal(events[1]?.ts, 1050);
  } finally {
    h.close();
  }
});

test('fakeTimers routes typing TTL through the harness clock (Req 6.3)', () => {
  const h = createHarness({ typingTtlMs: 5000, fakeTimers: true });
  try {
    const a = h.connect({ id: 'a' });
    const b = h.connect({ id: 'b' });
    h.join('room', 'alice', a);
    h.join('room', 'bob', b);

    h.setTyping('room', 'alice', true, a);
    const typingTrue = b.eventsOfType(ChannelEvents.Typing);
    assert.equal(typingTrue.length, 1);
    assert.deepEqual(typingTrue[0]?.payload, { channel: 'room', memberId: 'alice', typing: true });

    // Advance past the TTL: an auto-clear `typing:false` fires deterministically.
    h.advance(5000);
    const typingEvents = b.eventsOfType(ChannelEvents.Typing);
    assert.equal(typingEvents.length, 2);
    assert.equal((typingEvents[1]?.payload as { typing: boolean }).typing, false);
  } finally {
    h.close();
  }
});

test('ManualClock.now backs a deterministic rate-limit window (Req 11)', async () => {
  const clock = new ManualClock(0);
  const store = new InMemoryRateLimitStore({ clock: clock.now });
  const windowMs = 1000;

  assert.equal(await store.hit('conn', clock.now(), windowMs), 1);
  assert.equal(await store.hit('conn', clock.now(), windowMs), 2);
  clock.advance(1001); // slide the whole window past the earlier hits
  assert.equal(await store.hit('conn', clock.now(), windowMs), 1);
});

test('throwOnEmit connection does not halt delivery to others (Req 7.4)', () => {
  const h = createHarness();
  try {
    const bad = h.connect({ id: 'bad', throwOnEmit: true });
    const good = h.connect({ id: 'good' });
    h.join('room', 'm1', bad);
    h.join('room', 'm2', good);

    h.broadcast('room', 'message', 'payload');
    assert.equal(good.eventsOfType('message').length, 1);
  } finally {
    h.close();
  }
});

test('simulateClose works on a bare FakeConnection close path', () => {
  const conn = new FakeConnection({ id: 'x' });
  let closedFired = 0;
  conn.onClose(() => (closedFired += 1));
  simulateClose(conn);
  assert.equal(conn.closed, true);
  assert.equal(closedFired, 1);
  simulateClose(conn); // idempotent
  assert.equal(closedFired, 1);
});
