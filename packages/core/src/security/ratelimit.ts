// src/security/ratelimit.ts
// Sliding-window rate limiter using BigInt nanosecond timestamps.
// Bounded per-key request log with periodic stale-entry sweeping.

import { randomBytes } from 'node:crypto';
import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';
import { StreetException } from '../http/exceptions.js';
import {
  type Clock,
  type RateLimitStore,
  InMemoryRateLimitStore,
  systemClock,
} from './store.js';

const MAX_KEYS = 100_000;        // max distinct IPs/keys tracked
const MAX_REQUESTS_PER_KEY = 1000; // max stored timestamps per key

// Regex for a valid IPv4 or IPv6 address segment
const VALID_IP_RE = /^[\w.:[\]]+$/;

export interface RateLimiterOptions {
  windowMs: number;     // sliding window in ms
  maxRequests: number;  // max requests per window
  keyFn?: (ctx: StreetContext) => string;
  message?: string;
  /**
   * Set to true ONLY when the server sits behind a trusted reverse proxy
   * that sets X-Forwarded-For. When false (default), the direct socket
   * address is always used — it cannot be spoofed by the client.
   */
  trustProxy?: boolean;
}

export class RateLimiter {
  // Map: key -> array of nanosecond timestamps (bounded)
  private readonly store = new Map<string, bigint[]>();
  private readonly opts: Required<RateLimiterOptions>;
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(opts: RateLimiterOptions) {
    const resolvedKeyFn = opts.keyFn ?? ((ctx: StreetContext) => defaultKeyFn(ctx, opts.trustProxy ?? false));
    this.opts = {
      message: 'Too Many Requests',
      trustProxy: false,
      ...opts,
      keyFn: resolvedKeyFn,
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

      const resetSeconds = Math.ceil(this.opts.windowMs / 1000);
      ctx.setHeader('X-RateLimit-Limit', String(this.opts.maxRequests));
      ctx.setHeader('X-RateLimit-Reset', String(resetSeconds));

      if (!allowed) {
        ctx.setHeader('Retry-After', String(resetSeconds));
        ctx.setHeader('X-RateLimit-Remaining', '0');
        throw new RateLimitException(this.opts.message);
      }

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

function defaultKeyFn(ctx: StreetContext, trustProxy: boolean): string {
  // When trustProxy is false (default), always use the direct socket address.
  // It is set by the OS/kernel and cannot be forged by the HTTP client.
  if (!trustProxy) {
    return ctx.req.socket.remoteAddress ?? 'unknown';
  }

  // trustProxy=true: take the RIGHTMOST IP added by the trusted proxy.
  // The leftmost entries in X-Forwarded-For are client-supplied and can be
  // forged; the rightmost entry is appended by the proxy we trust.
  const forwarded = ctx.headers['x-forwarded-for'];
  if (forwarded) {
    const parts = forwarded.split(',');
    // Walk right-to-left to find the first valid-looking IP
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = parts[i]?.trim() ?? '';
      if (candidate && VALID_IP_RE.test(candidate)) {
        return candidate;
      }
    }
  }
  return ctx.req.socket.remoteAddress ?? 'unknown';
}

export class RateLimitException extends StreetException {
  constructor(message: string) {
    super(429, message);
    this.name = 'RateLimitException';
  }
}

// ─── @RateLimit Method Decorator ─────────────────────────────────────────────

export interface RateLimitDecoratorOptions {
  /** Maximum number of requests allowed within the window. */
  requests: number;
  /** Window duration in milliseconds. */
  window: number;
  /**
   * Optional key name used to differentiate rate-limit buckets.
   * When omitted, the router middleware defaults to the remote IP.
   */
  key?: string;
}

/**
 * Method decorator that attaches rate-limit configuration metadata to a route
 * handler.  The actual enforcement is performed by the router middleware
 * pipeline which reads the `street:rateLimit` metadata key at dispatch time.
 *
 * @example
 * ```ts
 * @RateLimit({ requests: 100, window: 60_000 })
 * @Post('/login')
 * async login(ctx: StreetContext) { ... }
 * ```
 */
export function RateLimit(opts: RateLimitDecoratorOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    Reflect.defineMetadata('street:rateLimit', opts, target, propertyKey);
  };
}

/** Retrieve the RateLimitDecoratorOptions stored by @RateLimit, or undefined. */
export function getRateLimitMeta(
  target: object,
  propertyKey: string | symbol,
): RateLimitDecoratorOptions | undefined {
  return Reflect.getMetadata('street:rateLimit', target, propertyKey) as
    | RateLimitDecoratorOptions
    | undefined;
}

// ─── Scoped rate limiting (R3.2–R3.8) ────────────────────────────────────────
//
// The class-based `RateLimiter` above remains for backward compatibility. The
// API below extends it with (a) a human-readable window parser, (b) explicit
// global / per-IP / per-user scopes, and (c) a pluggable `RateLimitStore`
// backing abstraction so counts can be enforced consistently across multiple
// application instances (the default `InMemoryRateLimitStore` keeps the original
// in-process sliding-window semantics; `RedisRateLimitStore` shares state via a
// sorted set per key). The existing sliding-window / `Retry-After` /
// `X-RateLimit-*` response behavior is preserved.

/** Multipliers from a duration unit to milliseconds. */
const WINDOW_UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

// e.g. "1m", "30s", "2h", "500ms", "1.5h", or a bare "1000" (milliseconds).
const WINDOW_RE = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/i;

/**
 * Parse a human-readable window duration into milliseconds (R3.7).
 *
 * Accepts a number (already milliseconds) or a string such as `"1m"`, `"30s"`,
 * `"2h"`, `"7d"`, or `"500ms"`. A bare numeric string (e.g. `"1000"`) is treated
 * as milliseconds. Throws on a non-positive or unparseable value.
 *
 * @example parseWindow("1m") // 60_000
 * @example parseWindow(5_000) // 5_000
 */
export function parseWindow(window: string | number): number {
  if (typeof window === 'number') {
    if (!Number.isFinite(window) || window <= 0) {
      throw new Error(`Invalid rate-limit window: ${window}`);
    }
    return Math.floor(window);
  }

  const match = WINDOW_RE.exec(window);
  if (!match) {
    throw new Error(`Invalid rate-limit window: "${window}"`);
  }
  const value = Number.parseFloat(match[1]!);
  const unit = (match[2] ?? 'ms').toLowerCase();
  const ms = value * WINDOW_UNIT_MS[unit]!;
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`Invalid rate-limit window: "${window}"`);
  }
  return Math.floor(ms);
}

