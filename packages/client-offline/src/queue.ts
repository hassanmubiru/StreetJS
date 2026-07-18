// src/queue.ts
// Persistent, ordered mutation outbox: enqueue while offline, flush when online.

import { MemoryOfflineStore } from './store.js';
import type { Clock, FlushResult, Mutation, MutationSender, OfflineStore } from './types.js';

const OUTBOX_KEY = 'outbox:mutations';

export interface MutationQueueOptions {
  store?: OfflineStore;
  clock?: Clock;
  /** Max delivery attempts before a mutation is dropped. Default 8. */
  maxAttempts?: number;
  /** Invoked whenever a mutation is permanently dropped (retry-exhausted or 'drop'). */
  onDrop?: (mutation: Mutation, reason: string) => void;
}

/**
 * A durable, FIFO outbox of pending mutations. `enqueue` appends (de-duplicating
 * by id) and persists; `flush(sender)` replays queued mutations **in order**,
 * stopping the pass at the first transient failure so ordering is preserved,
 * and dropping mutations that permanently fail or exceed `maxAttempts`.
 */
export class MutationQueue {
  private readonly store: OfflineStore;
  private readonly clock: Clock;
  private readonly maxAttempts: number;
  private readonly onDrop: ((mutation: Mutation, reason: string) => void) | undefined;
  private flushing = false;

  constructor(options: MutationQueueOptions = {}) {
    this.store = options.store ?? new MemoryOfflineStore();
    this.clock = options.clock ?? (() => Date.now());
    this.maxAttempts = options.maxAttempts ?? 8;
    this.onDrop = options.onDrop;
  }

  private async read(): Promise<Mutation[]> {
    const raw = await this.store.get(OUTBOX_KEY);
    if (raw === undefined) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Mutation[]) : [];
    } catch {
      return [];
    }
  }

  private async write(mutations: Mutation[]): Promise<void> {
    await this.store.set(OUTBOX_KEY, JSON.stringify(mutations));
  }

  /** Enqueue a mutation. Returns the stored mutation. Idempotent by `id`. */
  async enqueue(input: { id: string; op: string; payload: unknown }): Promise<Mutation> {
    const list = await this.read();
    const existing = list.find((m) => m.id === input.id);
    if (existing) return existing;
    const mutation: Mutation = {
      id: input.id,
      op: input.op,
      payload: input.payload,
      createdAt: this.clock(),
      attempts: 0,
    };
    list.push(mutation);
    await this.write(list);
    return mutation;
  }

  /** Pending mutations, oldest first. */
  async list(): Promise<Mutation[]> {
    return this.read();
  }

  /** Number of queued mutations. */
  async size(): Promise<number> {
    return (await this.read()).length;
  }

  /** Remove all queued mutations. */
  async clear(): Promise<void> {
    await this.store.delete(OUTBOX_KEY);
  }

  /**
   * Replay the outbox against `sender`, in order. Stops at the first `retry`
   * (transient) failure to preserve ordering; `ok`/`drop` results (and
   * attempt-exhaustion) remove the mutation. Re-entrancy is guarded so
   * concurrent flushes don't double-send.
   */
  async flush(sender: MutationSender): Promise<FlushResult> {
    if (this.flushing) return { sent: 0, dropped: 0, remaining: await this.size() };
    this.flushing = true;
    try {
      let list = await this.read();
      let sent = 0;
      let dropped = 0;

      while (list.length > 0) {
        const mutation = list[0]!;
        mutation.attempts += 1;
        let outcome;
        try {
          outcome = await sender(mutation);
        } catch (err) {
          outcome = { status: 'retry' as const, error: err instanceof Error ? err.message : String(err) };
        }

        if (outcome.status === 'ok') {
          list.shift();
          sent++;
        } else if (outcome.status === 'drop') {
          list.shift();
          dropped++;
          this.onDrop?.(mutation, outcome.error ?? 'dropped by sender');
        } else {
          // retry: exhausted attempts → drop; otherwise stop the pass (keep order).
          if (mutation.attempts >= this.maxAttempts) {
            list.shift();
            dropped++;
            this.onDrop?.(mutation, outcome.error ?? 'max attempts exceeded');
          } else {
            await this.write(list); // persist the incremented attempt count
            break;
          }
        }
        await this.write(list);
      }

      return { sent, dropped, remaining: list.length };
    } finally {
      this.flushing = false;
    }
  }
}
