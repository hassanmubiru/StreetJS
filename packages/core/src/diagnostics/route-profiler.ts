// src/diagnostics/route-profiler.ts
// Route latency profiler: circular buffer per route, P50/P95/P99 computation.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LatencySample {
  latencyNs: bigint;
  isError: boolean;
}

export interface RouteStats {
  count: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

// ── Circular buffer ───────────────────────────────────────────────────────────

const MAX_SAMPLES = 10_000;

class CircularBuffer<T> {
  private readonly _buf: Array<T | undefined>;
  private _head = 0;   // index where next write goes
  private _size = 0;   // number of valid elements

  constructor(private readonly _cap: number) {
    this._buf = new Array<T | undefined>(_cap).fill(undefined);
  }

  push(item: T): void {
    this._buf[this._head] = item;
    this._head = (this._head + 1) % this._cap;
    if (this._size < this._cap) this._size++;
  }

  /** Return all valid samples as a flat array (unordered by time). */
  toArray(): T[] {
    if (this._size === 0) return [];
    if (this._size < this._cap) {
      return this._buf.slice(0, this._size) as T[];
    }
    // Buffer is full — oldest entry is at _head, wrap around
    const result: T[] = new Array<T>(this._cap);
    for (let i = 0; i < this._cap; i++) {
      result[i] = this._buf[(this._head + i) % this._cap] as T;
    }
    return result;
  }

  get size(): number {
    return this._size;
  }
}

// ── Percentile helper ─────────────────────────────────────────────────────────

function percentile(sorted: bigint[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return Number(sorted[idx]!) / 1_000_000; // ns → ms
}

// ── RouteProfiler ─────────────────────────────────────────────────────────────

export class RouteProfiler {
  private readonly _buffers = new Map<string, CircularBuffer<LatencySample>>();

  private _key(method: string, pattern: string): string {
    return `${method.toUpperCase()} ${pattern}`;
  }

  private _getOrCreate(method: string, pattern: string): CircularBuffer<LatencySample> {
    const key = this._key(method, pattern);
    let buf = this._buffers.get(key);
    if (!buf) {
      buf = new CircularBuffer<LatencySample>(MAX_SAMPLES);
      this._buffers.set(key, buf);
    }
    return buf;
  }

  /** Record a single request sample. */
  record(method: string, pattern: string, latencyNs: bigint, isError: boolean): void {
    this._getOrCreate(method, pattern).push({ latencyNs, isError });
  }

  /** Compute percentile stats for a specific route. */
  stats(method: string, pattern: string): RouteStats {
    const key = this._key(method, pattern);
    const buf = this._buffers.get(key);
    if (!buf || buf.size === 0) {
      return { count: 0, errorRate: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
    }

    const samples = buf.toArray();
    const sorted = samples.map((s) => s.latencyNs).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const errors = samples.filter((s) => s.isError).length;

    return {
      count: samples.length,
      errorRate: errors / samples.length,
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
    };
  }

  /** Return stats for all registered routes. */
  allStats(): Map<string, RouteStats> {
    const result = new Map<string, RouteStats>();
    for (const [key] of this._buffers) {
      const [method = '', ...rest] = key.split(' ');
      const pattern = rest.join(' ');
      result.set(key, this.stats(method, pattern));
    }
    return result;
  }
}
