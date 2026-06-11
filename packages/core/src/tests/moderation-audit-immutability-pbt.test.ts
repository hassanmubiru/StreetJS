// tests/moderation-audit-immutability-pbt.test.ts
// Property-based test for the Moderation_Toolkit (Phase 7, Requirement 8).
//
// Feature: consumer-platform-security, Property 20 — Audit-event immutability.
// Validates: Requirements 8.5, 8.7
//
// This file proves, across arbitrary sequences of public moderation operations
// (report, block, mute, resolve), the two halves of the audit-log contract:
//
//   - Append-exactly-one + faithful record (R8.5): every state-changing
//     operation appends exactly one Audit_Event, and that event records the
//     correct actor, target, action, and timestamp for the operation.
//
//   - Prior-events immutability (R8.7): every Audit_Event recorded before an
//     operation remains byte-for-byte unchanged after it — the public API only
//     ever appends, and never rewrites history. We further assert there is no
//     public mutation path at all: the events returned by `audit()` are frozen,
//     and mutating the returned array (or attempting to mutate an event) does
//     not alter the toolkit's stored log.
//
// An injected clock returns a single value held constant for the duration of
// each operation, so the timestamp recorded for that operation is exactly
// predictable and can be asserted (R8.5).
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// property is exercised across many generated inputs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  ModerationToolkit,
  InMemoryModerationStore,
  type AuditEvent,
  type ModerationAction,
} from '../security/moderation.js';

const NUM_RUNS = 200;

// Small, fixed user id space so actors/targets collide often.
const USERS = ['u0', 'u1', 'u2', 'u3', 'u4'] as const;
type UserId = (typeof USERS)[number];
const userArb = fc.constantFrom(...USERS);
const textArb = fc.string({ maxLength: 16 });

// A generated moderation command. `resolve` carries a non-negative picker used
// at execution time to select among the reports created so far (modulo count);
// if no report exists yet, the command is skipped (it would otherwise throw and
// append nothing).
type Command =
  | { kind: 'report'; reporter: UserId; target: UserId; reason: string }
  | { kind: 'block'; a: UserId; b: UserId }
  | { kind: 'mute'; muter: UserId; muted: UserId }
  | { kind: 'resolve'; moderator: UserId; outcome: string; pick: number };

const commandArb: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    kind: fc.constant('report' as const),
    reporter: userArb,
    target: userArb,
    reason: textArb,
  }),
  fc.record({ kind: fc.constant('block' as const), a: userArb, b: userArb }),
  fc.record({ kind: fc.constant('mute' as const), muter: userArb, muted: userArb }),
  fc.record({
    kind: fc.constant('resolve' as const),
    moderator: userArb,
    outcome: textArb,
    pick: fc.nat({ max: 1000 }),
  }),
);

const commandsArb: fc.Arbitrary<Command[]> = fc.array(commandArb, { maxLength: 30 });

// What a successfully executed command is expected to record in the audit log.
interface Expected {
  actor: string;
  target: string;
  action: ModerationAction;
  ts: number;
}

// Structural equality over the audit-event fields (ignoring the random id,
// which we assert separately is a non-empty string).
function sameEvent(a: AuditEvent, b: AuditEvent): boolean {
  return (
    a.id === b.id &&
    a.actor === b.actor &&
    a.target === b.target &&
    a.action === b.action &&
    a.ts === b.ts
  );
}

