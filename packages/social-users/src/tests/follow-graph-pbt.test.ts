// follow-graph-pbt.test.ts
// Property-based tests for the follow graph's universal invariants, exercised
// across many generated sequences of follow/unfollow operations.
//
// Properties:
//   P1 (idempotent set semantics): isFollowing(a,b) is true iff the last
//      mutating op on the (a,b) edge was a follow. follow/unfollow are idempotent.
//   P2 (count consistency): countFollowers(u) === |{x : x follows u}| and
//      countFollowing(u) === |{x : u follows x}|, derived from a reference model.
//   P3 (mutual symmetry): isMutual(a,b) === isMutual(b,a) === (a→b ∧ b→a).
//   P4 (no self edges): self-follow always throws and never creates an edge.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { FollowService } from '../index.js';

const USERS = ['u0', 'u1', 'u2', 'u3', 'u4'] as const;
const userArb = fc.constantFrom(...USERS);

interface Op {
  kind: 'follow' | 'unfollow';
  from: (typeof USERS)[number];
  to: (typeof USERS)[number];
}

const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom('follow', 'unfollow'),
  from: userArb,
  to: userArb,
});

/** Reference model: a set of directional edges "from\u0000to". */
function applyModel(ops: Op[]): Set<string> {
  const edges = new Set<string>();
  for (const op of ops) {
    if (op.from === op.to) continue; // self-edges are rejected by the service
    const key = `${op.from}\u0000${op.to}`;
    if (op.kind === 'follow') edges.add(key);
    else edges.delete(key);
  }
  return edges;
}

describe('Property: follow graph matches a set-based reference model', () => {
  it('P1+P2+P3: edge existence, counts, and mutuality match the model', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(opArb, { maxLength: 60 }), async (ops) => {
        const svc = new FollowService({ now: () => 1 });
        for (const op of ops) {
          if (op.from === op.to) {
            await assert.rejects(() =>
              op.kind === 'follow' ? svc.follow(op.from, op.to) : svc.unfollow(op.from, op.to),
            );
            continue;
          }
          if (op.kind === 'follow') await svc.follow(op.from, op.to);
          else await svc.unfollow(op.from, op.to);
        }

        const model = applyModel(ops);

        // P1: edge existence matches the model for every ordered pair.
        for (const a of USERS) {
          for (const b of USERS) {
            const expected = a !== b && model.has(`${a}\u0000${b}`);
            assert.equal(await svc.isFollowing(a, b), expected, `isFollowing(${a},${b})`);
          }
        }

        // P2: counts match the model.
        for (const u of USERS) {
          let followers = 0;
          let following = 0;
          for (const e of model) {
            const [from, to] = e.split('\u0000');
            if (to === u) followers++;
            if (from === u) following++;
          }
          const counts = await svc.counts(u);
          assert.equal(counts.followers, followers, `countFollowers(${u})`);
          assert.equal(counts.following, following, `countFollowing(${u})`);
          // Listing length agrees with the count.
          assert.equal((await svc.followers(u)).length, followers);
          assert.equal((await svc.following(u)).length, following);
        }

        // P3: mutuality is symmetric and equals both directions present.
        for (const a of USERS) {
          for (const b of USERS) {
            const expected = a !== b && model.has(`${a}\u0000${b}`) && model.has(`${b}\u0000${a}`);
            assert.equal(await svc.isMutual(a, b), expected, `isMutual(${a},${b})`);
            assert.equal(await svc.isMutual(a, b), await svc.isMutual(b, a), `mutual symmetry ${a},${b}`);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('P4: a follow followed by an unfollow of the same edge leaves no trace', async () => {
    await fc.assert(
      fc.asyncProperty(userArb, userArb, async (a, b) => {
        fc.pre(a !== b);
        const svc = new FollowService();
        await svc.follow(a, b);
        assert.equal(await svc.isFollowing(a, b), true);
        const undo = await svc.unfollow(a, b);
        assert.equal(undo.changed, true);
        assert.equal(await svc.isFollowing(a, b), false);
        assert.deepEqual(await svc.counts(b), { followers: 0, following: 0 });
      }),
      { numRuns: 100 },
    );
  });
});
