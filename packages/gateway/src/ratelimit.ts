/**
 * @streetjs/gateway — deterministic, scoped rate limiter.
 *
 * A per-key token-bucket limiter that refills `limit` tokens once every
 * `windowMs` window. All time is read through an injected {@link Clock}, so the
 * limiter is fully deterministic under test — nothing here touches the wall
 * clock. The bucket for a key is (re)filled to `limit` the first time it is
 * observed at/after a full window has elapsed since its window opened, then a
 * single token is consumed per {@link RateLimiter.check} call.
 *
 * Self-contained by design: streetjs core ships a general-purpose rate limiter,
 * but the gateway intentionally keeps this structural, injectable limiter so it
 * works out of the box without wiring to the core primitive. Callers that want
 * to reuse the core limiter can swap this out — the {@link RateLimiter.check}
 * result shape is the only contract the pipeline depends on.
 *
 * The limiter NEVER throws: {@link RateLimiter.check} returns an `allowed` flag
 * with the `remaining` budget and, when denied, a positive `retryAfterMs`. The
 * caller is responsible for raising {@link RateLimitExceededError} when
 * `allowed` is false.
 */

import { systemClock, type Clock } from "streetjs";

import type { GatewayRequest, Identity, RateLimitPolicy, RateLimitScope } from "./types.js";

/** The outcome of a single limiter consultation. */
export interface RateLimitResult {
  /** Whether this request may proceed (a token was consumed). */
  readonly allowed: boolean;
  /** Tokens left in the current window after this call (never negative). */
  readonly remaining: number;
  /** When denied, ms until the window refills; 0 when allowed. Always >= 0. */
  readonly retryAfterMs: number;
}

/** Options accepted by {@link RateLimiter}. */
export interface RateLimiterOptions {
  /** The rate-limit policy (scope, limit, window). */
  readonly policy: RateLimitPolicy;
  /** Injected now-provider; defaults to {@link systemClock}. */
  readonly clock?: Clock;
}

/** Mutable per-key token-bucket bookkeeping. */
interface Bucket {
  /** Tokens remaining in the current window. */
  tokens: number;
  /** Clock timestamp (ms) at which the current window opened. */
  windowStart: number;
}

/**
 * Read a single header value, collapsing the array form to its first element.
 * Returns `undefined` when the header is absent or an empty array.
 */
function headerValue(request: GatewayRequest, name: string): string | undefined {
  const raw = request.headers[name];
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw[0] : undefined;
  }
  return raw;
}

/**
 * Resolve the bucket key for `policy`'s scope against a request/identity.
 *
 * Pure and side-effect free so it can be unit-tested in isolation:
 *  - `global`  → the constant `"global"`.
 *  - `ip`      → `request.ip`, falling back to `"unknown"`.
 *  - `user`    → `identity.subject`, falling back to `"anonymous"`.
 *  - `api-key` → the `x-api-key` header, falling back to `"anonymous"`.
 */
export function keyFor(
  policy: RateLimitPolicy,
  request: GatewayRequest,
  identity?: Identity | null,
): string {
  const scope: RateLimitScope = policy.scope;
  switch (scope) {
    case "global":
      return "global";
    case "ip":
      return request.ip ?? "unknown";
    case "user":
      return identity?.subject ?? "anonymous";
    case "api-key":
      return headerValue(request, "x-api-key") ?? "anonymous";
    default: {
      // Exhaustiveness guard: a new scope must be handled explicitly.
      const _never: never = scope;
      return _never;
    }
  }
}

/**
 * A deterministic, per-key token-bucket rate limiter.
 *
 * One instance guards a single policy; the policy's {@link RateLimitScope}
 * decides how {@link RateLimiter.check} derives the bucket key, so distinct
 * IPs / users / api-keys each get an independent budget.
 */
export class RateLimiter {
  private readonly policy: RateLimitPolicy;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: Clock;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: RateLimiterOptions) {
    const { policy, clock } = options;
    this.policy = policy;
    // Clamp to sane bounds: a non-negative budget and a strictly positive
    // window (so a denied result always yields a positive retryAfterMs).
    this.limit = Math.max(0, Math.trunc(policy.limit));
    this.windowMs = Math.max(1, Math.trunc(policy.windowMs));
    this.clock = clock ?? systemClock;
  }

  /** The resolved bucket key for a request under this limiter's policy. */
  keyOf(request: GatewayRequest, identity?: Identity | null): string {
    return keyFor(this.policy, request, identity);
  }

  /**
   * Consume one token for the request's resolved key.
   *
   * Refills the bucket to `limit` when a full window has elapsed since it
   * opened, then either grants (allowed, one token consumed) or denies the
   * request. Never throws; on denial returns a positive `retryAfterMs`.
   */
  check(request: GatewayRequest, identity?: Identity | null): RateLimitResult {
    const key = keyFor(this.policy, request, identity);
    const now = this.clock();

    let bucket = this.buckets.get(key);
    if (bucket === undefined) {
      bucket = { tokens: this.limit, windowStart: now };
      this.buckets.set(key, bucket);
    } else if (now - bucket.windowStart >= this.windowMs) {
      // A full window has elapsed: open a fresh window with a full budget.
      bucket.tokens = this.limit;
      bucket.windowStart = now;
    }

    if (bucket.tokens > 0) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: bucket.tokens, retryAfterMs: 0 };
    }

    // Exhausted: report the time remaining until this window refills.
    const retryAfterMs = bucket.windowStart + this.windowMs - now;
    return { allowed: false, remaining: 0, retryAfterMs };
  }
}
