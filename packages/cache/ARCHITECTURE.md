# @streetjs/cache — Architecture

## Goals

- A single, generic in-memory cache foundation for StreetJS packages and apps.
- Zero runtime dependencies (Node.js core only).
- O(1) operations; predictable bounded memory; lazy + proactive expiry.
- Strongly typed; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  lru.ts     LruCache + LruOptions (the implementation).
  index.ts   Curated public API + CACHE DI token.
```

## Data structure

A `Map<string, CacheEntry>` provides O(1) key lookup; an intrusive doubly-linked list
(`head` = most-recently-used, `tail` = least-recently-used) provides O(1) recency updates
and eviction. Each entry stores its `value`, `expiresAt`, `key`, and `prev`/`next`
pointers. `get`/`set` move the touched entry to the head; exceeding `maxEntries` removes
the tail.

## Expiry

Each entry expires `ttlMs` after its last write. Expiry is enforced two ways:

- **Lazy** — `get`/`has` check `clock() > expiresAt` and purge on access, so callers never
  see stale values.
- **Proactive** — an optional `setInterval` sweep (period `min(ttlMs/2, 60s)`) removes
  expired entries so memory is reclaimed even without access. The timer is `unref`'d, so
  it never keeps the process alive, and `destroy()` clears it.

The clock is injectable (`clock: () => number`, default `Date.now`) so TTL behavior is
fully deterministic in tests.

## Relationship to `streetjs` core

This package is the single source of truth for the LRU cache. The `streetjs` framework
depends on `@streetjs/cache` and re-exports `LruCache`/`LruOptions` from its
`streetjs/cache` subpath (dependency inversion), so the implementation is never
duplicated and the framework's public subpath is preserved. To keep the framework build
order correct, `streetjs`'s `prebuild` compiles this package first.

## Testing

`node --test` with an injected clock: store/retrieve, missing keys, `maxEntries`
validation, LRU eviction (with recency refresh), TTL expiry on `get`/`has`, update
refreshing value/TTL/recency, delete/clear, key coercion, the background sweep, and
`destroy`. Coverage is enforced at ≥90% (`c8 check-coverage`).
