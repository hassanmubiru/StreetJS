// tests/dating-moderation-blocking-pbt.test.ts
// Property-based test for the @streetjs/dating-moderation blocking surface.
//
// Validates: Requirements 11.4 (blocking built on the Moderation_Toolkit,
// composing R8.2/R8.3).
//
// Over arbitrary sequences of block operations between a small set of users,
// the package-level invariant must hold for every ordered pair (from, to):
//
//   canMessage(from, to) === true  iff  `to` has NOT blocked `from`
//
// i.e. a recorded block from X to Y is exactly what prevents Y from messaging X,
// the relationship is directional, and re-issuing the same block is idempotent.
// `isBlockedBetween` must be the symmetric closure of that relation.
//
// fast-check drives ≥100 generated block sequences (repo convention).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { DatingModeration } from '../index.js';

const NUM_RUNS = 200;

const USERS = ['u0', 'u1', 'u2', 'u3'] as const;
type UserId = (typeof USERS)[number];
const userArb = fc.constantFrom<UserId>(...USERS);

// A block command: `blocker` blocks `blocked`.
const blockArb = fc.record({ blocker: userArb, blocked: userArb });
const blocksArb = fc.array(blockArb, { maxLength: 20 });

// Validates: Requirements 11.4
describe('dating-moderation blocking invariant (R11.4)', () => {
  it('canMessage(from,to) is true iff `to` has not blocked `from`, for every pair', async () => {
    await fc.assert(
      fc.asyncProperty(blocksArb, async (blocks) => {
        const mod = new DatingModeration();

        // Oracle: set of "${blocker}->${blocked}" relationships.
        const blocked = new Set<string>();

        for (const b of blocks) {
          await mod.blockUser(b.blocker, b.blocked);
          blocked.add(`${b.blocker}->${b.blocked}`);
        }

        // Check every ordered pair, including self-pairs.
        for (const from of USERS) {
          for (const to of USERS) {
            const expectedCanMessage = !blocked.has(`${to}->${from}`);
            assert.equal(
              await mod.canMessage(from, to),
              expectedCanMessage,
              `canMessage(${from}, ${to}) mismatch`,
            );

            const expectedBetween =
              blocked.has(`${from}->${to}`) || blocked.has(`${to}->${from}`);
            assert.equal(
              await mod.isBlockedBetween(from, to),
              expectedBetween,
              `isBlockedBetween(${from}, ${to}) mismatch`,
            );
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
