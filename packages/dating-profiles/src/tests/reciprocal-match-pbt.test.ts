// packages/dating-profiles/src/tests/reciprocal-match-pbt.test.ts
//
// Feature: consumer-platform-security, Property 24
//
// Property 24: Reciprocal likes produce a match.
//
//   For any sequence of likes between users, a match is recorded for a pair
//   if and only if both users in the pair have liked each other.
//
// Validates: Requirements 11.2
//
// This property-based test exercises ProfileService.like / isMatch over many
// randomly generated like sequences (fast-check, >=100 runs). For every
// unordered pair of distinct users it checks the biconditional:
//   isMatch(a, b)  <=>  liked(a -> b) AND liked(b -> a)
// using an independent reference model of directional likes, so the matching
// invariant is verified against the actual semantics rather than a copy of the
// implementation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fc from 'fast-check';

import { FieldCipher, Keyring } from 'streetjs';
import { ProfileService, InMemoryProfileStore } from '../index.js';

function newService(): ProfileService {
  const cipher = new FieldCipher(Keyring.fromKey(randomBytes(32)));
  return new ProfileService({ cipher, store: new InMemoryProfileStore(), now: () => 1000 });
}

/** Stable, order-independent key for an unordered pair. */
function pairKey(a: string, b: string): string {
  return a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

test('Feature: consumer-platform-security, Property 24 — reciprocal likes produce a match (Validates: Requirements 11.2)', async () => {
  // A small fixed user universe keeps reciprocal pairs frequent so both
  // branches of the biconditional are exercised across runs.
  const users = ['u0', 'u1', 'u2', 'u3', 'u4'];
  const userArb = fc.constantFrom(...users);

  // A like is an ordered (from, to) pair; self-likes are filtered out since
  // ProfileService rejects them by contract.
  const likeArb = fc
    .record({ from: userArb, to: userArb })
    .filter((l) => l.from !== l.to);

  await fc.assert(
    fc.asyncProperty(fc.array(likeArb, { maxLength: 40 }), async (likes) => {
      const service = newService();

      // Independent reference model of directional likes.
      const liked = new Set<string>();
      for (const { from, to } of likes) {
        await service.like(from, to);
        liked.add(`${from}->${to}`);
      }

      // For every unordered pair of distinct users, the recorded match state
      // must equal "both directions liked".
      for (let i = 0; i < users.length; i++) {
        for (let j = i + 1; j < users.length; j++) {
          const a = users[i];
          const b = users[j];
          const expectedMatch = liked.has(`${a}->${b}`) && liked.has(`${b}->${a}`);
          const actualMatch = await service.isMatch(a, b);
          assert.equal(
            actualMatch,
            expectedMatch,
            `pair ${pairKey(a, b)}: expected match=${expectedMatch} but got ${actualMatch}`,
          );
          // Order-independence: isMatch must agree regardless of argument order.
          assert.equal(await service.isMatch(b, a), actualMatch);
        }
      }
    }),
    { numRuns: 200 },
  );
});
