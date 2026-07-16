/**
 * @streetjs/ratelimit — the StreetJS rate limiter.
 *
 * Sliding-window rate limiting as StreetJS middleware: the class-based
 * `RateLimiter` (hrtime-precise, per-key bounded log), the scoped `rateLimit`
 * factory (global / per-IP / per-user over a pluggable `RateLimitStore`), a
 * `@RateLimit` method decorator, a human-readable `parseWindow`, and a
 * Redis-backed store for cross-instance enforcement. Emits HTTP 429 with
 * `Retry-After` and `X-RateLimit-*` headers. Public API only.
 *
 * ```ts
 * import { rateLimit } from '@streetjs/ratelimit';
 * router.use(rateLimit({ scope: 'ip', requests: 100, window: '1m' }));
 * ```
 *
 * > This is the standalone home of the rate limiter that also backs the
 * > `streetjs/ratelimit` subpath; the `streetjs` framework re-exports it, so
 * > there is a single implementation.
 */

export {
  RateLimiter,
  RateLimitException,
  RateLimit,
  getRateLimitMeta,
  rateLimit,
  parseWindow,
  RedisRateLimitStore,
} from './ratelimit.js';
export type {
  RateLimiterOptions,
  RateLimitDecoratorOptions,
  RateScope,
  ScopedRateLimitOptions,
  RedisLike,
  RedisRateLimitStoreOptions,
} from './ratelimit.js';