/** Rate-limit scope: a single global bucket, per remote IP, or per user (R3.2). */
export type RateScope = 'global' | 'ip' | 'user';

/** Fixed key used for the single shared bucket in `scope: 'global'`. */
const GLOBAL_RATE_KEY = '__global__';

export interface ScopedRateLimitOptions {
  /** Which key dimension to throttle on (R3.2). */
  scope: RateScope;
  /** Maximum requests permitted per key within the window. */
  requests: number;
  /** Human-readable window (`"1m"`) or milliseconds (R3.7). */
  window: string | number;
  /**
   * Backing store. Defaults to a fresh {@link InMemoryRateLimitStore}; supply a
   * shared store (e.g. {@link RedisRateLimitStore}) for cross-instance
   * enforcement (R3.8).
   */
  store?: RateLimitStore;
  /**
   * Resolves the user identity for `scope: 'user'`. Defaults to the
   * authenticated `ctx.user.id`. When no user can be resolved the limiter falls
   * back to the remote IP so unauthenticated traffic is still bounded.
   */
  userKeyFn?: (ctx: StreetContext) => string | undefined;
  /** Message used for the 429 response. */
  message?: string;
  /**
   * Trust `X-Forwarded-For` for IP resolution. Only enable behind a trusted
   * reverse proxy (see {@link RateLimiterOptions.trustProxy}).
   */
  trustProxy?: boolean;
  /** Injected clock for deterministic window timing in tests. */
  clock?: Clock;
}

/** Resolve the scoped store key for a request. */
function resolveScopedKey(opts: ScopedRateLimitOptions, ctx: StreetContext): string {
  const trustProxy = opts.trustProxy ?? false;
  switch (opts.scope) {
    case 'global':
      return `global:${GLOBAL_RATE_KEY}`;
    case 'ip':
      return `ip:${defaultKeyFn(ctx, trustProxy)}`;
    case 'user': {
      const userKey = opts.userKeyFn?.(ctx) ?? ctx.user?.id;
      if (userKey !== undefined && userKey !== '') {
        return `user:${userKey}`;
      }
      // Unauthenticated: bound by IP so the bucket is still keyed and bounded.
      return `user:ip:${defaultKeyFn(ctx, trustProxy)}`;
    }
    default: {
      // Exhaustiveness guard.
      const never: never = opts.scope;
      throw new Error(`Unknown rate-limit scope: ${String(never)}`);
    }
  }
}

