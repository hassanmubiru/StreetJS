// src/cache/lru.ts
// LRU cache with TTL, bounded entry count, and periodic sweep.

export interface LruOptions {
  maxEntries: number;
  ttlMs: number;
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
  private head: CacheEntry<V> | null = null; // most recently used
  private tail: CacheEntry<V> | null = null; // least recently used
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(options: LruOptions) {
    if (options.maxEntries < 1) throw new Error('maxEntries must be >= 1');
    this.maxEntries = options.maxEntries;
    this.ttlMs = options.ttlMs;

    this.sweepTimer = setInterval(() => this._sweepExpired(), Math.min(this.ttlMs / 2, 60_000));
    this.sweepTimer.unref();
  }

  get(key: K): V | undefined {
    const strKey = String(key);
    const entry = this.map.get(strKey);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this._remove(entry);
      return undefined;
    }

    // Move to head (most recently used)
    this._moveToHead(entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const strKey = String(key);
    const existing = this.map.get(strKey);

    if (existing) {
      existing.value = value;
      existing.expiresAt = Date.now() + this.ttlMs;
      this._moveToHead(existing);
      return;
    }

    const entry: CacheEntry<V> = {
      key: strKey,
      value,
      expiresAt: Date.now() + this.ttlMs,
      prev: null,
      next: this.head,
    };

    this.map.set(strKey, entry);
    if (this.head) this.head.prev = entry;
    this.head = entry;
    if (!this.tail) this.tail = entry;

    // Evict LRU if over limit
    if (this.map.size > this.maxEntries) {
      this._evictTail();
    }
  }

  delete(key: K): boolean {
    const strKey = String(key);
    const entry = this.map.get(strKey);
    if (!entry) return false;
    this._remove(entry);
    return true;
  }

  has(key: K): boolean {
    const strKey = String(key);
    const entry = this.map.get(strKey);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
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

  get size(): number { return this.map.size; }

  private _moveToHead(entry: CacheEntry<V>): void {
    if (entry === this.head) return;
    this._detach(entry);
    entry.next = this.head;
    entry.prev = null;
    if (this.head) this.head.prev = entry;
    this.head = entry;
    if (!this.tail) this.tail = entry;
  }

  private _evictTail(): void {
    if (!this.tail) return;
    this._remove(this.tail);
  }

  private _remove(entry: CacheEntry<V>): void {
    this._detach(entry);
    this.map.delete(entry.key);
  }

  private _detach(entry: CacheEntry<V>): void {
    if (entry.prev) entry.prev.next = entry.next;
    else this.head = entry.next;
    if (entry.next) entry.next.prev = entry.prev;
    else this.tail = entry.prev;
    entry.prev = null;
    entry.next = null;
  }

  private _sweepExpired(): void {
    const now = Date.now();
    for (const [, entry] of this.map) {
      if (now > entry.expiresAt) {
        this._remove(entry);
      }
    }
  }

  destroy(): void {
    clearInterval(this.sweepTimer);
    this.clear();
  }
}
