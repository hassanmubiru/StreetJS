// src/tests/sim-redis.ts
// A tiny in-memory RedisClientLike implementing exactly the command surface the
// RedisEventStore issues (PING, INCR, ZADD, ZRANGE, ZCARD, DEL). Test-only; no
// real Redis, no socket. ZSETs order ascending by score with an insertion-order
// tie-break (deterministic, matching how the store reads back in append order
// for equal scores — which cannot happen here since scores come from INCR).

import type { RespValue } from 'streetjs';
import type { RedisClientLike } from '../store/redis.js';

interface ZEntry {
  member: string;
  score: number;
  ins: number; // insertion order (tie-break)
}

export class SimRedis implements RedisClientLike {
  private readonly strings = new Map<string, string>();
  private readonly zsets = new Map<string, ZEntry[]>();
  private connected = false;
  private ins = 0;

  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }

  close(): void {
    this.connected = false;
  }

  command(args: (string | number)[]): Promise<RespValue> {
    if (!this.connected) {
      return Promise.reject(new Error('SimRedis not connected'));
    }
    return Promise.resolve(this.exec(args));
  }

  private exec(args: (string | number)[]): RespValue {
    const op = String(args[0]).toUpperCase();
    switch (op) {
      case 'PING':
        return 'PONG';
      case 'INCR': {
        const key = String(args[1]);
        const next = (Number(this.strings.get(key) ?? '0') || 0) + 1;
        this.strings.set(key, String(next));
        return next;
      }
      case 'ZADD': {
        const key = String(args[1]);
        const score = Number(args[2]);
        const member = String(args[3]);
        let z = this.zsets.get(key);
        if (!z) {
          z = [];
          this.zsets.set(key, z);
        }
        const existing = z.find((e) => e.member === member);
        if (existing) {
          existing.score = score;
          return 0;
        }
        z.push({ member, score, ins: this.ins++ });
        return 1;
      }
      case 'ZRANGE': {
        const key = String(args[1]);
        const z = [...(this.zsets.get(key) ?? [])].sort((a, b) =>
          a.score !== b.score ? a.score - b.score : a.ins - b.ins,
        );
        // Only the `key 0 -1` form is used by the store.
        return z.map((e) => e.member);
      }
      case 'ZCARD':
        return this.zsets.get(String(args[1]))?.length ?? 0;
      case 'DEL': {
        const key = String(args[1]);
        const had = this.strings.delete(key);
        const hadZ = this.zsets.delete(key);
        return had || hadZ ? 1 : 0;
      }
      default:
        return `ERR:unsupported command ${op}`;
    }
  }
}