// Feature: consumer-platform-security, Property 20: Audit-event immutability
// Validates: Requirements 8.5, 8.7
describe('Property 20: audit-event immutability', () => {
  it('appends exactly one faithful event per operation and never alters prior events (R8.5, R8.7)', async () => {
    await fc.assert(
      fc.asyncProperty(commandsArb, async (commands) => {
        // A clock whose value we control: held constant per operation so the
        // recorded timestamp is exactly predictable.
        let now = 0;
        const toolkit = new ModerationToolkit(new InMemoryModerationStore(), {
          clock: () => now,
        });

        // Targets of created reports, in creation order, so resolve picks a
        // real report and we can predict the resolve event's target.
        const reportTargets: string[] = [];

        for (const cmd of commands) {
          // Resolve needs an existing report; skip if none have been created.
          if (cmd.kind === 'resolve' && reportTargets.length === 0) continue;

          now += 1; // a fresh, distinct timestamp for this operation

          const before = await toolkit.audit();
          const beforeSnapshot = before.map((e) => ({ ...e }));

          let expected: Expected;
          switch (cmd.kind) {
            case 'report': {
              const report = await toolkit.report(cmd.reporter, cmd.target, cmd.reason);
              reportTargets.push(report.target);
              expected = { actor: cmd.reporter, target: cmd.target, action: 'report', ts: now };
              break;
            }
            case 'block': {
              await toolkit.block(cmd.a, cmd.b);
              expected = { actor: cmd.a, target: cmd.b, action: 'block', ts: now };
              break;
            }
            case 'mute': {
              await toolkit.mute(cmd.muter, cmd.muted);
              expected = { actor: cmd.muter, target: cmd.muted, action: 'mute', ts: now };
              break;
            }
            case 'resolve': {
              const idx = cmd.pick % reportTargets.length;
              const queue = await toolkit.queue();
              // Resolve a known, pending report if one remains; otherwise resolve
              // any existing report by reconstructing from the queue is not
              // possible, so fall back to the first report's target. The queue
              // exposes pending reports with ids we can resolve directly.
              const pending = queue[idx % Math.max(queue.length, 1)];
              if (queue.length === 0) {
                // All reports already resolved — nothing pending to resolve.
                // Undo the clock tick and skip without asserting an append.
                now -= 1;
                continue;
              }
              await toolkit.resolve(cmd.moderator, pending.id, cmd.outcome);
              expected = {
                actor: cmd.moderator,
                target: pending.target,
                action: 'resolve',
                ts: now,
              };
              break;
            }
          }

          const after = await toolkit.audit();

          // (R8.5) Exactly one new event was appended.
          assert.equal(
            after.length,
            before.length + 1,
            `expected exactly one appended event for ${cmd.kind}`,
          );

          // (R8.7) Every previously recorded event is byte-for-byte unchanged.
          for (let i = 0; i < beforeSnapshot.length; i++) {
            assert.deepEqual(
              { ...after[i] },
              beforeSnapshot[i],
              `prior audit event at index ${i} was modified by ${cmd.kind}`,
            );
          }

          // (R8.5) The appended event faithfully records actor/target/action/ts.
          const appended = after[after.length - 1];
          assert.equal(appended.actor, expected.actor);
          assert.equal(appended.target, expected.target);
          assert.equal(appended.action, expected.action);
          assert.equal(appended.ts, expected.ts);
          assert.equal(typeof appended.id, 'string');
          assert.ok(appended.id.length > 0, 'audit event id must be a non-empty string');
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('exposes no public mutation path: returned events are frozen and the stored log is unaffected by caller mutation (R8.7)', async () => {
    await fc.assert(
      fc.asyncProperty(commandsArb, async (commands) => {
        let now = 0;
        const toolkit = new ModerationToolkit(new InMemoryModerationStore(), {
          clock: () => now,
        });

        // Drive some audit history (report/block/mute are always executable).
        for (const cmd of commands) {
          now += 1;
          switch (cmd.kind) {
            case 'report':
              await toolkit.report(cmd.reporter, cmd.target, cmd.reason);
              break;
            case 'block':
              await toolkit.block(cmd.a, cmd.b);
              break;
            case 'mute':
              await toolkit.mute(cmd.muter, cmd.muted);
              break;
            case 'resolve':
              // Skip resolve here; covered by the first property.
              now -= 1;
              break;
          }
        }

        const log = await toolkit.audit();
        const canonical = log.map((e) => ({ ...e }));

        // Each returned event is frozen — no field can be reassigned.
        for (const e of log) {
          assert.ok(Object.isFrozen(e), 'returned audit event must be frozen');
        }

        // Mutating the returned array (push/splice/sort) must not affect the
        // toolkit's stored log — `audit()` returns a fresh, independent view.
        const mutable = log as AuditEvent[];
        if (mutable.length > 0) {
          mutable.reverse();
          mutable.pop();
        }
        mutable.push({
          id: 'injected',
          actor: 'attacker',
          target: 'victim',
          action: 'block',
          ts: 999999,
        });

        const after = await toolkit.audit();

        // The stored log is identical to the canonical snapshot taken before the
        // caller-side mutation — append-only and isolated from external edits.
        assert.equal(after.length, canonical.length);
        for (let i = 0; i < canonical.length; i++) {
          assert.ok(
            sameEvent(after[i], canonical[i] as AuditEvent),
            `stored audit event at index ${i} changed after caller mutated the returned array`,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
