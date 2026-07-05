// packages/dating-messaging/src/tests/block-prevents-messaging-pbt.test.ts
// Property-based test for the @streetjs/dating-messaging layer (Phase 10, R11).
//
// Feature: consumer-platform-security, Property 18 — Block prevents messaging.
// Validates: Requirements 8.3, 11.5
//
// Property 18 (design): "For any pair of users, while a block relationship from
// user A to user B exists, user B is unable to send messages to user A; absent
// such a block, messaging is permitted. This invariant holds both in the
// Moderation_Toolkit and in the @streetjs/dating-messaging layer that composes
// it."
//
// This file exercises that invariant at the messaging layer. To isolate the
// block gate from the orthogonal matching gate (R11.3), every generated user is
// mutually matched with every other up front, so `NOT_MATCHED` can never
// confound the result. We then apply an arbitrary set of directional blocks and
// assert, across every ordered pair of distinct users, that:
//
//   * delivery is permitted  <=>  no block exists between the two users; and
//   * delivery is refused with reason 'BLOCKED'  <=>  a block exists between
//     them in either direction (composing the toolkit's R8.3 guarantee, which
//     makes `canMessage(B, A)` false while an A->B block exists).
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// property is checked across many generated inputs (fast-check, >=100 runs).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fc from 'fast-check';
import { FieldCipher, Keyring, ModerationToolkit } from 'streetjs';
import { ProfileService } from '@streetjs/dating-profiles';
import { MessageService, InMemoryMessageStore } from '../index.js';
const NUM_RUNS = 200;
// Small, fixed user-id space so blocks collide with message pairs often.
const USERS = ['u0', 'u1', 'u2', 'u3', 'u4'];
const userArb = fc.constantFrom(...USERS);
// A directional block "a blocks b" (a !== b). Self-blocks are filtered out.
const blockArb = fc
    .record({ a: userArb, b: userArb })
    .filter(({ a, b }) => a !== b);
const blocksArb = fc.array(blockArb, { maxLength: 12 });
const bodyArb = fc.string({ maxLength: 24 });
function newCipher() {
    return new FieldCipher(Keyring.fromKey(randomBytes(32)));
}
/** Stable directional key for a block relationship. */
function blockKey(a, b) {
    return `${a}\u0000${b}`;
}
/**
 * Build a service in which every user in {@link USERS} is mutually matched with
 * every other (so the matching gate is always open) and the supplied directional
 * blocks have been applied to the moderation toolkit.
 */
async function buildScenario(blocks) {
    const cipher = newCipher();
    const profiles = new ProfileService({ cipher: newCipher() });
    const moderation = new ModerationToolkit();
    for (const u of USERS) {
        await profiles.create({ userId: u, displayName: u.toUpperCase(), bio: `bio-${u}` });
    }
    // Mutually match every distinct pair via reciprocal likes (R11.3 gate open).
    for (let i = 0; i < USERS.length; i++) {
        for (let j = i + 1; j < USERS.length; j++) {
            await profiles.like(USERS[i], USERS[j]);
            await profiles.like(USERS[j], USERS[i]);
        }
    }
    for (const { a, b } of blocks) {
        await moderation.block(a, b);
    }
    const service = new MessageService(profiles, moderation, cipher, {
        store: new InMemoryMessageStore(),
    });
    return { service };
}
// Feature: consumer-platform-security, Property 18: Block prevents messaging
// Validates: Requirements 8.3, 11.5
describe('Property 18: block prevents messaging (dating-messaging layer)', () => {
    it('permits messaging iff no block exists between the pair, and refuses with BLOCKED while one does (R8.3, R11.5)', async () => {
        await fc.assert(fc.asyncProperty(blocksArb, bodyArb, async (blocks, body) => {
            const { service } = await buildScenario(blocks);
            // Model of the directional block relationships actually applied.
            const blocked = new Set();
            for (const { a, b } of blocks)
                blocked.add(blockKey(a, b));
            for (const from of USERS) {
                for (const to of USERS) {
                    if (from === to)
                        continue;
                    // A block in EITHER direction between the two users must prevent
                    // delivery (the impl composes canMessage(from,to) && canMessage(to,from)).
                    const hasBlock = blocked.has(blockKey(from, to)) || blocked.has(blockKey(to, from));
                    const result = await service.send(from, to, body);
                    if (hasBlock) {
                        assert.equal(result.delivered, false, `expected ${from}->${to} to be refused while a block exists`);
                        assert.equal(result.reason, 'BLOCKED', `expected ${from}->${to} refusal reason to be BLOCKED`);
                        assert.equal(result.message, undefined, 'blocked send must not produce a message');
                    }
                    else {
                        // Matched and unblocked: messaging is permitted.
                        assert.equal(result.delivered, true, `expected ${from}->${to} to be permitted absent any block`);
                        assert.equal(result.reason, undefined);
                        assert.ok(result.message, 'permitted send must produce a stored message');
                    }
                }
            }
        }), { numRuns: NUM_RUNS });
    });
    it('directional statement: while an A->B block exists, B cannot message A (R8.3, R11.5)', async () => {
        await fc.assert(fc.asyncProperty(blockArb, bodyArb, async ({ a, b }, body) => {
            const { service } = await buildScenario([{ a, b }]);
            // A has blocked B: B is unable to send messages to A.
            const bToA = await service.send(b, a, body);
            assert.equal(bToA.delivered, false);
            assert.equal(bToA.reason, 'BLOCKED');
        }), { numRuns: NUM_RUNS });
    });
    it('absent any block, matched users may message each other (R11.5 negative case)', async () => {
        await fc.assert(fc.asyncProperty(userArb, userArb, bodyArb, async (from, to, body) => {
            fc.pre(from !== to);
            const { service } = await buildScenario([]); // no blocks applied
            const result = await service.send(from, to, body);
            assert.equal(result.delivered, true);
            assert.equal(result.reason, undefined);
        }), { numRuns: NUM_RUNS });
    });
});
//# sourceMappingURL=block-prevents-messaging-pbt.test.js.map