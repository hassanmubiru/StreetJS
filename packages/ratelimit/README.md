# @streetjs/ratelimit

The StreetJS rate limiter: sliding-window rate limiting as middleware, with
global / per-IP / per-user scopes, a human-readable window parser, a `@RateLimit`
method decorator, HTTP 429 responses with `Retry-After` and `X-RateLimit-*`
headers, and pluggable in-memory or Redis backing stores. ESM.

This is the standalone home of the rate limiter that also backs the
`streetjs/ratelimit` subpath. The `streetjs` framework re-exports this package,
so there is a single source of truth.

## Install

```bash
npm install @streetjs/ratelimit @streetjs/context @streetjs/store reflect-metadata
```

## Scoped middleware (recommended)

```ts
import { rateLimit } from '@streetjs/ratelimit';

// 100 requests per minute, per client IP.
router.use(rateLimit({ scope: 'ip', requests: 100, window: '1m' }));

// Per authenticated user (falls back to IP for anonymous traffic).
router.use(rateLimit({ scope: 'user', requests: 1000, window: '1h' }));

// One global bucket for the whole app.
router.use(rateLimit({ scope: 'global', requests: 10_000, window: '1m' }));
```

`window` accepts a number (ms) or a string like `"30s"`, `"1m"`, `"2h"`, `"7d"`,
`"500ms"`. On the request that would exceed the limit the middleware throws a
`RateLimitException` (HTTP 429) and sets `Retry-After`; permitted responses carry
`X-RateLimit-Limit`, `X-RateLimit-Reset`, and `X-RateLimit-Remaining`.

## Cross-instance enforcement (Redis)

```ts
import { rateLimit, RedisRateLimitStore } from '@streetjs/ratelimit';

const store = new RedisRateLimitStore(redisClient); // any { command(args) } client
router.use(rateLimit({ scope: 'ip', requests: 100, window: '1m', store }));
```

The Redis store keeps a sorted set per key (score = timestamp), trims with
`ZREMRANGEBYSCORE`, counts with `ZCARD`, and bounds memory with `PEXPIRE` —
mirroring the in-memory sliding window across instances.

## The `@RateLimit` decorator

```ts
import { RateLimit, getRateLimitMeta } from '@streetjs/ratelimit';

class AuthController {
  @RateLimit({ requests: 5, window: 60_000 })
  login(ctx) { /* ... */ }
}
```

`@RateLimit` attaches `street:rateLimit` metadata; the router reads it via
`getRateLimitMeta(target, propertyKey)` and enforces it at dispatch.

## The class-based `RateLimiter`

The original hrtime-precise limiter is kept for direct use:

```ts
import { RateLimiter } from '@streetjs/ratelimit';

const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 100, trustProxy: false });
router.use(limiter.middleware());
```

By default the client key is the direct socket address (unspoofable). Set
`trustProxy: true` **only** behind a trusted reverse proxy — the rightmost
`X-Forwarded-For` entry (appended by the proxy) is used.

## Exports

`RateLimiter`, `rateLimit`, `RateLimitException`, `RateLimit`,
`getRateLimitMeta`, `parseWindow`, `RedisRateLimitStore`, and their option types.

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/ratelimit
```

## License

MIT — see [LICENSE](./LICENSE).
