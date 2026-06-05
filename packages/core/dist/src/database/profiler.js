// src/database/profiler.ts
// QueryProfiler — non-invasive query profiling via composition.
//
// Usage:
//   const { pool: profiledPool } = QueryProfiler.enable(pool);
//   // use profiledPool in place of pool
//   const slow = QueryProfiler.getSlowQueries(100); // queries > 100ms
// ─── Profiled pool wrapper ────────────────────────────────────────────────────
/**
 * A pool wrapper that records timing for every `query()` call.
 * All other methods are forwarded to the underlying pool unchanged.
 */
export class ProfiledPool {
    _inner;
    _profiler;
    constructor(_inner, _profiler) {
        this._inner = _inner;
        this._profiler = _profiler;
    }
    async query(sql, params) {
        const start = Date.now();
        try {
            const result = await this._inner.query(sql, params);
            return result;
        }
        finally {
            const duration = Date.now() - start;
            this._profiler._record({ sql, params: params ?? [], startedAt: start, durationMs: duration });
        }
    }
    // Forward size / idle for ConnectionDiagnostics.poolStats compatibility
    get size() { return this._inner.size; }
    get idle() { return this._inner.idle; }
    /** Access the underlying (unwrapped) pool */
    get inner() { return this._inner; }
}
// ─── Ring buffer ──────────────────────────────────────────────────────────────
const RING_CAPACITY = 10_000;
// ─── QueryProfiler ────────────────────────────────────────────────────────────
export class QueryProfiler {
    /** Ring buffer storage */
    _buffer;
    /** Write cursor — next slot to overwrite */
    _head = 0;
    /** How many entries have been written (capped at RING_CAPACITY) */
    _count = 0;
    constructor() {
        this._buffer = new Array(RING_CAPACITY).fill(undefined);
    }
    /**
     * Wrap `pool` in a `ProfiledPool` that records every query into this profiler.
     *
     * @param pool The pool to wrap.  No prototype patching occurs.
     * @returns    A `ProfiledPool` that delegates to `pool` and records timings.
     */
    enable(pool) {
        return new ProfiledPool(pool, this);
    }
    /** @internal — called by ProfiledPool after each query */
    _record(record) {
        this._buffer[this._head] = record;
        this._head = (this._head + 1) % RING_CAPACITY;
        if (this._count < RING_CAPACITY)
            this._count++;
    }
    /**
     * Return all recorded queries whose `durationMs >= thresholdMs`,
     * sorted by `durationMs` descending (slowest first).
     */
    getSlowQueries(thresholdMs) {
        const results = [];
        for (let i = 0; i < this._count; i++) {
            // Walk the ring from the oldest entry to newest
            const idx = this._count < RING_CAPACITY
                ? i
                : (this._head + i) % RING_CAPACITY;
            const rec = this._buffer[idx];
            if (rec && rec.durationMs >= thresholdMs) {
                results.push(rec);
            }
        }
        results.sort((a, b) => b.durationMs - a.durationMs);
        return results;
    }
    /** Total number of queries recorded (up to RING_CAPACITY). */
    get recordedCount() { return this._count; }
    /** Clear all recorded entries. */
    clear() {
        this._buffer.fill(undefined);
        this._head = 0;
        this._count = 0;
    }
}
// ─── ConnectionDiagnostics ────────────────────────────────────────────────────
export class ConnectionDiagnostics {
    /**
     * Send `SELECT 1` to the pool and measure the round-trip latency.
     *
     * @returns `{ latencyMs }` — time from query start to result receipt in ms.
     */
    static async ping(pool) {
        const start = Date.now();
        await pool.query('SELECT 1');
        const latencyMs = Date.now() - start;
        return { latencyMs };
    }
    /**
     * Return connection pool statistics.
     *
     * For PgPool/ProfiledPool the `size` and `idle` getters are used.
     * Other pool types return zeroes for fields that cannot be introspected.
     */
    static poolStats(pool) {
        // Unwrap ProfiledPool to reach the underlying pool
        const inner = pool.inner ?? pool;
        const total = typeof inner.size === 'number' ? inner.size : 0;
        const idle = typeof inner.idle === 'number' ? inner.idle : 0;
        return {
            total,
            idle,
            inUse: total - idle,
            waiting: 0,
            avgAcquireMs: 0,
        };
    }
}
//# sourceMappingURL=profiler.js.map