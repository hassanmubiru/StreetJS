import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChannelHub, ChannelEvents, type RealtimeConnection } from '../channels.js';

interface FakeConn extends RealtimeConnection {
  events: Array<{ type: string; payload: unknown }>;
  closeCbs: Array<() => void>;
  onClose(cb: () => void): void;
  fireClose(): void;
  closed: boolean;
}

function conn(id: string): FakeConn {
  return {
    id,
    closed: false,
    events: [],
    closeCbs: [],
    emit(type, payload) {
      this.events.push({ type, payload });
    },
    onClose(cb) {
      this.closeCbs.push(cb);
    },
    fireClose() {
      for (const cb of this.closeCbs) cb();
    },
  };
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('join makes a member present and broadcasts presence:join to others', () => {
  const hub = new ChannelHub();
  const a = conn('a');
  const b = conn('b');
  assert.equal(hub.join('room', 'alice', a).newlyPresent, true);
  assert.equal(hub.join('room', 'bob', b).newlyPresent, true);
  // bob's join is broadcast to alice
  assert.deepEqual(a.events.at(-1), { type: ChannelEvents.PresenceJoin, payload: { channel: 'room', memberId: 'bob' } });
  assert.deepEqual(hub.presence('room'), ['alice', 'bob']);
  assert.equal(hub.memberCount('room'), 2);
  assert.equal(hub.connectionCount('room'), 2);
});

test('a second connection for the same member does not re-announce presence', () => {
  const hub = new ChannelHub();
  const a1 = conn('a1');
  const a2 = conn('a2');
  hub.join('room', 'alice', a1);
  const r = hub.join('room', 'alice', a2);
  assert.equal(r.newlyPresent, false);
  assert.equal(hub.isPresent('room', 'alice'), true);
  assert.equal(hub.connectionCount('room'), 2);
  assert.equal(hub.memberCount('room'), 1);
});

test('leave marks a member absent only when their last connection leaves', () => {
  const hub = new ChannelHub();
  const a1 = conn('a1');
  const a2 = conn('a2');
  const observer = conn('o');
  hub.join('room', 'obs', observer);
  hub.join('room', 'alice', a1);
  hub.join('room', 'alice', a2);
  assert.equal(hub.leave('room', 'alice', a1).nowAbsent, false);
  assert.equal(hub.leave('room', 'alice', a2).nowAbsent, true);
  assert.equal(hub.isPresent('room', 'alice'), false);
  assert.ok(observer.events.some((e) => e.type === ChannelEvents.PresenceLeave));
});

test('leave on an unknown channel is a no-op', () => {
  const hub = new ChannelHub();
  assert.equal(hub.leave('nope', 'x', conn('c')).nowAbsent, false);
});

test('disconnect removes a connection from every channel and fires leave', () => {
  const hub = new ChannelHub();
  const a = conn('a');
  const other = conn('o');
  hub.join('r1', 'alice', a);
  hub.join('r2', 'alice', a);
  hub.join('r1', 'obs', other);
  hub.disconnect(a);
  assert.equal(hub.isPresent('r1', 'alice'), false);
  assert.equal(hub.isPresent('r2', 'alice'), false);
  assert.ok(other.events.some((e) => e.type === ChannelEvents.PresenceLeave));
});

test('disconnect for an unknown connection is a no-op', () => {
  const hub = new ChannelHub();
  assert.doesNotThrow(() => hub.disconnect(conn('ghost')));
});

test('bind wires disconnect to the connection close lifecycle', () => {
  const hub = new ChannelHub();
  const a = conn('a');
  hub.bind(a);
  hub.join('room', 'alice', a);
  a.fireClose();
  assert.equal(hub.isPresent('room', 'alice'), false);
});

test('publish delivers to members, honoring exceptConnId and exceptMemberId', () => {
  const hub = new ChannelHub();
  const a = conn('a');
  const b = conn('b');
  const c = conn('c');
  hub.join('room', 'alice', a);
  hub.join('room', 'bob', b);
  hub.join('room', 'carol', c);
  a.events.length = b.events.length = c.events.length = 0;

  hub.publish('room', 'msg', { text: 'hi' }, { exceptConnId: 'a' });
  assert.equal(a.events.length, 0);
  assert.equal(b.events.length, 1);

  b.events.length = c.events.length = 0;
  hub.publish('room', 'msg', { text: 'again' }, { exceptMemberId: 'bob' });
  assert.equal(b.events.length, 0);
  assert.equal(c.events.length, 1);
});

test('publish to an unknown channel is a no-op', () => {
  const hub = new ChannelHub();
  assert.doesNotThrow(() => hub.publish('nope', 't', {}));
});

test('broadcast skips closed connections and isolates throwing ones', () => {
  const hub = new ChannelHub();
  const good = conn('good');
  const closed = conn('closed');
  const thrower = conn('thrower');
  hub.join('room', 'g', good);
  hub.join('room', 'c', closed);
  hub.join('room', 't', thrower);
  closed.closed = true;
  thrower.emit = () => {
    throw new Error('send failed');
  };
  good.events.length = 0;
  assert.doesNotThrow(() => hub.publish('room', 'x', 1));
  assert.equal(good.events.length, 1);
});

test('setTyping broadcasts typing state and tracks typing members', () => {
  const hub = new ChannelHub();
  const a = conn('a');
  const b = conn('b');
  hub.join('room', 'alice', a);
  hub.join('room', 'bob', b);
  b.events.length = 0;
  hub.setTyping('room', 'alice', true, a);
  assert.deepEqual(b.events.at(-1), {
    type: ChannelEvents.Typing,
    payload: { channel: 'room', memberId: 'alice', typing: true },
  });
  assert.deepEqual(hub.typingMembers('room'), ['alice']);
  hub.setTyping('room', 'alice', false, a);
  assert.deepEqual(hub.typingMembers('room'), []);
});

test('typing auto-clears after the configured TTL', async () => {
  const hub = new ChannelHub({ typingTtlMs: 20 });
  const a = conn('a');
  hub.join('room', 'alice', a);
  hub.setTyping('room', 'alice', true);
  assert.deepEqual(hub.typingMembers('room'), ['alice']);
  await delay(40);
  assert.deepEqual(hub.typingMembers('room'), []);
});

test('channelNames lists active channels and empty ones are dropped', () => {
  const hub = new ChannelHub();
  const a = conn('a');
  hub.join('room', 'alice', a);
  assert.deepEqual(hub.channelNames(), ['room']);
  hub.leave('room', 'alice', a);
  assert.deepEqual(hub.channelNames(), []);
});

test('presence and counts are empty for unknown channels', () => {
  const hub = new ChannelHub();
  assert.deepEqual(hub.presence('nope'), []);
  assert.equal(hub.isPresent('nope', 'x'), false);
  assert.equal(hub.connectionCount('nope'), 0);
});

test('join/setTyping reject empty names', () => {
  const hub = new ChannelHub();
  assert.throws(() => hub.join('', 'alice', conn('a')), /channel must be a non-empty string/);
  assert.throws(() => hub.join('room', '', conn('a')), /memberId must be a non-empty string/);
  assert.throws(() => hub.setTyping('', 'alice', true), /channel must be a non-empty string/);
});
