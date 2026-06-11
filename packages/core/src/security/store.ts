// src/security/store.ts
// Pluggable backing-store abstraction (R3.8).
//
// Rate limiting, abuse counters, and similar subsystems need either in-process
// or shared cross-instance state. This module defines a small set of store
// interfaces so an in-memory implementation (the default) and a shared external
// implementation (e.g. a Redis-backed store) are interchangeable, allowing
// counts to be enforced consistently across multiple application instances.
//
// The in-memory rate-limit store extracts and reuses the Map-based
// sliding-window logic that previously lived inline in `ratelimit.ts`, so it is
// drop-in interchangeable with a future `RedisRateLimitStore`. All time inputs
// are explicit milliseconds, and an injected clock (now-provider) is supported
// so window timing is fully deterministic in tests.

/**
 * A now-provider clock returning the current time in milliseconds.
 * Inject a fixed/controllable clock in tests to make window timing
 * deterministic.
 */
export type Clock = () => number;

/** Default clock backed by wall-clock milliseconds. */
export const systemClock: Clock = () => Date.now();

/**
 * Generic key/value store abstraction with optional TTL. Used by subsystems
 * that need to persist small opaque values (e.g. lockout markers) either
 * in-process or in a shared external store.
 */
export interface KeyValueStore {
  /** Retrieve the value for `key`, or `undefined` if absent/expired. */
  get(key: string): Promise<string | undefined>;
  /**
   * Store `value` under `key`. When `ttlMs` is provided, the entry expires
   * after that many milliseconds.
   */
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  /** Remove the entry for `key` if present. */
  delete(key: string): Promise<void>;
}

/**
 * Sliding-window counter abstraction. Used by counter-backed subsystems such as
 * the Abuse_Engine (failed-login / signup counts). Implementations MUST evaluate
 * the window atomically so concurrent instances agree on the count.
 */
export interface CounterStore {
  /**
   * Record an event at `nowMs` for `key` and return the number of events
   * counted within `[nowMs - windowMs, nowMs]` (inclusive of the new event).
   */
  increment(key: string, nowMs: number, windowMs: number): Promise<number>;
  /** Events currently counted in the window for `key`, without recording one. */
  count(key: string, nowMs: number, windowMs: number): Promise<number>;
  /** Drop all recorded events for `key`. */
  reset(key: string): Promise<void>;
}

/**
 * Backing-store abstraction for sliding-window request counts (R3.8).
 *
 * Implementations MUST evaluate the window atomically so concurrent instances
 * agree. The in-memory implementation does so trivially; a Redis-backed
 * implementation uses a sorted set per key with score-range trimming.
 */
export interface RateLimitStore {
  /**
   * Record a hit at `nowMs` for `key` and return the count of hits within
   * `[nowMs - windowMs, nowMs]` (inclusive of the new hit).
   */
  hit(key: string, nowMs: number, windowMs: number): Promise<number>;
  /** Hits currently counted in the window (for remaining-allowance headers). */
  count(key: string, nowMs: number, windowMs: number): Promise<number>;
}

/** Default ceiling on the number of distinct keys tracked in memory. */
const DEFAULT_MAX_KEYS = 100_000;
/** Default ceiling on stored timestamps per key. */
const DEFAULT_MAX_REQUESTS_PER_KEY = 1000;

export interface InMemoryRateLimitStoreOptions {
  /** Injected now-provider; defaults to {@link systemClock}. */
  clock?: Clock;
  /** Maximum distinct keys tracked before oldest-key eviction. */
  maxKeys?: number;
  /** Maximum timestamps stored per key (bounded memory per key). */
  maxRequestsPerKey?: number;
  /**
   * When set together with `retentionMs`, a periodic sweep drops timestamps
   * older than `retentionMs` to bound memory for idle keys. Defaults to no
   * timer (callers/tests prune lazily on access).
   */
  sweepIntervalMs?: number;
  /** Retention horizon for the periodic sweep, in milliseconds. */
  retentionMs?: number;
}

