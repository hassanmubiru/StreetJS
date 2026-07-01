// src/tests/property-4-5-typing.test.ts
//
// Feature: realtime-framework, Property 4: Typing state changes emit the correct
// typing events — For any member in any room, setting typing state to `true`
// delivers a `typing` event with `typing: true` (carrying channel name and member
// id) to the other connections in the room, and setting it to `false` delivers a
// `typing` event with `typing: false` to the other connections.
//
// Validates: Requirements 6.1, 6.2
//
// Feature: realtime-framework, Property 5: Typing state is cleared when the last
// connection leaves — For any member flagged as typing in a room while holding any
// number of connections, when that member's last connection leaves the room the
// member's typing state is cleared, such that no stale `typing: true` state remains
// and remaining connections observe the member as not typing.
//
// Validates: Requirements 6.4
//
// Both properties are exercised through the fake-connection harness (Req 16) so no
// network socket is opened. Each FakeConnection records every emitted WsEvent, so
// assertions inspect exactly which `typing` events each connection received.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { ChannelEvents } from 'streetjs';
import type { TypingPayload } from 'streetjs';

import { createHarness, type FakeConnection } from '../index.js';

const memberId = (index: number): string => `m${index}`;

// ── Property 4 ────────────────────────────────────────────────────────────────

/**
 * A generated scenario for Property 4: a room, a fixed pool of connections each
 * owned by one of a few members, the index of the connection that sets typing
 * (the "setter"), and the typing value being set.
 */
interface TypingScenario {
  room: string;
  /** connMember[i] is the member index owning connection i. */
  connMember: number[];
  /** Index of the connection that calls setTyping. */
  setterConn: number;
  /** The typing value the setter applies. */
  value: boolean;
}

const typingScenarioArb: fc.Arbitrary<TypingScenario> = fc
  .record({
    room: fc.string({ minLength: 1, maxLength: 12 }),
    numMembers: fc.integer({ min: 1, max: 4 }),
    connMember: fc.array(fc.nat({ max: 3 }), { minLength: 2, maxLength: 8 }),
    setterConn: fc.nat(),
    value: fc.boolean(),
  })
  .map(({ room, numMembers, connMember, setterConn, value }) => {
    const owners = connMember.map((m) => m % numMembers);
    return {
      room,
      connMember: owners,
      setterConn: setterConn % owners.length,
      value,
    };
  });

test('Property 4: typing state changes emit the correct typing events to other connections', () => {
  fc.assert(
    fc.property(typingScenarioArb, (scenario) => {
      const { room, connMember, setterConn, value } = scenario;
      const harness = createHarness();
      try {
        // Fixed pool of connections; connections[i] belongs to member connMember[i].
        const connections: FakeConnection[] = connMember.map((_, i) =>
          harness.connect({ id: `c${i}` }),
        );

        // All connections join the room so every one is an eligible recipient.
        for (let i = 0; i < connections.length; i++) {
          harness.join(room, memberId(connMember[i]), connections[i]);
        }

        // Clear presence-join noise so we assert only on typing events.
        for (const conn of connections) conn.clear();

        const setter = connections[setterConn];
        const setterMember = memberId(connMember[setterConn]);

        // The member sets typing state to `value`, excluding its own connection.
        harness.setTyping(room, setterMember, value, setter);

        for (let i = 0; i < connections.length; i++) {
          const conn = connections[i];
          const typingEvents = conn.eventsOfType(ChannelEvents.Typing);

          if (i === setterConn) {
            // The setter's own connection is excluded from the typing event (Req 6.1, 6.2).
            assert.equal(
              typingEvents.length,
              0,
              'the setting connection must not receive its own typing event',
            );
            continue;
          }

          // Every other connection receives exactly one typing event carrying
          // the channel name, member id, and the typing value that was set
          // (Req 6.1 for true, Req 6.2 for false).
          assert.equal(
            typingEvents.length,
            1,
            'each other connection receives exactly one typing event',
          );
          const payload = typingEvents[0].payload as TypingPayload;
          assert.equal(payload.channel, room, 'typing event carries the channel name');
          assert.equal(payload.memberId, setterMember, 'typing event carries the member id');
          assert.equal(
            payload.typing,
            value,
            'typing event carries the typing value that was set',
          );
        }
      } finally {
        harness.close();
      }
    }),
    { numRuns: 100 },
  );
});

// ── Property 5 ────────────────────────────────────────────────────────────────

/**
 * A generated scenario for Property 5: a room, a typing member holding
 * `typingConns` (1..5) connections, and `otherConns` (0..4) connections owned by
 * a distinct observer member that remain after the typing member fully leaves.
 */
interface ClearScenario {
  room: string;
  typingConns: number;
  otherConns: number;
}

const clearScenarioArb: fc.Arbitrary<ClearScenario> = fc.record({
  room: fc.string({ minLength: 1, maxLength: 12 }),
  typingConns: fc.integer({ min: 1, max: 5 }),
  otherConns: fc.integer({ min: 0, max: 4 }),
});

test('Property 5: typing state is cleared when the last connection leaves', () => {
  fc.assert(
    fc.property(clearScenarioArb, (scenario) => {
      const { room, typingConns, otherConns } = scenario;
      const harness = createHarness();
      try {
        const typingMember = memberId(0);
        const observerMember = memberId(1);

        // The typing member's connections.
        const typingConnections: FakeConnection[] = [];
        for (let i = 0; i < typingConns; i++) {
          const conn = harness.connect({ id: `t${i}` });
          harness.join(room, typingMember, conn);
          typingConnections.push(conn);
        }

        // Distinct observer connections that remain after the typing member leaves.
        const observerConnections: FakeConnection[] = [];
        for (let i = 0; i < otherConns; i++) {
          const conn = harness.connect({ id: `o${i}` });
          harness.join(room, observerMember, conn);
          observerConnections.push(conn);
        }

        // Flag the typing member as typing.
        harness.setTyping(room, typingMember, true, typingConnections[0]);
        assert.ok(
          harness.hub.typingMembers(room).includes(typingMember),
          'typing member is flagged as typing before leaving',
        );

        // Clear recorded events so we only assert on what follows the leaves.
        for (const conn of observerConnections) conn.clear();

        // The typing member's connections leave one by one. Typing state must
        // only be considered cleared once the LAST connection leaves.
        for (let i = 0; i < typingConnections.length; i++) {
          harness.leave(room, typingMember, typingConnections[i]);
          const isLast = i === typingConnections.length - 1;
          if (!isLast) {
            assert.ok(
              harness.hub.typingMembers(room).includes(typingMember),
              'typing state persists while the member still holds a connection',
            );
          }
        }

        // After the last connection leaves, the member's typing state is cleared:
        // no stale `typing: true` remains (Req 6.4).
        assert.ok(
          !harness.hub.typingMembers(room).includes(typingMember),
          'typing state is cleared once the last connection leaves',
        );

        // Remaining (observer) connections observe the member as not typing: they
        // never saw a stale `typing: true` from the departed member linger, and a
        // fresh typing query reports the member is not typing.
        for (const conn of observerConnections) {
          const staleTypingTrue = conn
            .eventsOfType(ChannelEvents.Typing)
            .some((e) => {
              const payload = e.payload as TypingPayload;
              return payload.memberId === typingMember && payload.typing === true;
            });
          assert.ok(
            !staleTypingTrue,
            'remaining connections observe no stale typing:true for the departed member',
          );
        }
      } finally {
        harness.close();
      }
    }),
    { numRuns: 100 },
  );
});
