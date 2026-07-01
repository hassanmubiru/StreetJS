// src/tests/broadcast-resilience.test.ts
// Task 3.5 — unit tests for Room.broadcast send-failure resilience and the
// empty-room no-op, exercised through the facade `Room` API over a real
// `ChannelHub` with no network socket (Req 16.3).
//
//   - Req 7.4: if a connection's send fails during delivery, the room continues
//     delivering the event to the remaining connections. Verified by joining a
//     `FakeConnection` constructed with `throwOnEmit: true` alongside healthy
//     connections and asserting the broadcast still reaches the others (and does
//     not reject).
//   - Req 7.5: publishing to a room name that has no connections completes
//     without delivering any message and without raising an error.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StreetWebSocketServer } from 'streetjs';
import { createRealtime, FakeConnection } from '../index.js';
import type { Member } from '../index.js';

/** Build a facade over a no-op WebSocket server (`noServer: true`, no port bound). */
function makeRealtime() {
  const server = new StreetWebSocketServer();
  return createRealtime({ server });
}

const member = (id: string): Member => ({ id });

test('broadcast continues to remaining connections when one send throws (Req 7.4)', async () => {
  const realtime = makeRealtime();
  try {
    const room = realtime.room('resilient');

    // A connection whose `emit` always throws, flanked by healthy connections so
    // we can prove delivery proceeds both around and past the failing send.
    const before = new FakeConnection({ id: 'before' });
    const bad = new FakeConnection({ id: 'bad', throwOnEmit: true });
    const after = new FakeConnection({ id: 'after' });

    await room.join(member('m-before'), before);
    await room.join(member('m-bad'), bad);
    await room.join(member('m-after'), after);

    // The throwing connection must not abort the broadcast or reject the promise.
    await assert.doesNotReject(
      room.broadcast({ type: 'message', payload: { text: 'hello' } }),
    );

    // Both healthy connections received the message exactly once…
    assert.equal(before.eventsOfType('message').length, 1);
    assert.equal(after.eventsOfType('message').length, 1);
    assert.deepEqual(after.lastEvent()?.payload, { text: 'hello' });

    // …and the failing connection recorded nothing (its send never completed).
    assert.equal(bad.eventsOfType('message').length, 0);
  } finally {
    await realtime.close();
  }
});

test('broadcast to a room with no connections is a no-op that does not throw (Req 7.5)', async () => {
  const realtime = makeRealtime();
  try {
    const empty = realtime.room('nobody-here');

    // No connections have ever joined: the publish must complete without error…
    await assert.doesNotReject(
      empty.broadcast({ type: 'message', payload: 'ignored' }),
    );

    // …and there is nothing present to have received anything.
    assert.deepEqual(await empty.presence(), []);
    assert.equal(await empty.memberCount(), 0);
  } finally {
    await realtime.close();
  }
});

test('broadcast after every connection leaves delivers nothing and does not throw (Req 7.5)', async () => {
  const realtime = makeRealtime();
  try {
    const room = realtime.room('drained');
    const conn = new FakeConnection({ id: 'solo' });

    await room.join(member('solo-member'), conn);
    await room.leave(member('solo-member'), conn);

    // Room is now empty again; a subsequent broadcast is a silent no-op.
    await assert.doesNotReject(
      room.broadcast({ type: 'message', payload: 'ignored' }),
    );
    assert.equal(conn.eventsOfType('message').length, 0);
    assert.equal(await room.memberCount(), 0);
  } finally {
    await realtime.close();
  }
});
