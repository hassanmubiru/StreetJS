import type { DbResult } from './types.js';
export interface QueryRecord {
    /** The SQL string that was executed */
    sql: string;
    /** Parameters passed to the query (may be empty) */
    params: unknown[];
    /** Wall-clock start time (ms since epoch) */
    startedAt: number;
    /** Duration of the query in milliseconds */
    durationMs: number;
}
export interface PoolStats {
    total: number;
    idle: number;
    inUse: number;
    waiting: number;
    avgAcquireMs: number;
}
export interface ProfileablePool {
    query(sql: string, params?: unknown[]): Promise<DbResult>;
    size?: number;
    idle?: number;
}
/**
 * A pool wrapper that records timing for every `query()` call.
 * All other methods are forwarded to the underlying pool unchanged.
 */
export declare class ProfiledPool implements ProfileablePool {
    private readonly _inner;
    private readonly _profiler;
    constructor(_inner: ProfileablePool, _profiler: QueryProfiler);
    query(sql: string, params?: unknown[]): Promise<DbResult>;
    get size(): number | undefined;
    get idle(): number | undefined;
    /** Access the underlying (unwrapped) pool */
    get inner(): ProfileablePool;
}
export declare class QueryProfiler {
    /** Ring buffer storage */
    private readonly _buffer;
    /** Write cursor — next slot to overwrite */
    private _head;
    /** How many entries have been written (capped at RING_CAPACITY) */
    private _count;
    constructor();
    /**
     * Wrap `pool` in a `ProfiledPool` that records every query into this profiler.
     *
     * @param pool The pool to wrap.  No prototype patching occurs.
     * @returns    A `ProfiledPool` that delegates to `pool` and records timings.
     */
    enable(pool: ProfileablePool): ProfiledPool;
    /** @internal — called by ProfiledPool after each query */
    _record(record: QueryRecord): void;
    /**
     * Return all recorded queries whose `durationMs >= thresholdMs`,
     * sorted by `durationMs` descending (slowest first).
     */
    getSlowQueries(thresholdMs: number): QueryRecord[];
    /** Total number of queries recorded (up to RING_CAPACITY). */
    get recordedCount(): number;
    /** Clear all recorded entries. */
    clear(): void;
}
export declare class ConnectionDiagnostics {
    /**
     * Send `SELECT 1` to the pool and measure the round-trip latency.
     *
     * @returns `{ latencyMs }` — time from query start to result receipt in ms.
     */
    static ping(pool: ProfileablePool): Promise<{
        latencyMs: number;
    }>;
    /**
     * Return connection pool statistics.
     *
     * For PgPool/ProfiledPool the `size` and `idle` getters are used.
     * Other pool types return zeroes for fields that cannot be introspected.
     */
    static poolStats(pool: ProfileablePool): PoolStats;
}
//# sourceMappingURL=profiler.d.ts.map