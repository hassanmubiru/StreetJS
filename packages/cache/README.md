# @streetjs/cache

The in-memory cache foundation for StreetJS: a **bounded LRU cache with per-entry TTL**,
O(1) operations, and a periodic sweep of expired entries.

**Zero runtime dependencies.** Built on Node.js core only, matching the StreetJS minimal,
carefully curated dependency footprint. Generic and reusable by any application.

```bash
npm install @streetjs/cache
```

> This is the standalone home of the LRU cache that also backs `streetjs/cache`; the
> `streetjs` framework re-exports it, so there is a single implementation.

## Quick start

```ts
import { LruCache } from '@streetjs/cache';

const cache = new LruCache<string, User>({ maxEntries: 1000, ttlMs: 60_000 });

cache.set('u:7', user);
cache.get('u:7');     // User | undefined (refreshes recency)
cache.has('u:7');     // boolean (purges if expired)
cache.delete('u:7');
cache.size;           // number of stored entries
cache.clear();
cache.destroy();      // stop the background sweep on shutdown
```

## Behavior

- **Bounded** — once `maxEntries` is exceeded, the least-recently-used entry is evicted.
  `get` and `set` (on an existing key) refresh recency.
- **TTL** — each entry expires `ttlMs` after its last write. Expiry is applied lazily on
  `get`/`has` and proactively by a background sweep.
- **O(1)** — a `Map` plus an intrusive doubly-linked list give constant-time
  `get`/`set`/`delete`/`has`.
- **Keys** — any key is coerced to a string, so `1` and `'1'` address the same entry.

## Options

```ts
new LruCache({
  maxEntries: 1000,   // required, >= 1
  ttlMs: 60_000,      // required
  autoSweep: true,    // default true; the sweep timer is unref'd (won't hold the process open)
  clock: () => Date.now(), // injectable time source for deterministic tests
});
```

Set `autoSweep: false` (and rely on lazy expiry) for short-lived caches or tests; pass a
custom `clock` to advance time deterministically.

## Dependency injection

Depends on no container. Exports a `CACHE` token (a global `Symbol`) for interface-first
wiring:

```ts
import { CACHE, LruCache } from '@streetjs/cache';
container.register(CACHE, new LruCache({ maxEntries: 500, ttlMs: 30_000 }));
```

## Public API

`LruCache` · `LruOptions` · `CACHE` token.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design notes, and
`src/examples/integration.ts` for a runnable read-through-cache example.

## License

MIT © street contributors
