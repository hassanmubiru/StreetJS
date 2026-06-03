// src/security/ratelimit.ts
// Sliding-window rate limiter using BigInt nanosecond timestamps.
// Bounded per-key request log with periodic stale-entry sweeping.

import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';
import { StreetException } from '../http/exceptions.js';

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
