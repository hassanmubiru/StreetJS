// src/tests/property-2-presence-transitions.test.ts
//
// Feature: realtime-framework, Property 2: Presence transitions emit the correct
// events to other connections — For any room and any member, when the member
// becomes newly present the hub delivers exactly one presence:join event
// (carrying the channel name and member id) to the other connections in the
// room, and when the member becomes newly absent it delivers exactly one
// presence:leave event to the remaining connections; the transitioning
// connection itself never receives its own presence event.
//
// Validates: Requirements 5.1, 5.2, 8.4
//
// The property is exercised through the fake-connection harness (Req 16) so no
// network socket is opened. A randomized sequence of join / duplicate-join /
// leave operations is driven against the hub while a reference model tracks the
// currently-joined (connIdx -> member) set and the exact per-connection sequence
// of presence events that each connection should have received. After every
// operation the recorded events on every FakeConnection are compared against the
// model, which enforces (a) exactly one presence:join to the other connections on
// a newly-present transition, (b) exactly one presence:leave to the remaining
// connections on a newly-absent transition, and (c) that the transitioning
// connection never receives its own presence event.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { ChannelEvents, type PresencePayload } from 'streetjs';
import { createHarness, type FakeConnection } from '../index.js';

/** One driven operation over the fixed connection pool. */
type Op =
  | { kind: 'join'; conn: number }
  | { kind: 'joinDup'; conn: number }
  | { kind: 'leave'; conn: number };

/** A generated scenario: a member-per-connection mapping plus an op sequence. */
interface Scenario {
  room: string;
  /** connMember[i] is the member index that owns connection i. */
  connMember: number[];
  ops: Op[];
}

/** An expected presence event recorded on a connection. */
interface ExpectedEvent {
  type: string;
  memberId: string;
}

/**
 * Generator: 1..8 connections, each owned by one of 1..4 members, driven by a
 * sequence of up to 40 join/duplicate-join/leave operations. Duplicate joins
 * arise both from the explicit `joinDup` kind and naturally from repeated
 * `join`s of an already-joined connection, exercising idempotent presence
 * (which must NOT emit a presence event).
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    room: fc.string({ minLength: 1, maxLength: 12 }),
    numMembers: fc.integer({ min: 1, max: 4 }),
    connMember: fc.array(fc.nat({ max: 3 }), { minLength: 1, maxLength: 8 }),
    rawOps: fc.array(
      fc.record({
        kind: fc.constantFrom('join', 'joinDup', 'leave'),
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

test('Property 2: presence transitions emit the correct events to other connections', () => {
  fc.assert(
    fc.property(scenarioArb, (scenario) => {
      const { room, connMember, ops } = scenario;
      const harness = createHarness();
      try {
        // Fixed pool of fake connections; connections[i] belongs to member connMember[i].
        const connections: FakeConnection[] = connMember.map((_, i) =>
          harness.connect({ id: `c${i}` }),
        );

        // Reference model:
        //   joined: connIdx -> owning member index for connections currently in the room.
        //   expected[i]: the exact ordered sequence of presence events connection i
        //                should have received so far.
        const joined = new Map<number, number>();
        const expected: ExpectedEvent[][] = connMember.map(() => []);

        /** Whether member `m` currently holds any joined connection. */
        const memberPresent = (m: number): boolean => [...joined.values()].includes(m);

        /**
         * Assert every connection's recorded presence events (join + leave, in
         * order) exactly match the model, including channel and member id on the
         * payload. Exact-sequence equality also enforces that the transitioning
         * connection never received its own presence event, since the model never
         * adds the transitioning connection to the recipient set.
         */
        const assertInvariants = (): void => {
          for (let i = 0; i < connections.length; i++) {
            const actual = connections[i]
              .events()
              .filter(
                (e) =>
                  e.type === ChannelEvents.PresenceJoin ||
                  e.type === ChannelEvents.PresenceLeave,
              );
            const exp = expected[i];
            assert.equal(
              actual.length,
              exp.length,
              `connection c${i} received the expected number of presence events`,
            );
            for (let k = 0; k < exp.length; k++) {
              const payload = actual[k].payload as PresencePayload;
              assert.equal(
                actual[k].type,
                exp[k].type,
                `connection c${i} presence event #${k} has the expected type`,
              );
              assert.equal(
                payload.channel,
                room,
                `connection c${i} presence event #${k} carries the channel name`,
              );
              assert.equal(
                payload.memberId,
                exp[k].memberId,
                `connection c${i} presence event #${k} carries the transitioning member id`,
              );
            }
          }
        };

        for (const op of ops) {
          const owner = connMember[op.conn];
          const id = memberId(owner);
          const conn = connections[op.conn];

          if (op.kind === 'leave') {
            const wasJoined = joined.has(op.conn);
            joined.delete(op.conn);
            const stillPresent = memberPresent(owner);
            const { nowAbsent } = harness.leave(room, id, conn);

            assert.equal(
              nowAbsent,
              wasJoined && !stillPresent,
              'leave reports nowAbsent iff the last connection of the member left',
            );

            // On a newly-absent transition the hub delivers exactly one
            // presence:leave to the remaining connections (Req 5.2, 8.4). The
            // leaving connection is already removed from the channel and excluded,
            // so it never receives its own leave event. Remaining recipients are
            // exactly the connections still joined (which belong to other members,
            // since this member is now absent).
            if (nowAbsent) {
              for (const recipient of joined.keys()) {
                expected[recipient].push({
                  type: ChannelEvents.PresenceLeave,
                  memberId: id,
                });
              }
            }
          } else {
            // join / joinDup
            const wasPresent = memberPresent(owner);
            // Recipients of a potential presence:join are the connections already
            // in the room, excluding the joining connection itself.
            const recipientsBefore = [...joined.keys()].filter((c) => c !== op.conn);
            const { newlyPresent } = harness.join(room, id, conn);
            joined.set(op.conn, owner);

            assert.equal(
              newlyPresent,
              !wasPresent,
              'join reports newlyPresent iff member had no prior connection',
            );

            // On a newly-present transition the hub delivers exactly one
            // presence:join to the OTHER connections (Req 5.1); the joining
            // connection is excluded and never receives its own join event. A
            // duplicate/idempotent join of an already-present member emits nothing.
            if (newlyPresent) {
              for (const recipient of recipientsBefore) {
                expected[recipient].push({
                  type: ChannelEvents.PresenceJoin,
                  memberId: id,
                });
              }
            }
          }

          assertInvariants();

          // Explicit guard for the "never receives its own presence event" clause:
          // the transitioning connection must never have recorded a presence event
          // carrying its own member id.
          const ownEvents = conn
            .events()
            .filter(
              (e) =>
                (e.type === ChannelEvents.PresenceJoin ||
                  e.type === ChannelEvents.PresenceLeave) &&
                (e.payload as PresencePayload).memberId === id,
            );
          assert.equal(
            ownEvents.length,
            0,
            `connection c${op.conn} never receives a presence event for its own member`,
          );
        }
      } finally {
        harness.close();
      }
    }),
    { numRuns: 100 },
  );
});
