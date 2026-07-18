// src/cache.ts
// Read-through cache with per-entry TTL, persisted via an OfflineStore.

import { MemoryOfflineStore } from './store.js';
import type { Clock, OfflineStore } from './types.js';

interface CacheEnvelope<T> {
  value: T;
  /** ms epoch when the entry expires; omitted = never. */
  expiresAt?: number;
}

const KEY_PREFIX = 'cache:';

export interface OfflineCacheOptions {
  store?: OfflineStore;
  clock?: Clock;
  /** Default TTL (ms) applied when a per-call ttl isn't given. */
  defaultTtlMs?: number;
}

/**
 * A read-through cache. `get(key, fetcher)` returns a fresh cached value when
 * present, otherwise calls `fetcher`, stores the result, and returns it. When
 * `fetcher` throws (e.g. offline) but a **stale** entry exists, the stale value
 * is returned so the UI still has data — offline-first behavior.
 */
export class OfflineCache {
  private readonly store: OfflineStore;
  private readonly clock: Clock;
  private readonly defaultTtlMs: number | undefined;

  constructor(options: OfflineCacheOptions = {}) {
    this.store = options.store ?? new MemoryOfflineStore();
    this.clock = options.clock ?? (() => Date.now());
    this.defaultTtlMs = options.defaultTtlMs;
  }

  private key(key: string): string {
    return `${KEY_PREFIX}${key}`;
  }

  /** Read a cached value (ignoring staleness → returns undefined when expired). */
  async peek<T>(key: string): Promise<T | undefined> {
    const env = await this.read<T>(key);
    if (!env) return undefined;
    if (env.expiresAt !== undefined && env.expiresAt <= this.clock()) return undefined;
    return env.value;
  }

  /** Store a value with an optional TTL (falls back to the default TTL). */
  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const env: CacheEnvelope<T> = { value };
    if (ttl !== undefined) env.expiresAt = this.clock() + ttl;
    await this.store.set(this.key(key), JSON.stringify(env));
  }

  /** Remove a cache entry. */
  async invalidate(key: string): Promise<void> {
    await this.store.delete(this.key(key));
  }

  /**
   * Return a fresh cached value, or fetch → cache → return. If the fetch fails
   * and a stale entry exists, the stale value is returned (offline-first).
   */
  async get<T>(key: string, fetcher: () => Promise<T>, ttlMs?: number): Promise<T> {
    const fresh = await this.peek<T>(key);
    if (fresh !== undefined) return fresh;

    try {
      const value = await fetcher();
      await this.set(key, value, ttlMs);
      return value;
    } catch (err) {
      const stale = await this.read<T>(key);
      if (stale) return stale.value;
      throw err;
    }
  }

  private async read<T>(key: string): Promise<CacheEnvelope<T> | undefined> {
    const raw = await this.store.get(this.key(key));
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as CacheEnvelope<T>;
    } catch {
      return undefined;
    }
  }
}
