# Architecture — @streetjs/ratelimit

## Purpose

`@streetjs/ratelimit` provides StreetJS request throttling: it turns rate-limit
policy into `MiddlewareFn`s that the router runs, emitting standard 429 +
`Retry-After` / `X-RateLimit-*` responses. It is a direct prerequisite of the
router (which reads `@RateLimit` metadata and mounts limiter middleware).

## Dependencies

```
node:crypto          (randomBytes — unique Redis members)
@streetjs/context    (StreetContext + MiddlewareFn)
@streetjs/exceptions (StreetException — base of RateLimitException)
@streetjs/store      (RateLimitStore + InMemoryRateLimitStore + Clock)
reflect-metadata     (@RateLimit decorator metadata)
```

No cyclic dependencies — every dependency is lower in the graph.

## Two limiter APIs

### `RateLimiter` (class, hrtime-based)

The original limiter, kept for backward compatibility. It stores nanosecond
`process.hrtime.bigint()` timestamps per key in a bounded `Map`, prunes expired
entries on each check, sweeps stale keys on a half-window unref'd timer, and
bounds memory with `MAX_KEYS` (oldest-key eviction) and `MAX_REQUESTS_PER_KEY`.
Its `middleware()` sets the `X-RateLimit-*` headers and throws
`RateLimitException` when the limit is exceeded.

### `rateLimit` (scoped factory)

The recommended API. It parses the window (`parseWindow`), resolves a **scope**
key (`global` / `ip` / `user`, with an IP fallback for anonymous users), and
delegates counting to a pluggable `RateLimitStore` (default
`InMemoryRateLimitStore`). It **peeks** the window count before recording so a
rejected request never extends the window — preserving the class limiter's
semantics — and accepts an injected `clock` for deterministic tests.

## Key resolution & proxy trust

`defaultKeyFn` uses the direct socket address by default (set by the kernel,
unspoofable). With `trustProxy: true` it takes the **rightmost** valid
`X-Forwarded-For` entry (the one appended by the trusted proxy), ignoring
client-forged leftmost entries, and falls back to the socket address when none is
valid.

## `parseWindow`

Accepts a number (ms) or a trimmed string matched by a linear, ReDoS-safe regex
(`ms`/`s`/`m`/`h`/`d`, or a bare number as ms), rejecting non-positive or
unparseable values.

## `RedisRateLimitStore`

Implements `RateLimitStore` over a minimal `{ command(args) }` client using a
sorted set per key: `ZREMRANGEBYSCORE` trims the window (exclusive lower bound to
match `t >= now - window`), `ZADD` records a uniquely-suffixed member, `PEXPIRE`
bounds idle memory, and `ZCARD` counts — coercing non-numeric replies.

## Testing

Runs with **no server or Redis** using a fake `StreetContext` (capturing
headers), an injected clock, and a fake `{ command }` Redis. It covers
`parseWindow`, the class limiter (limit/headers/429, per-key isolation, proxy
trust, custom keyFn/message, sweep, expiry pruning), the scoped factory (all
three scopes, custom `userKeyFn`, validation, window recovery, unknown-scope
guard), the `@RateLimit` decorator round-trip, and the Redis store's command
sequence. Coverage is ≥99% lines/functions and ≥92% branches (declared floor
88%; the `MAX_KEYS` eviction branch is defensive and left documented).

## Non-goals

- No distributed token-bucket or leaky-bucket algorithms — sliding window only.
- No storage implementation beyond in-memory and Redis (both via `@streetjs/store`
  contracts / the local Redis store).
