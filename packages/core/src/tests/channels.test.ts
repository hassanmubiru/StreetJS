// channels.test.ts
// Unit + property tests for the realtime ChannelHub (presence, rooms, typing,
// scoped broadcasting, and reconnection-safe reference counting).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { ChannelHub, ChannelEvents, type RealtimeConnection } from '../websocket/channels.js';

/** A fake connection that records every event it receives. */
class FakeConn implements RealtimeConnection {
  readonly received: { type: string; payload: unknown }[] = [];
  closed = false;
  private static counter = 0;
  readonly id: string;
  constructor(id?: string) {
    this.id = id ?? `c${FakeConn.counter++}`;
  }
  emit(type: string, payload: unknown): void {
    this.received.push({ type, payload });
  }
  typesReceived(): string[] {
    return this.received.map((e) => e.type);
  }
}

describe('ChannelHub — membership & presence', () => {
  it('tracks presence and notifies existing members on join', () => {
    const hub = new ChannelHub();
    const a = new FakeConn();
    const b = new FakeConn();

    assert.deepEqual(hub.join('room1', 'ada', a), { newlyPresent: true });
    assert.deepEqual(hub.presence('room1'), ['ada']);

    // b joining notifies a (the existing member) but not b itself.
    hub.join('room1', 'bob', b);
    assert.deepEqual(hub.presence('room1'), ['ada', 'bob']);
    assert.deepEqual(a.received.at(-1), { type: ChannelEvents.PresenceJoin, payload: { channel: 'room1', memberId: 'bob' } });
    assert.ok(!b.typesReceived().includes(ChannelEvents.PresenceJoin) || b.received.length === 0);
  });

  it('emits presence:leave only when the last connection of a member leaves', () => {
    const hub = new ChannelHub();
    const watcher = new FakeConn();
    const dev1 = new FakeConn();
    const dev2 = new FakeConn();
    hub.join('room', 'watcher', watcher);

    // ada present on two devices.
    assert.equal(hub.join('room', 'ada', dev1).newlyPresent, true);
    assert.equal(hub.join('room', 'ada', dev2).newlyPresent, false); // already present
    watcher.received.length = 0;

    // First device leaves: still present, no leave event.
    assert.equal(hub.leave('room', 'ada', dev1).nowAbsent, false);
    assert.ok(!watcher.typesReceived().includes(ChannelEvents.PresenceLeave));
    assert.equal(hub.isPresent('room', 'ada'), true);

    // Second device leaves: now absent, leave event fires.
    assert.equal(hub.leave('room', 'ada', dev2).nowAbsent, true);
    assert.deepEqual(watcher.received.at(-1), {
      type: ChannelEvents.PresenceLeave,
      payload: { channel: 'room', memberId: 'ada' },
    });
    assert.equal(hub.isPresent('room', 'ada'), false);
  });

  it('disconnect removes a connection from all channels and fires leaves', () => {
    const hub = new ChannelHub();
    const watcher = new FakeConn();
    const ada = new FakeConn();
    hub.join('r1', 'watcher', watcher);
    hub.join('r2', 'watcher', watcher);
    hub.join('r1', 'ada', ada);
    hub.join('r2', 'ada', ada);
    watcher.received.length = 0;

    hub.disconnect(ada);
    assert.equal(hub.isPresent('r1', 'ada'), false);
    assert.equal(hub.isPresent('r2', 'ada'), false);
    const leaves = watcher.received.filter((e) => e.type === ChannelEvents.PresenceLeave);
    assert.equal(leaves.length, 2);
  });

  it('reconnection keeps presence stable when the new conn joins before the old leaves', () => {
    const hub = new ChannelHub();
    const watcher = new FakeConn();
    const oldConn = new FakeConn();
    const newConn = new FakeConn();
    hub.join('room', 'watcher', watcher);
    hub.join('room', 'ada', oldConn);
    watcher.received.length = 0;

    // Reconnect: new socket joins first…
    hub.join('room', 'ada', newConn);
    // …then the stale socket is reaped.
    hub.disconnect(oldConn);

    // ada never went absent; watcher saw no leave for ada.
    assert.equal(hub.isPresent('room', 'ada'), true);
    assert.ok(!watcher.typesReceived().includes(ChannelEvents.PresenceLeave));
  });
});

describe('ChannelHub — broadcasting', () => {
  it('publish reaches all members, with except filters', () => {
    const hub = new ChannelHub();
    const a = new FakeConn();
    const b = new FakeConn();
    const c = new FakeConn();
    hub.join('room', 'a', a);
    hub.join('room', 'b', b);
    hub.join('room', 'c', c);
    [a, b, c].forEach((x) => (x.received.length = 0));

    hub.publish('room', 'msg', { text: 'hi' }, { exceptMemberId: 'a' });
    assert.deepEqual(a.received, []);
    assert.deepEqual(b.received.at(-1), { type: 'msg', payload: { text: 'hi' } });
    assert.deepEqual(c.received.at(-1), { type: 'msg', payload: { text: 'hi' } });

    a.received.length = 0; b.received.length = 0; c.received.length = 0;
    hub.publish('room', 'msg2', 1, { exceptConnId: b.id });
    assert.equal(b.received.length, 0);
    assert.equal(a.received.length, 1);
  });

  it('does not deliver to closed connections', () => {
    const hub = new ChannelHub();
    const a = new FakeConn();
    const b = new FakeConn();
    hub.join('room', 'a', a);
    hub.join('room', 'b', b);
    a.received.length = 0; b.received.length = 0;
    b.closed = true;
    hub.publish('room', 'x', 1);
    assert.equal(a.received.length, 1);
    assert.equal(b.received.length, 0);
  });

  it('publish to an unknown channel is a no-op', () => {
    const hub = new ChannelHub();
    assert.doesNotThrow(() => hub.publish('nope', 'x', 1));
    assert.deepEqual(hub.presence('nope'), []);
  });
});

