// src/tests/property-8-secured-channel.test.ts
//
// Feature: realtime-framework, Property 8: Secured-channel authorization gates
// join and broadcast — For any member and any channel configured as a
// Secured_Channel with an authorization rule, the member is admitted (and
// presence recorded as for an ordinary room) if and only if the rule authorizes
// the action; an unauthorized join records no presence and returns an
// authorization error, and an unauthenticated or unauthorized broadcast to the
// secured channel delivers the message to no connection.
//
// Validates: Requirements 10.1, 10.2, 10.3, 10.5
//
// The property is driven through the real facade (`createRealtime`) because
// `secure()` and the authorization gate live on the facade. Connections are
// `FakeConnection`s (Req 16) over a no-op `StreetWebSocketServer` (`noServer`,
// no port bound) so no network socket is opened. A deterministic authorizer
// admits a member iff its id is in a generated allowed-set, and the broadcast
// sender is resolved from `BroadcastOptions.exceptConnId` → the member bound via
// `realtime.bind`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { StreetWebSocketServer } from 'streetjs';
import { createRealtime, FakeConnection } from '../index.js';
import type { Member } from '../index.js';

/**
 * A generated scenario: a pool of members, each flagged authorized or not by a
 * deterministic allowed-set, plus which broadcast-sender cases to exercise.
 */
interface Scenario {
  /** authorized[i] === true ⇒ member `m{i}` is admitted by the rule. */
  authorized: boolean[];
  /** A stable channel name for the secured room. */
  channel: string;
}

/**
 * Generator: 1..6 members with an independently random authorization flag each
 * (so the allowed-set is any subset of the pool, including empty and full), and
 * a non-empty channel name.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  authorized: fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }),
  channel: fc.string({ minLength: 1, maxLength: 12 }),
});

const memberId = (index: number): string => `m${index}`;
const member = (index: number): Member => ({ id: memberId(index) });

test('Property 8: secured-channel authorization gates join and broadcast', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async (scenario) => {
      const { authorized, channel } = scenario;
      const allowed = new Set<string>(
        authorized.map((ok, i) => (ok ? memberId(i) : '')).filter((id) => id !== ''),
      );

      const server = new StreetWebSocketServer();
      const realtime = createRealtime({ server });
      try {
        // Deterministic authorizer: admit iff the acting member's id is in the
        // generated allowed-set. Applies to both `join` and `broadcast` actions.
        const room = realtime.secure(channel, (ctx) =>
          ctx.member !== null && allowed.has(ctx.member.id),
        );

        // ── Join gating (Req 10.1, 10.2, 10.5) ────────────────────────────────
        // Each member attempts to join over its own connection. A member is
        // admitted — and presence recorded exactly as for an ordinary room —
        // IFF the rule authorizes it; an unauthorized join records no presence
        // and returns an authorization error to the requesting connection.
        const joinConns: FakeConnection[] = authorized.map((_, i) =>
          new FakeConnection({ id: `join-${i}` }),
        );

        for (let i = 0; i < authorized.length; i++) {
          const conn = joinConns[i];
          if (allowed.has(memberId(i))) {
            await assert.doesNotReject(
              room.join(member(i), conn),
              `authorized member ${memberId(i)} must be admitted`,
            );
            assert.equal(
              conn.eventsOfType('error').length,
              0,
              `authorized member ${memberId(i)} must receive no authorization error`,
            );
          } else {
            await assert.rejects(
              room.join(member(i), conn),
              `unauthorized member ${memberId(i)} must be denied`,
            );
            const errors = conn.eventsOfType('error');
            assert.equal(
              errors.length,
              1,
              `denied member ${memberId(i)} must receive exactly one authorization error`,
            );
            assert.deepEqual(errors[0].payload, {
              channel,
              reason: 'unauthorized',
              action: 'join',
            });
          }
        }

        // Presence is exactly the set of authorized members (Req 10.2, 10.5):
        // admitted IFF the rule authorized the join.
        const present = new Set(await room.presence());
        for (let i = 0; i < authorized.length; i++) {
          const id = memberId(i);
          if (allowed.has(id)) {
            assert.ok(present.has(id), `admitted member ${id} must be present`);
          } else {
            assert.ok(!present.has(id), `denied member ${id} must not be present`);
          }
        }
        assert.equal(
          (await room.memberCount()),
          allowed.size,
          'member count must equal the number of authorized members',
        );

        // Record which connections are eligible to receive a broadcast (the
        // authorized members that successfully joined), and clear the
        // presence:join noise so broadcast assertions are clean.
        const joinedConns = joinConns.filter((_, i) => allowed.has(memberId(i)));
        for (const conn of joinedConns) conn.clear();

        const type = 'secret';

        // ── Unauthenticated broadcast (Req 10.3) ──────────────────────────────
        // No sender connection is identified (no `exceptConnId`), so the sender
        // is unauthenticated: the broadcast must reach no connection.
        await room.broadcast({ type, payload: { text: 'anon' } });
        for (const conn of joinedConns) {
          assert.equal(
            conn.eventsOfType(type).length,
            0,
            `unauthenticated broadcast must not reach connection ${conn.id}`,
          );
        }

        // Also cover an unresolvable sender: an `exceptConnId` that is not bound
        // to any member is treated as unauthenticated and delivers nothing.
        await room.broadcast({ type, payload: { text: 'ghost' } }, { exceptConnId: 'not-bound' });
        for (const conn of joinedConns) {
          assert.equal(
            conn.eventsOfType(type).length,
            0,
            `broadcast from an unbound sender must not reach connection ${conn.id}`,
          );
        }

        // ── Unauthorized broadcast (Req 10.3) ─────────────────────────────────
        // Bind a sender connection to an unauthorized member; the rule denies
        // the broadcast action, so nothing is delivered.
        const unauthorizedIdx = authorized.findIndex((_, i) => !allowed.has(memberId(i)));
        if (unauthorizedIdx !== -1) {
          const badSender = new FakeConnection({ id: 'bad-sender' });
          realtime.bind(badSender, member(unauthorizedIdx));
          await room.broadcast({ type, payload: { text: 'nope' } }, { exceptConnId: badSender.id });
          for (const conn of joinedConns) {
            assert.equal(
              conn.eventsOfType(type).length,
              0,
              `unauthorized broadcast must not reach connection ${conn.id}`,
            );
          }
        }

        // ── Authorized broadcast completes the IFF (Req 10.5) ─────────────────
        // Bind a sender connection to an authorized member; the rule permits the
        // broadcast, so every eligible joined connection receives it exactly once.
        const authorizedIdx = authorized.findIndex((_, i) => allowed.has(memberId(i)));
        if (authorizedIdx !== -1) {
          for (const conn of joinedConns) conn.clear();
          const goodSender = new FakeConnection({ id: 'good-sender' });
          realtime.bind(goodSender, member(authorizedIdx));
          await room.broadcast(
            { type, payload: { text: 'hello' } },
            { exceptConnId: goodSender.id },
          );
          for (const conn of joinedConns) {
            assert.equal(
              conn.eventsOfType(type).length,
              1,
              `authorized broadcast must reach joined connection ${conn.id} exactly once`,
            );
          }
        }
      } finally {
        await realtime.close();
      }
    }),
    { numRuns: 100 },
  );
});
