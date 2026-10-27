/**
 * A bounded LRU cache with per-entry TTL.
 * CONSOLIDATED: implementation copied from @streetjs/cache (single source of truth)
 *
 * - O(1) `get`/`set`/`delete`/`has` via a `Map` + intrusive doubly-linked list.
 * - Least-recently-used eviction once `maxEntries` is exceeded.
 * - Lazy expiry on access plus an optional periodic background sweep.
 *
 * Zero dependencies (Node.js core only).
 */

/** Options for {@link LruCache}. */
export interface LruOptions {
  /** Maximum number of live entries before LRU eviction. Must be >= 1. */
  maxEntries: number;
  /** Time-to-live for each entry, in milliseconds. */
  ttlMs: number;
  /**
   * Run a periodic background sweep of expired entries. Default `true`. The
   * sweep timer is unref'd so it never keeps the process alive.
   */
  autoSweep?: boolean;
  /** Injectable clock returning epoch ms (default `Date.now`), for deterministic tests. */
  clock?: () => number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
  key: string;
  prev: CacheEntry<V> | null;
  next: CacheEntry<V> | null;
}

export class LruCache<K = string, V = unknown> {
  private readonly map = new Map<string, CacheEntry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly clock: () => number;
  private head: CacheEntry<V> | null = null;
  private tail: CacheEntry<V> | null = null;
  private readonly sweepTimer?: NodeJS.Timeout;

  constructor(options: LruOptions) {
    if (options.maxEntries < 1) {
      throw new Error('maxEntries must be >= 1');
    }
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;
    this.clock = options.clock ?? Date.now;

    if (options.autoSweep !== false) {
      this.sweepTimer = setInterval(() => this._sweepExpired(), Math.min(this.ttlMs / 2, 60_000));
      if (typeof (this.sweepTimer as { unref?: () => void }).unref === 'function') {
        (this.sweepTimer as { unref: () => void }).unref();
      }
    }
  }

  get(key: K): V | undefined {
    const strKey = String(key);
    const entry = this.map.get(strKey);
    if (!entry) {
      return undefined;
    }
    if (this.clock() > entry.expiresAt) {
      this._remove(entry);
      return undefined;
    }
    this._moveToHead(entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const strKey = String(key);
    const existing = this.map.get(strKey);

    if (existing) {
      existing.value = value;
      existing.expiresAt = this.clock() + this.ttlMs;
      this._moveToHead(existing);
      return;
    }

    const entry: CacheEntry<V> = {
      key: strKey,
      value,
      expiresAt: this.clock() + this.ttlMs,
      prev: null,
      next: this.head,
    };

    this.map.set(strKey, entry);
    if (this.head) {
      this.head.prev = entry;
    }
    this.head = entry;
    if (!this.tail) {
      this.tail = entry;
    }

    if (this.map.size > this.maxEntries) {
      this._evictTail();
    }
  }

  delete(key: K): boolean {
    const entry = this.map.get(String(key));
    if (!entry) {
      return false;
    }
    this._remove(entry);
    return true;
  }

  has(key: K): boolean {
    const entry = this.map.get(String(key));
    if (!entry) {
      return false;
    }
    if (this.clock() > entry.expiresAt) {
      this._remove(entry);
      return false;
    }
    return true;
  }

  clear(): void {
    this.map.clear();
    this.head = null;
    this.tail = null;
  }

  get size(): number {
    return this.map.size;
  }

  private _moveToHead(entry: CacheEntry<V>): void {
    if (entry === this.head) {
      return;
    }
    this._detach(entry);
    entry.next = this.head;
    entry.prev = null;
    if (this.head) {
      this.head.prev = entry;
    }
    this.head = entry;
    if (!this.tail) {
      this.tail = entry;
    }
  }

  private _evictTail(): void {
    if (this.tail) {
      this._remove(this.tail);
    }
  }

  private _remove(entry: CacheEntry<V>): void {
    this._detach(entry);
    this.map.delete(entry.key);
  }

  private _detach(entry: CacheEntry<V>): void {
    if (entry.prev) {
      entry.prev.next = entry.next;
    } else {
      this.head = entry.next;
    }
    if (entry.next) {
      entry.next.prev = entry.prev;
    } else {
      this.tail = entry.prev;
    }
    entry.prev = null;
    entry.next = null;
  }

  private _sweepExpired(): void {
    const now = this.clock();
    for (const [, entry] of this.map) {
      if (now > entry.expiresAt) {
        this._remove(entry);
      }
    }
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
    this.clear();
  }
}
