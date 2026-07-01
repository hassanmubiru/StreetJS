// src/tests/property-3-broadcast-scope.test.ts
//
// Feature: realtime-framework, Property 3: Broadcast delivery scope honors
// membership and exclusions — For any room populated with an arbitrary set of
// members and connections, and any broadcast with an optional excluded
// connection id and/or excluded member id, the event is delivered to exactly
// the eligible connections — those that are members of the room, minus the
// excluded connection, minus every connection belonging to the excluded member
// — and to no others; connections outside the room never receive it.
//
// Validates: Requirements 7.1, 7.2, 7.3
//
// The property is exercised through the fake-connection harness (Req 16) so no
// network socket is opened. Each run populates a room with a random set of
// connections (each owned by one of a small pool of members) plus a set of
// out-of-room connections, then broadcasts a unique event with a randomly
// chosen exclusion set (an excluded connection id and/or an excluded member id)
// and asserts on the events recorded by every fake connection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import type { PublishOptions } from 'streetjs';

import { createHarness, type FakeConnection } from '../index.js';

/** A generated scenario: an in-room member-per-connection mapping, some
 *  out-of-room connections, and an optional exclusion set. */
interface Scenario {
  room: string;
  /** owners[i] is the member index that owns in-room connection i. */
  owners: number[];
  /** Number of connections that are opened but never join the room. */
  numOutside: number;
  /** Index into the in-room connection pool to exclude by connection id, or undefined. */
  exceptConnIdx: number | undefined;
  /** Member index to exclude by member id, or undefined. */
  exceptMemberIdx: number | undefined;
}

/**
 * Generator: a non-empty room name; 1..8 in-room connections each owned by one
 * of 1..4 members (so a member can hold several connections, exercising the
 * per-member exclusion across all of them); 0..4 out-of-room connections; and
 * an optional excluded connection id and/or excluded member id.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    room: fc.string({ minLength: 1, maxLength: 12 }),
    numMembers: fc.integer({ min: 1, max: 4 }),
    ownersRaw: fc.array(fc.nat({ max: 7 }), { minLength: 1, maxLength: 8 }),
    numOutside: fc.integer({ min: 0, max: 4 }),
    exceptConnRaw: fc.option(fc.nat(), { nil: undefined }),
    exceptMemberRaw: fc.option(fc.nat({ max: 7 }), { nil: undefined }),
  })
  .map(({ room, numMembers, ownersRaw, numOutside, exceptConnRaw, exceptMemberRaw }) => {
    const owners = ownersRaw.map((m) => m % numMembers);
    const exceptConnIdx = exceptConnRaw === undefined ? undefined : exceptConnRaw % owners.length;
    const exceptMemberIdx =
      exceptMemberRaw === undefined ? undefined : exceptMemberRaw % numMembers;
    return { room, owners, numOutside, exceptConnIdx, exceptMemberIdx };
  });

const memberId = (index: number): string => `m${index}`;

test('Property 3: broadcast delivery scope honors membership and exclusions', () => {
  fc.assert(
    fc.property(scenarioArb, (scenario) => {
      const { room, owners, numOutside, exceptConnIdx, exceptMemberIdx } = scenario;
      const harness = createHarness();
      try {
        // In-room connections: connection i belongs to member owners[i].
        const inRoom: FakeConnection[] = owners.map((_, i) => harness.connect({ id: `in${i}` }));
        inRoom.forEach((conn, i) => harness.join(room, memberId(owners[i]), conn));

        // Out-of-room connections: opened but never joined to the room.
        const outside: FakeConnection[] = Array.from({ length: numOutside }, (_, i) =>
          harness.connect({ id: `out${i}` }),
        );

        // Drop presence:join noise emitted during setup so we assert purely on
        // the broadcast that follows.
        for (const conn of inRoom) conn.clear();
        for (const conn of outside) conn.clear();

        // Build the exclusion options for this broadcast.
        const options: PublishOptions = {};
        if (exceptConnIdx !== undefined) options.exceptConnId = inRoom[exceptConnIdx].id;
        if (exceptMemberIdx !== undefined) options.exceptMemberId = memberId(exceptMemberIdx);

        const type = 'chat';
        const payload = { text: 'hello', n: owners.length };
        harness.broadcast(room, type, payload, options);

        // Every in-room connection is eligible unless it is the excluded
        // connection or belongs to the excluded member (Req 7.1, 7.2, 7.3).
        for (let i = 0; i < inRoom.length; i++) {
          const excludedByConn = exceptConnIdx !== undefined && i === exceptConnIdx;
          const excludedByMember = exceptMemberIdx !== undefined && owners[i] === exceptMemberIdx;
          const eligible = !excludedByConn && !excludedByMember;

          const received = inRoom[i].eventsOfType(type);
          if (eligible) {
            assert.equal(
              received.length,
              1,
              `eligible connection ${inRoom[i].id} must receive the broadcast exactly once`,
            );
            assert.deepEqual(
              received[0].payload,
              payload,
              `eligible connection ${inRoom[i].id} must receive the exact payload`,
            );
          } else {
            assert.equal(
              received.length,
              0,
              `excluded connection ${inRoom[i].id} must not receive the broadcast`,
            );
          }
        }

        // Connections outside the room never receive the broadcast (Req 7.1).
        for (const conn of outside) {
          assert.equal(
            conn.eventsOfType(type).length,
            0,
            `out-of-room connection ${conn.id} must never receive the broadcast`,
          );
        }
      } finally {
        harness.close();
      }
    }),
    { numRuns: 100 },
  );
});
