// packages/dating-messaging/src/tests/message-service.test.ts
// Example/edge-case unit tests for MessageService (R11.3, R11.5, R11.6).
//
// The universal block-prevents-messaging property (Property 18) lives in its
// own *-pbt.test.ts file (task 16.2) per the design; these tests cover concrete
// behaviors: match-gated delivery, encrypted bodies, block refusal in either
// direction, and input validation.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { FieldCipher, Keyring, ModerationToolkit, isEncryptedField } from '@streetjs/core';
import { ProfileService } from '@streetjs/dating-profiles';
import { MessageService, InMemoryMessageStore } from '../index.js';
function newCipher() {
    return new FieldCipher(Keyring.fromKey(randomBytes(32)));
}
/** Build a service with two matched users `a` and `b`. */
async function matchedService(now) {
    const cipher = newCipher();
    const profiles = new ProfileService({ cipher: newCipher() });
    const moderation = new ModerationToolkit();
    await profiles.create({ userId: 'a', displayName: 'A', bio: 'x' });
    await profiles.create({ userId: 'b', displayName: 'B', bio: 'y' });
    await profiles.like('a', 'b');
    await profiles.like('b', 'a'); // reciprocal -> matched
    const service = new MessageService(profiles, moderation, cipher, {
        store: new InMemoryMessageStore(),
        now,
    });
    return { service, profiles, moderation };
}
describe('MessageService.send — matching gate (R11.3)', () => {
    it('delivers a message between matched users and stores the body encrypted', async () => {
        const { service } = await matchedService(() => 1000);
        const result = await service.send('a', 'b', 'hello there');
        assert.equal(result.delivered, true);
        assert.equal(result.reason, undefined);
        assert.ok(result.message, 'a stored message is returned on delivery');
        assert.equal(result.message.from, 'a');
        assert.equal(result.message.to, 'b');
        assert.equal(result.message.createdAt, 1000);
        assert.ok(isEncryptedField(result.message.body), 'body is an EncryptedField');
        assert.ok(!JSON.stringify(result.message.body).includes('hello there'));
    });
    it('round-trips the body for an authorized read', async () => {
        const { service } = await matchedService();
        const { message } = await service.send('a', 'b', 'secret message');
        assert.equal(service.readBody(message), 'secret message');
    });
    it('refuses messaging between users who are not matched and stores nothing', async () => {
        const cipher = newCipher();
        const profiles = new ProfileService({ cipher: newCipher() });
        const moderation = new ModerationToolkit();
        const store = new InMemoryMessageStore();
        const service = new MessageService(profiles, moderation, cipher, { store });
        // a likes b but b has not liked back: not matched.
        await profiles.create({ userId: 'a', displayName: 'A', bio: 'x' });
        await profiles.create({ userId: 'b', displayName: 'B', bio: 'y' });
        await profiles.like('a', 'b');
        const result = await service.send('a', 'b', 'hi');
        assert.equal(result.delivered, false);
        assert.equal(result.reason, 'NOT_MATCHED');
        assert.equal((await store.conversation('a', 'b')).length, 0);
    });
});
describe('MessageService.send — block gate (R11.5)', () => {
    it('refuses messaging when the recipient has blocked the sender, even if matched', async () => {
        const { service, moderation } = await matchedService();
        await moderation.block('b', 'a'); // b blocks a
        const result = await service.send('a', 'b', 'hi');
        assert.equal(result.delivered, false);
        assert.equal(result.reason, 'BLOCKED');
    });
    it('refuses messaging in the other direction too (block is between the two users)', async () => {
        const { service, moderation } = await matchedService();
        await moderation.block('a', 'b'); // a blocks b
        // b -> a refused because a blocked b (canMessage(b,a) === false)...
        assert.equal((await service.send('b', 'a', 'hi')).reason, 'BLOCKED');
        // ...and a -> b refused too because a block exists between the two users (R11.5).
        assert.equal((await service.send('a', 'b', 'hi')).reason, 'BLOCKED');
    });
    it('does not persist a blocked message', async () => {
        const { service, moderation } = await matchedService();
        const store = service.store;
        await moderation.block('b', 'a');
        await service.send('a', 'b', 'hi');
        assert.equal((await store.conversation('a', 'b')).length, 0);
    });
});
describe('MessageService — conversation and validation', () => {
    it('returns the conversation order-independently', async () => {
        const { service } = await matchedService(() => 1);
        await service.send('a', 'b', 'one');
        await service.send('b', 'a', 'two');
        const ab = await service.conversation('a', 'b');
        const ba = await service.conversation('b', 'a');
        assert.equal(ab.length, 2);
        assert.equal(ba.length, 2);
        assert.deepEqual(ab.map((m) => service.readBody(m)), ['one', 'two']);
    });
    it('rejects self-messaging', async () => {
        const { service } = await matchedService();
        await assert.rejects(() => service.send('a', 'a', 'hi'));
    });
    it('rejects invalid inputs', async () => {
        const { service } = await matchedService();
        await assert.rejects(() => service.send('', 'b', 'hi'));
        // @ts-expect-error body must be a string
        await assert.rejects(() => service.send('a', 'b', 123));
    });
    it('validates constructor dependencies', async () => {
        const cipher = newCipher();
        const profiles = new ProfileService({ cipher: newCipher() });
        const moderation = new ModerationToolkit();
        // @ts-expect-error profiles must be a ProfileService
        assert.throws(() => new MessageService({}, moderation, cipher));
        // @ts-expect-error moderation must be a ModerationToolkit
        assert.throws(() => new MessageService(profiles, {}, cipher));
        // @ts-expect-error cipher must be a FieldCipher
        assert.throws(() => new MessageService(profiles, moderation, {}));
    });
});
//# sourceMappingURL=message-service.test.js.map