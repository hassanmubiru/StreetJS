import { FieldCipher, ModerationToolkit, type EncryptedField } from 'streetjs';
import { ProfileService } from '@streetjs/dating-profiles';
/**
 * A stored message. The `body` is held as an {@link EncryptedField} so the
 * plaintext is never persisted in the clear (R11.3, via the core FieldCipher).
 */
export interface Message {
    id: string;
    from: string;
    to: string;
    /** Encrypted message content. Decrypt with {@link MessageService.readBody}. */
    body: EncryptedField<string>;
    /** Epoch milliseconds at which the message was accepted for delivery. */
    createdAt: number;
}
/** Why a {@link MessageService.send} attempt was refused. */
export type SendRefusalReason = 
/** The two users are not mutually matched (R11.3). */
'NOT_MATCHED'
/** A block relationship exists between the two users (R11.5). */
 | 'BLOCKED';
/** Result of {@link MessageService.send}. */
export interface SendResult {
    /** True iff the message was accepted and stored for delivery. */
    delivered: boolean;
    /** Populated only when `delivered` is false, explaining the refusal. */
    reason?: SendRefusalReason;
    /** The stored message, present only when `delivered` is true. */
    message?: Message;
}
/**
 * Pluggable persistence for accepted (encrypted) messages. The default
 * {@link InMemoryMessageStore} is suitable for tests and single-instance use; a
 * shared store can be supplied for multi-instance deployments.
 */
export interface MessageStore {
    /** Persist an accepted message. */
    add(message: Message): Promise<void>;
    /** All messages exchanged between two users, in insertion order. */
    conversation(a: string, b: string): Promise<Message[]>;
}
/** Default in-process {@link MessageStore}. */
export declare class InMemoryMessageStore implements MessageStore {
    private readonly messages;
    add(message: Message): Promise<void>;
    conversation(a: string, b: string): Promise<Message[]>;
}
/** Options for {@link MessageService}. */
export interface MessageServiceOptions {
    /** Persistence backend. Defaults to {@link InMemoryMessageStore}. */
    store?: MessageStore;
    /** Clock injection for deterministic timestamps in tests. */
    now?: () => number;
    /** Id generator for stored messages. Defaults to a random hex id. */
    idFactory?: () => string;
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
export declare class MessageService {
    private readonly profiles;
    private readonly moderation;
    private readonly cipher;
    private readonly store;
    private readonly now;
    private readonly idFactory;
    /**
     * @param profiles   Source of truth for whether two users are matched.
     * @param moderation Source of truth for block relationships.
     * @param cipher     Field cipher used to encrypt message bodies at rest.
     * @param options    Optional storage, clock, and id-generation overrides.
     */
    constructor(profiles: ProfileService, moderation: ModerationToolkit, cipher: FieldCipher, options?: MessageServiceOptions);
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
    send(from: string, to: string, body: string): Promise<SendResult>;
    /** Decrypt and return the plaintext body of a stored message (authorized read). */
    readBody(message: Message): string;
    /** All messages exchanged between two users (order-independent), in order. */
    conversation(a: string, b: string): Promise<Message[]>;
}
export type { EncryptedField } from 'streetjs';
export { FieldCipher, ModerationToolkit, Keyring } from 'streetjs';
export { ProfileService } from '@streetjs/dating-profiles';
//# sourceMappingURL=index.d.ts.map