// src/types.ts
// Contracts for offline cache + mutation outbox.

/** A now-provider clock in milliseconds. Inject for deterministic tests. */
export type Clock = () => number;

/**
 * Pluggable key/value persistence for the cache and outbox. A synchronous or
 * asynchronous implementation both satisfy this (methods return promises).
 * The default is in-memory; apps wrap `localStorage`/IndexedDB/AsyncStorage.
 */
export interface OfflineStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** A queued mutation to replay against the server when online. */
export interface Mutation {
  /** Stable client-generated id (also used for de-duplication). */
  id: string;
  /** Operation name the sender switches on, e.g. 'createPost'. */
  op: string;
  /** Operation payload. */
  payload: unknown;
  /** ms timestamp when it was enqueued. */
  createdAt: number;
  /** Delivery attempts so far. */
  attempts: number;
}

/** Outcome of attempting to send one mutation. */
export type SendOutcome =
  | { status: 'ok' }
  /** Transient failure — keep it queued and retry later. */
  | { status: 'retry'; error?: string }
  /** Permanent failure — drop it from the outbox (e.g. a 4xx). */
  | { status: 'drop'; error?: string };

/** Sends a single mutation to the server. */
export type MutationSender = (mutation: Mutation) => Promise<SendOutcome>;

/** Result of a flush pass over the outbox. */
export interface FlushResult {
  sent: number;
  dropped: number;
  /** Mutations still queued (transient failures) after this pass. */
  remaining: number;
}
