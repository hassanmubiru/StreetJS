// src/tests/property-1-presence.test.ts
//
// Feature: realtime-framework, Property 1: Presence is ref-counted and idempotent —
// For any member holding any number of connections in any room, and any sequence
// of join, duplicate-join, and leave operations over those connections, the member
// is recorded as present if and only if it currently holds at least one live
// connection in the room; duplicate joins of the same connection never record
// duplicate presence, memberCount() always equals the number of distinct present
// members, and once a room's last connection leaves the channel's presence and
// typing state is released.
//
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3, 5.5, 8.2, 8.4
//
// The property is exercised through the fake-connection harness (Req 16) so no
// network socket is opened. A randomized sequence of join / duplicate-join /
// leave / typing operations is driven against the hub while a reference model
// tracks the currently-joined (connIdx -> member) set; after every operation the
// invariants above are asserted against the live hub state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { createHarness, type FakeConnection } from '../index.js';

/** One driven operation over the fixed connection pool. */
type Op =
  | { kind: 'join'; conn: number }
  | { kind: 'joinDup'; conn: number }
  | { kind: 'leave'; conn: number }
  | { kind: 'typing'; conn: number };

/** A generated scenario: a member-per-connection mapping plus an op sequence. */
interface Scenario {
  room: string;
  /** connMember[i] is the member index that owns connection i. */
  connMember: number[];
  ops: Op[];
}

/**
 * Generator: 1..8 connections, each owned by one of 1..4 members, driven by a
 * sequence of up to 40 join/duplicate-join/leave/typing operations. Duplicate
 * joins arise both from the explicit `joinDup` kind and naturally from repeated
 * `join`s of an already-joined connection.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    room: fc.string({ minLength: 1, maxLength: 12 }),
    numMembers: fc.integer({ min: 1, max: 4 }),
    connMember: fc.array(fc.nat({ max: 3 }), { minLength: 1, maxLength: 8 }),
    rawOps: fc.array(
      fc.record({
        kind: fc.constantFrom('join', 'joinDup', 'leave', 'typing'),
        conn: fc.nat(),
      }),
      { minLength: 1, maxLength: 40 },
    ),
  })
  .map(({ room, numMembers, connMember, rawOps }) => {
    const owners = connMember.map((m) => m % numMembers);
    const ops: Op[] = rawOps.map((o) => ({
      kind: o.kind as Op['kind'],
      conn: o.conn % owners.length,
    }));
    return { room, connMember: owners, ops };
  });

const memberId = (index: number): string => `m${index}`;

test('Property 1: presence is ref-counted and idempotent', () => {
  fc.assert(
    fc.property(scenarioArb, (scenario) => {
      const { room, connMember, ops } = scenario;
      const harness = createHarness();
      try {
        // Fixed pool of fake connections; connections[i] belongs to member connMember[i].
        const connections: FakeConnection[] = connMember.map((_, i) =>
          harness.connect({ id: `c${i}` }),
        );

        // Reference model: connIdx -> owning member index, for connections
        // currently joined to the room, and members flagged as typing.
        const joined = new Map<number, number>();
        const typing = new Set<number>();

        /** Distinct member ids currently present per the model. */
        const modelPresent = (): Set<string> => {
          const present = new Set<string>();
          for (const owner of joined.values()) present.add(memberId(owner));
          return present;
        };

        const assertInvariants = (): void => {
          const expected = modelPresent();

          // presence() equals the model's distinct present members (Req 4.1, 5.3, 5.5).
          const actualPresence = harness.presence(room);
          assert.equal(
            actualPresence.length,
            new Set(actualPresence).size,
            'presence() must not contain duplicates',
          );
          assert.deepEqual(
            new Set(actualPresence),
            expected,
            'presence() must equal the distinct present members',
          );

          // memberCount() equals the number of distinct present members (Req 4.4).
          assert.equal(
            harness.memberCount(room),
            expected.size,
            'memberCount() must equal the number of distinct present members',
          );

          // A member is present iff it holds >= 1 live connection (Req 4.1, 4.2, 4.3).
          for (let m = 0; m < 4; m++) {
            const id = memberId(m);
            const holdsConn = [...joined.values()].includes(m);
            assert.equal(
              harness.hub.isPresent(room, id),
              holdsConn,
              `member ${id} present iff it holds >= 1 live connection`,
            );
          }

          // connectionCount equals the number of distinct joined connections —
          // duplicate joins never inflate the count (Req 4.6, 8.2).
          assert.equal(
            harness.hub.connectionCount(room),
            joined.size,
            'duplicate joins must not record duplicate connections',
          );

          // Typing state only ever exists for members still present (Req 8.4).
          const expectedTyping = new Set(
            [...typing].filter((m) => [...joined.values()].includes(m)).map(memberId),
          );
          assert.deepEqual(
            new Set(harness.hub.typingMembers(room)),
            expectedTyping,
            'typing state must be released when a member becomes absent',
          );
        };

        for (const op of ops) {
          const owner = connMember[op.conn];
          const id = memberId(owner);
          const conn = connections[op.conn];

          switch (op.kind) {
            case 'join':
            case 'joinDup': {
              const alreadyPresent = [...joined.values()].includes(owner);
              const { newlyPresent } = harness.join(room, id, conn);
              // newlyPresent is true iff the member had no prior connection.
              assert.equal(
                newlyPresent,
                !alreadyPresent,
                'join reports newlyPresent iff member had no prior connection',
              );
              joined.set(op.conn, owner);
              break;
            }
            case 'leave': {
              const wasJoined = joined.has(op.conn);
              joined.delete(op.conn);
              const stillPresent = [...joined.values()].includes(owner);
              const { nowAbsent } = harness.leave(room, id, conn);
              // nowAbsent is true iff the connection had been joined and was the
              // member's last connection in the room.
              assert.equal(
                nowAbsent,
                wasJoined && !stillPresent,
                'leave reports nowAbsent iff the last connection of the member left',
              );
              break;
            }
            case 'typing': {
              // Only set typing for a member that is currently present; the hub
              // must release it automatically once the member becomes absent.
              if ([...joined.values()].includes(owner)) {
                harness.setTyping(room, id, true, conn);
                typing.add(owner);
              }
              break;
            }
          }

          assertInvariants();
        }

        // Drain: leave every still-joined connection. Once the room's last
        // connection leaves, its presence and typing state must be released and
        // the channel dropped entirely (Req 4.3, 4.5, 8.4).
        for (const [connIdx, owner] of [...joined]) {
          joined.delete(connIdx);
          harness.leave(room, memberId(owner), connections[connIdx]);
        }
        assert.deepEqual(harness.presence(room), [], 'presence released after last leave');
        assert.equal(harness.memberCount(room), 0, 'memberCount is 0 after last leave');
        assert.deepEqual(
          harness.hub.typingMembers(room),
          [],
          'typing state released after last leave',
        );
        assert.equal(
          harness.hub.connectionCount(room),
          0,
          'connection count is 0 after last leave',
        );
        assert.ok(
          !harness.hub.channelNames().includes(room),
          'channel state is released once no connections and no members remain',
        );
      } finally {
        harness.close();
      }
    }),
    { numRuns: 100 },
  );
});
