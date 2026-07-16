// src/security/ratelimit.ts
// Sliding-window rate limiter.
//
// The implementation now lives in the standalone `@streetjs/ratelimit` package
// (built on @streetjs/context + @streetjs/exceptions + @streetjs/store). This
// module re-exports it verbatim so every internal importer and the public
// `streetjs`/`streetjs/ratelimit` API keep working against a single source of
// truth — no duplication, no shim.

export {
  RateLimiter,
  RateLimitException,
  RateLimit,
  getRateLimitMeta,
  rateLimit,
  parseWindow,
  RedisRateLimitStore,
} from '@streetjs/ratelimit';
export type {
  RateLimiterOptions,
  RateLimitDecoratorOptions,
  RateScope,
  ScopedRateLimitOptions,
  RedisLike,
  RedisRateLimitStoreOptions,
} from '@streetjs/ratelimit';
