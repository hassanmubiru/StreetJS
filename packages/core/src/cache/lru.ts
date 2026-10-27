// src/cache/lru.ts
// A bounded LRU cache with per-entry TTL.
// CONSOLIDATED: implementation copied from @streetjs/cache (single source of truth)

/**
 * A bounded LRU cache with per-entry TTL.
 *
 * - O(1) `get`/`set`/`delete`/`has` via a `Map` + intrusive doubly-linked list.
 * - Least-recently-used eviction once `maxEntries` is exceeded.
 * - Lazy expiry on access plus an optional periodic background sweep.
 *
 * Zero dependencies (Node.js core only).
 */
export interface LruOptions<T> {
  /** Maximum entries before LRU eviction. Default 1000. */
  maxEntries?: number;
  /** Per-entry TTL in ms. Default no expiry. */
  ttlMs?: number;
  /** Background sweep interval in ms. Default 60000. Pass 0 to disable. */
  sweepIntervalMs?: number;
  /** Called when an entry is evicted. */
  onEvict?: (key: string, value: T) => void;
}

interface LruEntry<T> {
  value: T;
  expiresAt: number | undefined;
  prev: LruEntry<T> | undefined;
  next: LruEntry<T> | undefined;
}

export class LruCache<T> {
  private readonly maxEntries: number;
  private readonly ttlMs: number | undefined;
  private readonly onEvict: ((key: string, value: T) => void) | undefined;
  private readonly map = new Map<string, LruEntry<T>>();
  private head: LruEntry<T> | undefined;
  private tail: LruEntry<T> | undefined;
  private readonly sweepTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: LruOptions<T> = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.ttlMs = options.ttlMs;
    this.onEvict = options.onEvict;
    const interval = options.sweepIntervalMs ?? 60_000;
    if (interval > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), interval);
      if (this.sweepTimer.unref) this.sweepTimer.unref();
    }
  }

  set(key: string, value: T): void {
    let entry = this.map.get(key);
    if (entry) {
      entry.value = value;
      entry.expiresAt = this.ttlMs !== undefined ? Date.now() + this.ttlMs : undefined;
      this.moveToHead(entry);
    } else {
      entry = {
        value,
        expiresAt: this.ttlMs !== undefined ? Date.now() + this.ttlMs : undefined,
        prev: undefined,
        next: this.head,
      };
      this.map.set(key, entry);
      this.pushHead(entry);
      if (this.map.size > this.maxEntries) {
        const removed = this.popTail();
        if (removed) {
          this.map.delete(removed.key);
          this.onEvict?.(removed.key, removed.value);
        }
      }
    }
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.delete(key);
      return undefined;
    }
    this.moveToHead(entry);
    return entry.value;
  }

  has(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    this.removeEntry(entry);
    this.map.delete(key);
    return true;
  }

  clear(): void {
    this.map.clear();
    this.head = undefined;
    this.tail = undefined;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.delete(key);
      }
    }
  }

  private moveToHead(entry: LruEntry<T>): void {
    if (entry === this.head) return;
    this.removeEntry(entry);
    this.pushHead(entry);
  }

  private pushHead(entry: LruEntry<T>): void {
    entry.next = this.head;
    entry.prev = undefined;
    this.head!.prev = entry;
    this.head = entry;
    if (!this.tail) this.tail = entry;
  }

  private popTail(): { key: string; value: T } | undefined {
    if (!this.tail) return undefined;
    const entry = this.tail;
    this.removeEntry(entry);
    if (!this.map.delete(entry.key)) return undefined;
    return { key: entry.key, value: entry.value };
  }

  private removeEntry(entry: LruEntry<T>): void {
    if (entry.prev) entry.prev.next = entry.next;
    if (entry.next) entry.next.prev = entry.prev;
    if (entry === this.head) this.head = entry.next;
    if (entry === this.tail) this.tail = entry.prev;
  }

  get size(): number {
    return this.map.size;
  }

  destroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.clear();
  }
}

export type { LruOptions };