describe('ChannelHub — typing indicators', () => {
  it('broadcasts typing state to others and tracks typing members', () => {
    const hub = new ChannelHub();
    const a = new FakeConn();
    const b = new FakeConn();
    hub.join('room', 'a', a);
    hub.join('room', 'b', b);
    a.received.length = 0; b.received.length = 0;

    hub.setTyping('room', 'a', true, a);
    assert.deepEqual(hub.typingMembers('room'), ['a']);
    assert.deepEqual(b.received.at(-1), { type: ChannelEvents.Typing, payload: { channel: 'room', memberId: 'a', typing: true } });
    assert.equal(a.received.length, 0, 'sender excluded via conn');

    hub.setTyping('room', 'a', false, a);
    assert.deepEqual(hub.typingMembers('room'), []);
    assert.deepEqual(b.received.at(-1), { type: ChannelEvents.Typing, payload: { channel: 'room', memberId: 'a', typing: false } });
  });

  it('auto-clears typing after the configured TTL', async () => {
    const hub = new ChannelHub({ typingTtlMs: 20 });
    const a = new FakeConn();
    const b = new FakeConn();
    hub.join('room', 'a', a);
    hub.join('room', 'b', b);
    hub.setTyping('room', 'a', true, a);
    assert.deepEqual(hub.typingMembers('room'), ['a']);
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(hub.typingMembers('room'), [], 'typing auto-cleared after TTL');
  });
});

describe('ChannelHub — validation', () => {
  it('rejects empty channel/member ids', () => {
    const hub = new ChannelHub();
    const a = new FakeConn();
    assert.throws(() => hub.join('', 'ada', a), /channel must be a non-empty string/);
    assert.throws(() => hub.join('room', '', a), /memberId must be a non-empty string/);
  });
});

describe('Property: presence equals the set of members with >=1 live connection', () => {
  it('reference-counted presence matches a model across random join/leave ops', () => {
    const MEMBERS = ['m0', 'm1', 'm2'];
    type Op =
      | { t: 'join'; m: string; c: number }
      | { t: 'leave'; m: string; c: number }
      | { t: 'disconnect'; c: number };

    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({ t: fc.constant('join' as const), m: fc.constantFrom(...MEMBERS), c: fc.integer({ min: 0, max: 4 }) }),
      fc.record({ t: fc.constant('leave' as const), m: fc.constantFrom(...MEMBERS), c: fc.integer({ min: 0, max: 4 }) }),
      fc.record({ t: fc.constant('disconnect' as const), c: fc.integer({ min: 0, max: 4 }) }),
    );

    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const hub = new ChannelHub();
        const conns = new Map<number, FakeConn>();
        const getConn = (i: number) => {
          let c = conns.get(i);
          if (!c) {
            c = new FakeConn(`conn${i}`);
            conns.set(i, c);
          }
          return c;
        };
        // Reference model: member -> set of connection indices in the channel.
        const model = new Map<string, Set<number>>();
        // connection index -> the member it last joined as (single member per conn here).
        const connMember = new Map<number, string>();

        for (const op of ops) {
          if (op.t === 'join') {
            const conn = getConn(op.c);
            // A connection backs at most one member in our model; if it already
            // backs a different member, the hub still tracks per (member,conn),
            // so mirror that by allowing multiple — but here keep it simple and
            // skip if the conn is already used for another member.
            const prev = connMember.get(op.c);
            if (prev !== undefined && prev !== op.m) continue;
            connMember.set(op.c, op.m);
            hub.join('room', op.m, conn);
            let set = model.get(op.m);
            if (!set) { set = new Set(); model.set(op.m, set); }
            set.add(op.c);
          } else if (op.t === 'leave') {
            const conn = getConn(op.c);
            if (connMember.get(op.c) !== op.m) continue;
            hub.leave('room', op.m, conn);
            model.get(op.m)?.delete(op.c);
            connMember.delete(op.c);
          } else {
            const conn = getConn(op.c);
            hub.disconnect(conn);
            const m = connMember.get(op.c);
            if (m !== undefined) model.get(m)?.delete(op.c);
            connMember.delete(op.c);
          }
        }

        const expected = [...model.entries()].filter(([, s]) => s.size > 0).map(([m]) => m).sort();
        assert.deepEqual(hub.presence('room').sort(), expected);
        for (const m of MEMBERS) {
          assert.equal(hub.isPresent('room', m), expected.includes(m), `isPresent(${m})`);
        }
      }),
      { numRuns: 200 },
    );
  });
});
