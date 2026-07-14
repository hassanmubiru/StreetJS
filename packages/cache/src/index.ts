/**
 * @streetjs/cache — the StreetJS in-memory cache foundation.
 *
 * A bounded LRU cache with per-entry TTL and periodic sweep. Zero runtime
 * dependencies. Public API only.
 *
 * ```ts
 * import { LruCache } from '@streetjs/cache';
 *
 * const cache = new LruCache<string, User>({ maxEntries: 1000, ttlMs: 60_000 });
 * cache.set('u:7', user);
 * cache.get('u:7');   // User | undefined
 * cache.has('u:7');
 * cache.delete('u:7');
 * cache.destroy();    // stop the sweep timer on shutdown
 * ```
 */

export { LruCache, type LruOptions } from './lru.js';

/**
 * Dependency-injection token for a cache instance. `@streetjs/cache` depends on
 * no container, so the token is a plain unique symbol.
 */
export const CACHE: unique symbol = Symbol.for('@streetjs/cache:Cache');
