// packages/dating-messaging/src/index.ts
// @streetjs/dating-messaging — Phase 10 dating reference package (R11.3/R11.5).
//
// This package wires together two existing building blocks instead of
// reinventing them:
//
//   * `@streetjs/dating-profiles` — supplies match state. Messaging is only
//     permitted between users who are mutually matched (R11.3).
//   * `@streetjs/core` — supplies the cryptographic and moderation primitives:
//       - `FieldCipher`/`EncryptedField` encrypt message bodies at rest so the
//         plaintext is never stored in the clear (R11.3, composing Phase 5/R6).
//       - `ModerationToolkit` owns the block relationship; messaging is refused
//         while a block exists between the two users (R11.5, composing R8.3).
//
// The package adds no independent matching, crypto, or block logic — every such
// decision is delegated to the composed primitives, so their proven guarantees
// hold here unchanged. Storage of the resulting (encrypted) messages is
// pluggable through `MessageStore`; an in-memory implementation ships for
// tests, examples, and single-instance deployments.
import { FieldCipher, ModerationToolkit, } from '@streetjs/core';
import { ProfileService } from '@streetjs/dating-profiles';
/** Default in-process {@link MessageStore}. */
export class InMemoryMessageStore {
    messages = [];
    async add(message) {
        this.messages.push(message);
    }
    async conversation(a, b) {
        return this.messages.filter((m) => (m.from === a && m.to === b) || (m.from === b && m.to === a));
    }
}
/**
 * Messaging between matched users with encrypted bodies, refusing delivery
 * while a block exists (R11.3/R11.5).
 *
 * Per the design, the service composes a {@link ProfileService} (match state), a
 * {@link ModerationToolkit} (block state), and a {@link FieldCipher} (body
 * encryption). All authorization and cryptography is delegated to those
 * primitives.
 */
export class MessageService {
    profiles;
    moderation;
    cipher;
    store;
    now;
    idFactory;
    /**
     * @param profiles   Source of truth for whether two users are matched.
     * @param moderation Source of truth for block relationships.
     * @param cipher     Field cipher used to encrypt message bodies at rest.
     * @param options    Optional storage, clock, and id-generation overrides.
     */
    constructor(profiles, moderation, cipher, options = {}) {
        if (!(profiles instanceof ProfileService)) {
            throw new Error('MessageService: a ProfileService is required for match checks');
        }
        if (!(moderation instanceof ModerationToolkit)) {
            throw new Error('MessageService: a ModerationToolkit is required for block checks');
        }
        if (!(cipher instanceof FieldCipher)) {
            throw new Error('MessageService: a FieldCipher is required to encrypt message bodies');
        }
        this.profiles = profiles;
        this.moderation = moderation;
        this.cipher = cipher;
        this.store = options.store ?? new InMemoryMessageStore();
        this.now = options.now ?? (() => Date.now());
        this.idFactory = options.idFactory ?? defaultIdFactory;
    }
    /**
     * Send a message from `from` to `to` (R11.3/R11.5). The message is accepted
     * and stored (with an encrypted body) only when **both** conditions hold:
     *
     *   1. the two users are mutually matched ({@link ProfileService.isMatch}); and
     *   2. no block relationship exists between them in either direction
     *      ({@link ModerationToolkit.canMessage}).
     *
     * Otherwise the message is refused, nothing is persisted, and a structured
     * `reason` is returned. The block check is evaluated last so an existing block
     * always wins (`reason: 'BLOCKED'`), matching the block-prevents-messaging
     * invariant (Property 18).
     */
    async send(from, to, body) {
        const fromId = requireId(from, 'from');
        const toId = requireId(to, 'to');
        if (fromId === toId) {
            throw new Error('MessageService.send: a user cannot message themselves');
        }
        if (typeof body !== 'string') {
            throw new Error('MessageService.send: body must be a string');
        }
        // (1) Messaging is only permitted between mutually matched users (R11.3).
        if (!(await this.profiles.isMatch(fromId, toId))) {
            return { delivered: false, reason: 'NOT_MATCHED' };
        }
        // (2) Refuse while a block exists between the two users, in either
        //     direction (R11.5, composing the toolkit's R8.3 guarantee). A block
        //     always prevents delivery even between matched users.
        const blocked = !(await this.moderation.canMessage(fromId, toId)) ||
            !(await this.moderation.canMessage(toId, fromId));
        if (blocked) {
            return { delivered: false, reason: 'BLOCKED' };
        }
        const message = {
            id: this.idFactory(),
            from: fromId,
            to: toId,
            body: this.cipher.encrypt(body),
            createdAt: this.now(),
        };
        await this.store.add(message);
        return { delivered: true, message };
    }
    /** Decrypt and return the plaintext body of a stored message (authorized read). */
    readBody(message) {
        return this.cipher.decrypt(message.body);
    }
    /** All messages exchanged between two users (order-independent), in order. */
    async conversation(a, b) {
        return this.store.conversation(requireId(a, 'a'), requireId(b, 'b'));
    }
}
export { FieldCipher, ModerationToolkit, Keyring } from '@streetjs/core';
export { ProfileService } from '@streetjs/dating-profiles';
function requireId(value, field) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`MessageService: ${field} must be a non-empty string`);
    }
    return value;
}
function defaultIdFactory() {
    // 16 random bytes hex — collision-resistant for message ids without pulling
    // in a uuid dependency.
    const bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i++)
        bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
//# sourceMappingURL=index.js.map