/**
 * Middleware factory equivalent to `rateLimit({ requests: 100, window: "1m" })`
 * (R3.7), supporting global / per-IP / per-user scopes (R3.2) over a pluggable
 * sliding-window store (R3.8).
 *
 * Behavior preserved from the original `RateLimiter`: up to `requests` calls per
 * key per window are permitted; the call that would exceed the limit is rejected
 * with HTTP 429 (R3.3) and a `Retry-After` header in seconds (R3.4); permitted
 * responses carry `X-RateLimit-Remaining` with the leftover allowance (R3.5).
 *
 * @example
 * ```ts
 * router.use(rateLimit({ scope: 'ip', requests: 100, window: '1m' }));
 * ```
 */
export function rateLimit(opts: ScopedRateLimitOptions): MiddlewareFn {
  if (!Number.isInteger(opts.requests) || opts.requests <= 0) {
    throw new Error(`rateLimit requires a positive integer "requests", got ${opts.requests}`);
  }
  const windowMs = parseWindow(opts.window);
  const store = opts.store ?? new InMemoryRateLimitStore();
  const clock = opts.clock ?? systemClock;
  const max = opts.requests;
  const message = opts.message ?? 'Too Many Requests';
  const resetSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  return async (ctx: StreetContext, next: () => Promise<void>) => {
    const key = resolveScopedKey(opts, ctx);
    const now = clock();

    ctx.setHeader('X-RateLimit-Limit', String(max));
    ctx.setHeader('X-RateLimit-Reset', String(resetSeconds));

    // Peek at the current window count without recording. Recording only on
    // acceptance preserves the original limiter's behavior (rejected requests
    // do not extend the window).
    const current = await store.count(key, now, windowMs);
    if (current >= max) {
      ctx.setHeader('Retry-After', String(resetSeconds));
      ctx.setHeader('X-RateLimit-Remaining', '0');
      throw new RateLimitException(message);
    }

    const count = await store.hit(key, now, windowMs);
    ctx.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));

    await next();
  };
}

// ─── RedisRateLimitStore (cross-instance enforcement, R3.8) ───────────────────

/**
 * Minimal Redis client surface needed by {@link RedisRateLimitStore}. Satisfied
 * by the core `RedisClient` (`packages/core/src/transports/resp.ts`) and by any
 * client exposing a raw `command(args)` method.
 */
export interface RedisLike {
  command(args: (string | number)[]): Promise<unknown>;
}

export interface RedisRateLimitStoreOptions {
  /** Prefix applied to every Redis key (defaults to `"ratelimit:"`). */
  keyPrefix?: string;
}

/**
 * {@link RateLimitStore} backed by a Redis sorted set per key, enabling
 * consistent enforcement across multiple application instances (R3.8).
 *
 * Each request is stored as a sorted-set member scored by its millisecond
 * timestamp. The window is evaluated by trimming members older than
 * `nowMs - windowMs` with `ZREMRANGEBYSCORE` and counting the remainder with
 * `ZCARD`, mirroring the in-memory sliding window. A `PEXPIRE` bounds memory for
 * idle keys. Members are made unique with a random suffix so concurrent hits at
 * the same millisecond are not deduplicated.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: RedisLike;
  private readonly keyPrefix: string;

  constructor(redis: RedisLike, opts: RedisRateLimitStoreOptions = {}) {
    this.redis = redis;
    this.keyPrefix = opts.keyPrefix ?? 'ratelimit:';
  }

  private redisKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /** Trim members strictly older than the window's cutoff. */
  private async trim(redisKey: string, cutoff: number): Promise<void> {
    // `(cutoff` makes the upper bound exclusive, keeping scores >= cutoff,
    // matching the in-memory store (`t >= nowMs - windowMs`).
    await this.redis.command(['ZREMRANGEBYSCORE', redisKey, '-inf', `(${cutoff}`]);
  }

  private async cardinality(redisKey: string): Promise<number> {
    const card = await this.redis.command(['ZCARD', redisKey]);
    return typeof card === 'number' ? card : Number(card ?? 0);
  }

  async hit(key: string, nowMs: number, windowMs: number): Promise<number> {
    const redisKey = this.redisKey(key);
    const cutoff = nowMs - windowMs;
    await this.trim(redisKey, cutoff);
    const member = `${nowMs}-${randomBytes(8).toString('hex')}`;
    await this.redis.command(['ZADD', redisKey, nowMs, member]);
    // Bound memory for idle keys; the window can never outlive `windowMs`.
    await this.redis.command(['PEXPIRE', redisKey, Math.max(1, Math.ceil(windowMs))]);
    return this.cardinality(redisKey);
  }

  async count(key: string, nowMs: number, windowMs: number): Promise<number> {
    const redisKey = this.redisKey(key);
    const cutoff = nowMs - windowMs;
    await this.trim(redisKey, cutoff);
    return this.cardinality(redisKey);
  }
}