/**
 * In-memory {@link RateLimitStore} implementing a bounded sliding window over a
 * `Map<string, number[]>` of millisecond timestamps. Extracted from the
 * original `RateLimiter` so it is interchangeable with a future
 * `RedisRateLimitStore`. Window evaluation is driven entirely by the `nowMs`
 * arguments, so behavior is deterministic under an injected clock.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  // Map: key -> ascending array of millisecond timestamps (bounded).
  private readonly store = new Map<string, number[]>();
  private readonly clock: Clock;
  private readonly maxKeys: number;
  private readonly maxRequestsPerKey: number;
  private readonly retentionMs?: number;
  private readonly sweepTimer?: NodeJS.Timeout;

  constructor(opts: InMemoryRateLimitStoreOptions = {}) {
    this.clock = opts.clock ?? systemClock;
    this.maxKeys = opts.maxKeys ?? DEFAULT_MAX_KEYS;
    this.maxRequestsPerKey = opts.maxRequestsPerKey ?? DEFAULT_MAX_REQUESTS_PER_KEY;
    this.retentionMs = opts.retentionMs;

    if (opts.sweepIntervalMs && opts.sweepIntervalMs > 0 && this.retentionMs && this.retentionMs > 0) {
      this.sweepTimer = setInterval(() => this._sweep(), opts.sweepIntervalMs);
      // Do not keep the event loop alive solely for sweeping.
      this.sweepTimer.unref?.();
    }
  }

  /** Current time per the injected clock. Convenience for deterministic callers. */
  now(): number {
    return this.clock();
  }

  async hit(key: string, nowMs: number, windowMs: number): Promise<number> {
    const cutoff = nowMs - windowMs;

    let timestamps = this.store.get(key);
    if (!timestamps) {
      if (this.store.size >= this.maxKeys) {
        // Evict the oldest key when at capacity.
        const firstKey = this.store.keys().next().value;
        if (firstKey !== undefined) this.store.delete(firstKey);
      }
      timestamps = [];
      this.store.set(key, timestamps);
    }

    this._prune(timestamps, cutoff);

    // Enforce bounded per-key storage: stop accumulating beyond the cap, but
    // still report the (capped) count so the limiter rejects appropriately.
    if (timestamps.length < this.maxRequestsPerKey) {
      timestamps.push(nowMs);
    }

    return timestamps.length;
  }

  async count(key: string, nowMs: number, windowMs: number): Promise<number> {
    const cutoff = nowMs - windowMs;
    const timestamps = this.store.get(key);
    if (!timestamps) return 0;

    let active = 0;
    for (const t of timestamps) {
      if (t >= cutoff) active++;
    }
    return active;
  }

  /** Remove all tracked state for `key`. */
  reset(key: string): void {
    this.store.delete(key);
  }

  /** Number of keys currently tracked (primarily for tests/diagnostics). */
  size(): number {
    return this.store.size;
  }

  /** Stop the sweep timer (if any) and clear all tracked state. */
  destroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.store.clear();
  }

  /** Drop leading timestamps older than `cutoff` (array is kept ascending). */
  private _prune(timestamps: number[], cutoff: number): void {
    let start = 0;
    while (start < timestamps.length && timestamps[start]! < cutoff) start++;
    if (start > 0) timestamps.splice(0, start);
  }

  /** Periodic memory sweep: drop timestamps older than the retention horizon. */
  private _sweep(): void {
    if (!this.retentionMs) return;
    const cutoff = this.clock() - this.retentionMs;
    for (const [key, timestamps] of this.store.entries()) {
      this._prune(timestamps, cutoff);
      if (timestamps.length === 0) this.store.delete(key);
    }
  }
}

/**
 * In-memory {@link CounterStore} built on the same bounded sliding-window logic
 * as {@link InMemoryRateLimitStore}. Suitable as the default counter backing for
 * abuse-prevention counters until a shared external store is wired in.
 */
export class InMemoryCounterStore implements CounterStore {
  private readonly store: InMemoryRateLimitStore;

  constructor(opts: InMemoryRateLimitStoreOptions = {}) {
    this.store = new InMemoryRateLimitStore(opts);
  }

  increment(key: string, nowMs: number, windowMs: number): Promise<number> {
    return this.store.hit(key, nowMs, windowMs);
  }

  count(key: string, nowMs: number, windowMs: number): Promise<number> {
    return this.store.count(key, nowMs, windowMs);
  }

  async reset(key: string): Promise<void> {
    this.store.reset(key);
  }

  /** Stop any timers and clear all tracked state. */
  destroy(): void {
    this.store.destroy();
  }
}

interface ExpiringEntry {
  value: string;
  expiresAt?: number;
}

/**
 * In-memory {@link KeyValueStore} with optional per-entry TTL, evaluated lazily
 * against the injected clock on read. Default backing for small opaque values
 * until a shared external store is wired in.
 */
export class InMemoryKeyValueStore implements KeyValueStore {
  private readonly store = new Map<string, ExpiringEntry>();
  private readonly clock: Clock;

  constructor(opts: { clock?: Clock } = {}) {
    this.clock = opts.clock ?? systemClock;
  }

  async get(key: string): Promise<string | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.clock()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs !== undefined ? this.clock() + ttlMs : undefined;
    this.store.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Clear all entries. */
  clear(): void {
    this.store.clear();
  }
}
