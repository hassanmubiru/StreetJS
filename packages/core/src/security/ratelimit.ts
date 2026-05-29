// src/security/ratelimit.ts
// Sliding-window rate limiter using BigInt nanosecond timestamps.
// Bounded per-key request log with periodic stale-entry sweeping.

import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';
import { StreetException } from '../http/exceptions.js';

const MAX_KEYS = 100_000;        // max distinct IPs/keys tracked
const MAX_REQUESTS_PER_KEY = 1000; // max stored timestamps per key

export interface RateLimiterOptions {
  windowMs: number;     // sliding window in ms
  maxRequests: number;  // max requests per window
  keyFn?: (ctx: StreetContext) => string;
  message?: string;
}

export class RateLimiter {
  // Map: key -> array of nanosecond timestamps (bounded)
  private readonly store = new Map<string, bigint[]>();
  private readonly opts: Required<RateLimiterOptions>;
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(opts: RateLimiterOptions) {
    this.opts = {
      keyFn: defaultKeyFn,
      message: 'Too Many Requests',
      ...opts,
    };

    // Sweep stale keys every half-window
    const sweepInterval = Math.max(opts.windowMs / 2, 5_000);
    this.sweepTimer = setInterval(() => this._sweep(), sweepInterval);
    this.sweepTimer.unref();
  }

  middleware(): MiddlewareFn {
    return async (ctx: StreetContext, next: () => Promise<void>) => {
      const key = this.opts.keyFn(ctx);
      const allowed = this._check(key);

      if (!allowed) {
        throw new RateLimitException(this.opts.message);
      }

      ctx.setHeader('X-RateLimit-Limit', String(this.opts.maxRequests));
      const remaining = this._remaining(key);
      ctx.setHeader('X-RateLimit-Remaining', String(remaining));

      await next();
    };
  }

  private _check(key: string): boolean {
    const nowNs = process.hrtime.bigint();
    const windowNs = BigInt(this.opts.windowMs) * 1_000_000n;
    const cutoff = nowNs - windowNs;

    let timestamps = this.store.get(key);
    if (!timestamps) {
      if (this.store.size >= MAX_KEYS) {
        // Evict oldest key when at capacity
        const firstKey = this.store.keys().next().value;
        if (firstKey !== undefined) this.store.delete(firstKey);
      }
      timestamps = [];
      this.store.set(key, timestamps);
    }

    // Remove expired entries
    let start = 0;
    while (start < timestamps.length && timestamps[start]! < cutoff) start++;
    if (start > 0) timestamps.splice(0, start);

    if (timestamps.length >= this.opts.maxRequests) return false;

    // Enforce bounded per-key storage
    if (timestamps.length >= MAX_REQUESTS_PER_KEY) return false;

    timestamps.push(nowNs);
    return true;
  }

  private _remaining(key: string): number {
    const nowNs = process.hrtime.bigint();
    const windowNs = BigInt(this.opts.windowMs) * 1_000_000n;
    const cutoff = nowNs - windowNs;
    const timestamps = this.store.get(key) ?? [];
    const active = timestamps.filter((t) => t >= cutoff).length;
    return Math.max(0, this.opts.maxRequests - active);
  }

  private _sweep(): void {
    const nowNs = process.hrtime.bigint();
    const windowNs = BigInt(this.opts.windowMs) * 1_000_000n;
    const cutoff = nowNs - windowNs;

    for (const [key, timestamps] of this.store.entries()) {
      const filtered = timestamps.filter((t) => t >= cutoff);
      if (filtered.length === 0) {
        this.store.delete(key);
      } else {
        this.store.set(key, filtered);
      }
    }
  }

  destroy(): void {
    clearInterval(this.sweepTimer);
    this.store.clear();
  }
}

function defaultKeyFn(ctx: StreetContext): string {
  const forwarded = ctx.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? 'unknown';
  return ctx.req.socket.remoteAddress ?? 'unknown';
}

export class RateLimitException extends StreetException {
  constructor(message: string) {
    super(429, message);
    this.name = 'RateLimitException';
  }
}
