// src/store/redis.ts
// @streetjs/events — a durable, shareable EventStore backed by the core
// zero-dependency `RedisClient`. Opt-in via the `@streetjs/events/redis`
// submodule so default (Memory) users pull in no extra runtime dependency.
//
// Storage model (namespaced by `keyPrefix`, default `streetjs:events`):
//   {p}:seq     STRING  — an INCR counter giving each appended event a
//                         store-side monotonic score (authoritative order even
//                         across multiple writers / process restarts, where the
//                         per-facade envelope `seq` would collide).
//   {p}:log     ZSET    — member = the JSON-serialized EventEnvelope,
//                         score = the store-side sequence from {p}:seq.
//
// Reads pull the log in score order, parse, then filter by
// name/pattern/since/until/fromSeq in-process and sort by the envelope's own
// `seq` to honor the EventStore contract. This is an application event store,
// not a log database — for very high volumes prefer a purpose-built adapter.

import type { RespValue } from 'streetjs';
import type { EventEnvelope } from '../event.js';
import { matchesPattern } from '../matcher.js';
import type { EventStore, ReplayFilter } from './store.js';

/**
 * The subset of the core `RedisClient` surface this store needs. The core
 * `RedisClient` satisfies it, and an in-memory fake can implement it for tests.
 */
export interface RedisClientLike {
  /** Establish the connection; MUST reject if the backend is unreachable. */
  connect(): Promise<void>;
  /** Issue a RESP command; replies are multiplexed FIFO on one socket. */
  command(args: (string | number)[]): Promise<RespValue>;
  /** Release the connection. */
  close(): void | Promise<void>;
}

/** Options for {@link RedisEventStore}. */
export interface RedisEventStoreOptions {
  /** The core `RedisClient` (or a compatible client). */
  client: RedisClientLike;
  /** Key prefix namespacing all keys. Default `"streetjs:events"`. */
  keyPrefix?: string;
}

/** A durable {@link EventStore} over the core `RedisClient`. */
export class RedisEventStore implements EventStore {
  private readonly client: RedisClientLike;
  private readonly keyPrefix: string;
  private connected = false;
  private connecting?: Promise<void>;

  constructor(options: RedisEventStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'streetjs:events';
  }

  /**
   * Eagerly connect and verify reachability. Optional — `append`/`read` connect
   * lazily — but calling it lets a caller surface an unreachable backend up
   * front. Rejects if the backend cannot be reached.
   */
  async init(): Promise<void> {
    await this.ensureConnected();
    const pong = await this.client.command(['PING']);
    if (typeof pong === 'string' && pong.startsWith('ERR:')) {
      throw new Error(`RedisEventStore.init: backend rejected PING (${pong.slice(4)})`);
    }
  }

  async append(envelope: EventEnvelope): Promise<void> {
    await this.ensureConnected();
    // Store-side monotonic score: correct ordering even across writers/restarts.
    const score = asInt(await this.command(['INCR', this.seqKey()]));
    await this.command(['ZADD', this.logKey(), score, JSON.stringify(envelope)]);
  }

  async read(filter?: ReplayFilter): Promise<EventEnvelope[]> {
    await this.ensureConnected();
    const raw = asStringArray(await this.command(['ZRANGE', this.logKey(), 0, -1]));
    const parsed: EventEnvelope[] = [];
    for (const s of raw) {
      const env = safeParse<EventEnvelope>(s);
      if (env !== null && this.matches(env, filter)) {
        parsed.push(env);
      }
    }
    // Honor the contract: ascending by the envelope's own seq.
    parsed.sort((a, b) => a.seq - b.seq);
    return filter?.limit !== undefined && filter.limit >= 0
      ? parsed.slice(0, filter.limit)
      : parsed;
  }

  async count(filter?: ReplayFilter): Promise<number> {
    if (!filter) {
      await this.ensureConnected();
      return asInt(await this.command(['ZCARD', this.logKey()]));
    }
    return (await this.read(filter)).length;
  }

  async clear(): Promise<void> {
    await this.ensureConnected();
    await this.command(['DEL', this.logKey()]);
    await this.command(['DEL', this.seqKey()]);
  }

  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    return this.connected
      ? { status: 'up' }
      : { status: 'down', details: { reason: 'redis connection not established' } };
  }

  /** Close the underlying client. */
  async close(): Promise<void> {
    try {
      await this.client.close();
    } finally {
      this.connected = false;
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  private async ensureConnected(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (!this.connecting) {
      this.connecting = this.client
        .connect()
        .then(() => {
          this.connected = true;
        })
        .catch((err: unknown) => {
          this.connecting = undefined;
          throw err;
        });
    }
    await this.connecting;
  }

  /** Issue a command; a connection-level throw flips health to down and rethrows. */
  private async command(args: (string | number)[]): Promise<RespValue> {
    try {
      const reply = await this.client.command(args);
      if (typeof reply === 'string' && reply.startsWith('ERR:')) {
        throw new Error(`Redis command failed: ${reply.slice(4)}`);
      }
      return reply;
    } catch (err) {
      // Only a connection-level failure should flip health; a per-command RESP
      // error (thrown above) leaves the connection established.
      if (err instanceof Error && /not connected|ECONNRESET|EPIPE|socket/i.test(err.message)) {
        this.connected = false;
      }
      throw err;
    }
  }

  private matches(env: EventEnvelope, filter?: ReplayFilter): boolean {
    if (!filter) {
      return true;
    }
    if (filter.name !== undefined && env.name !== filter.name) return false;
    if (filter.pattern !== undefined && !matchesPattern(env.name, filter.pattern)) return false;
    if (filter.since !== undefined && env.timestamp < filter.since) return false;
    if (filter.until !== undefined && env.timestamp > filter.until) return false;
    if (filter.fromSeq !== undefined && env.seq < filter.fromSeq) return false;
    return true;
  }

  private logKey(): string {
    return `${this.keyPrefix}:log`;
  }
  private seqKey(): string {
    return `${this.keyPrefix}:seq`;
  }
}

// ── Defensive RESP parsing ─────────────────────────────────────────────────────

function asInt(reply: RespValue): number {
  if (typeof reply === 'number') return reply;
  if (typeof reply === 'string') {
    const n = Number(reply);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asStringArray(reply: RespValue): string[] {
  if (!Array.isArray(reply)) return [];
  const out: string[] = [];
  for (const el of reply) {
    if (typeof el === 'string') out.push(el);
  }
  return out;
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
