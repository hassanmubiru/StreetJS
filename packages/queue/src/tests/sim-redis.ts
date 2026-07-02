// src/tests/sim-redis.ts
// An in-memory simulated Redis implementing `RedisClientLike`, used solely by
// the driver-interchangeability property test (task 15.2 / Property 8). It backs
// the real `RedisDriver` with a faithful in-process model of the exact RESP
// command surface the driver issues — NO real Redis, NO socket.
//
// Supported commands (exactly the forms `RedisDriver` emits):
//   PING
//   SADD key member            SMEMBERS key
//   SET key value              GET key                DEL key
//   ZADD key score member      ZREM key member        ZCARD key
//   ZRANGE key start stop      ZRANGEBYSCORE key min max
//   RPUSH key value            LRANGE key start stop
//   LREM key count value       LLEN key
//
// Semantics model Redis: ZSETs are ordered ascending by score with a
// lexicographic member tie-break (Redis's documented ordering for equal
// scores); LISTs are ordered by insertion; STRINGs and SETs behave as expected.
// Replies are RESP-shaped: integers for counts, `string[]` for ranges,
// `string | null` for GET, and the status strings `"OK"` / `"PONG"`.
//
// This is TEST CODE. It never touches `src/` and imports only the public
// `RedisClientLike` shape it must satisfy.

import type { RespValue } from 'streetjs';
import type { RedisClientLike } from '../drivers/redis.js';

/** A single sorted-set entry: a member string with its numeric score. */
interface ZEntry {
  member: string;
  score: number;
}

/** Coerce a RESP argument (which may arrive as a number) to a string key/member. */
function toStr(v: string | number): string {
  return typeof v === 'string' ? v : String(v);
}

/**
 * Parse a ZSET score/bound argument. Supports Redis's `-inf`/`+inf` sentinels
 * (used by `ZRANGEBYSCORE key -inf now`) and plain numerics.
 */
function parseScore(v: string | number): number {
  if (typeof v === 'number') {
    return v;
  }
  const lower = v.toLowerCase();
  if (lower === '-inf' || lower === '-infinity') {
    return Number.NEGATIVE_INFINITY;
  }
  if (lower === '+inf' || lower === 'inf' || lower === 'infinity') {
    return Number.POSITIVE_INFINITY;
  }
  return Number(v);
}

/**
 * Normalize Redis-style [start, stop] indices (supporting negatives counting
 * from the end and clamping) into a concrete inclusive slice range, or null if
 * the range is empty.
 */
function normalizeRange(start: number, stop: number, len: number): [number, number] | null {
  let s = start < 0 ? Math.max(len + start, 0) : start;
  let e = stop < 0 ? len + stop : Math.min(stop, len - 1);
  if (s >= len || s > e || len === 0) {
    return null;
  }
  if (s < 0) {
    s = 0;
  }
  if (e < 0) {
    return null;
  }
  return [s, e];
}

/**
 * In-memory `RedisClientLike`. One instance models one logical Redis keyspace;
 * give each driver-under-test its own instance for an isolated store.
 */
export class SimulatedRedis implements RedisClientLike {
  private readonly strings = new Map<string, string>();
  private readonly zsets = new Map<string, ZEntry[]>();
  private readonly lists = new Map<string, string[]>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly subscribers = new Map<string, Set<(message: string) => void>>();
  private connected = false;

  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  close(): void {
    this.connected = false;
  }

  publish(channel: string, message: string): Promise<void> {
    const subs = this.subscribers.get(channel);
    if (subs) {
      for (const handler of subs) {
        handler(message);
      }
    }
    return Promise.resolve();
  }

  subscribe(channel: string, handler: (message: string) => void): Promise<() => void> {
    let subs = this.subscribers.get(channel);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(channel, subs);
    }
    subs.add(handler);
    return Promise.resolve(() => {
      subs?.delete(handler);
    });
  }

  command(args: (string | number)[]): Promise<RespValue> {
    if (!this.connected) {
      // Model the core client throwing when its socket is gone (connection-level).
      return Promise.reject(new Error('SimulatedRedis not connected'));
    }
    return Promise.resolve(this.exec(args));
  }

  // ── Command dispatch ────────────────────────────────────────────────────────

  private exec(args: (string | number)[]): RespValue {
    const op = toStr(args[0]!).toUpperCase();
    switch (op) {
      case 'PING':
        return 'PONG';
      case 'SADD':
        return this.sadd(toStr(args[1]!), toStr(args[2]!));
      case 'SMEMBERS':
        return this.smembers(toStr(args[1]!));
      case 'SET':
        this.strings.set(toStr(args[1]!), toStr(args[2]!));
        return 'OK';
      case 'GET': {
        const v = this.strings.get(toStr(args[1]!));
        return v === undefined ? null : v;
      }
      case 'DEL':
        return this.del(toStr(args[1]!));
      case 'ZADD':
        return this.zadd(toStr(args[1]!), parseScore(args[2]!), toStr(args[3]!));
      case 'ZREM':
        return this.zrem(toStr(args[1]!), toStr(args[2]!));
      case 'ZCARD':
        return this.zsets.get(toStr(args[1]!))?.length ?? 0;
      case 'ZRANGE':
        return this.zrange(toStr(args[1]!), Number(args[2]), Number(args[3]));
      case 'ZRANGEBYSCORE':
        return this.zrangebyscore(toStr(args[1]!), parseScore(args[2]!), parseScore(args[3]!));
      case 'RPUSH':
        return this.rpush(toStr(args[1]!), toStr(args[2]!));
      case 'LRANGE':
        return this.lrange(toStr(args[1]!), Number(args[2]), Number(args[3]));
      case 'LREM':
        return this.lrem(toStr(args[1]!), toStr(args[3]!));
      case 'LLEN':
        return this.lists.get(toStr(args[1]!))?.length ?? 0;
      default:
        // Any command the driver does not use is a programming error in the test.
        return `ERR:unsupported command ${op}`;
    }
  }

  // ── SET type ─────────────────────────────────────────────────────────────────

  private sadd(key: string, member: string): number {
    let set = this.sets.get(key);
    if (!set) {
      set = new Set();
      this.sets.set(key, set);
    }
    if (set.has(member)) {
      return 0;
    }
    set.add(member);
    return 1;
  }

  private smembers(key: string): string[] {
    return [...(this.sets.get(key) ?? [])];
  }

  private del(key: string): number {
    let removed = 0;
    if (this.strings.delete(key)) {
      removed = 1;
    }
    if (this.zsets.delete(key)) {
      removed = 1;
    }
    if (this.lists.delete(key)) {
      removed = 1;
    }
    if (this.sets.delete(key)) {
      removed = 1;
    }
    return removed;
  }

  // ── ZSET type ─────────────────────────────────────────────────────────────────

  /** Ascending by score, lexicographic member tie-break (Redis ordering). */
  private sortedZ(key: string): ZEntry[] {
    const z = this.zsets.get(key);
    if (!z) {
      return [];
    }
    return [...z].sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      return a.member < b.member ? -1 : a.member > b.member ? 1 : 0;
    });
  }

  private zadd(key: string, score: number, member: string): number {
    let z = this.zsets.get(key);
    if (!z) {
      z = [];
      this.zsets.set(key, z);
    }
    const existing = z.find((e) => e.member === member);
    if (existing) {
      existing.score = score; // update score; not counted as an add
      return 0;
    }
    z.push({ member, score });
    return 1;
  }

  private zrem(key: string, member: string): number {
    const z = this.zsets.get(key);
    if (!z) {
      return 0;
    }
    const i = z.findIndex((e) => e.member === member);
    if (i === -1) {
      return 0;
    }
    z.splice(i, 1);
    return 1;
  }

  private zrange(key: string, start: number, stop: number): string[] {
    const sorted = this.sortedZ(key);
    const range = normalizeRange(start, stop, sorted.length);
    if (range === null) {
      return [];
    }
    return sorted.slice(range[0], range[1] + 1).map((e) => e.member);
  }

  private zrangebyscore(key: string, min: number, max: number): string[] {
    return this.sortedZ(key)
      .filter((e) => e.score >= min && e.score <= max)
      .map((e) => e.member);
  }

  // ── LIST type ─────────────────────────────────────────────────────────────────

  private rpush(key: string, value: string): number {
    let list = this.lists.get(key);
    if (!list) {
      list = [];
      this.lists.set(key, list);
    }
    list.push(value);
    return list.length;
  }

  private lrange(key: string, start: number, stop: number): string[] {
    const list = this.lists.get(key) ?? [];
    const range = normalizeRange(start, stop, list.length);
    if (range === null) {
      return [];
    }
    return list.slice(range[0], range[1] + 1);
  }

  /** `LREM key 0 value`: remove ALL occurrences equal to `value`; return count. */
  private lrem(key: string, value: string): number {
    const list = this.lists.get(key);
    if (!list) {
      return 0;
    }
    let removed = 0;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i] === value) {
        list.splice(i, 1);
        removed += 1;
      }
    }
    return removed;
  }
}
