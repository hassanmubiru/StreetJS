import { EventEmitter } from 'node:events';
import { PgConnection, type PgConnectOptions, type PgResult, type StreetPostgresWireStream } from './wire.js';
export interface PoolOptions extends PgConnectOptions {
    minConnections?: number;
    maxConnections?: number;
    idleTimeoutMs?: number;
    acquireTimeoutMs?: number;
}
export declare class PgPool {
    private readonly connections;
    private readonly waitQueue;
    private readonly MAX_WAIT;
    private pendingCreations;
    private readonly opts;
    private readonly sweepTimer;
    private closed;
    /** Rolling window of recent successful acquire durations (ms). */
    private static readonly ACQUIRE_SAMPLE_SIZE;
    private readonly acquireSamples;
    private acquireSamplesHead;
    private acquireSamplesCount;
    /** Internal EventEmitter for pool lifecycle events (e.g. pool:exhausted). */
    readonly events: EventEmitter;
    constructor(opts: PoolOptions);
    /** Warm up minimum connections */
    initialize(): Promise<void>;
    private _createConnection;
    /** Acquire a free connection (or create one up to max, or wait) */
    acquire(): Promise<PgConnection>;
    private _doAcquire;
    /** Release connection back to pool */
    release(conn: PgConnection): void;
    /** Remove a pooled connection from the connections array */
    private _removeConnection;
    /** Create a replacement connection if under max and not closed */
    private _maybeCreateReplacement;
    /** Execute a streaming query — automatically manages acquire/release */
    stream(sql: string): Promise<StreetPostgresWireStream>;
    /** Execute a query with automatic connection management */
    query(sql: string, params?: unknown[]): Promise<PgResult>;
    /** Execute in a transaction */
    transaction<T>(fn: (conn: PgConnection) => Promise<T>): Promise<T>;
    private _sweepIdle;
    close(): Promise<void>;
    get size(): number;
    get idle(): number;
    /** Number of callers currently waiting for a connection. */
    get waiting(): number;
    /** Rolling average of recent successful acquire durations (ms); 0 if none recorded. */
    get avgAcquireMs(): number;
    /** Record a successful acquire duration into the rolling window. */
    private _recordAcquire;
}
/**
 * Helper to subscribe to `pool:exhausted` events emitted by `PgPool`.
 *
 * @param pool  The PgPool instance to listen on.
 * @param fn    Callback invoked with pool state at exhaustion time.
 * @returns     An `off` function that removes the listener when called.
 */
export declare function onPoolExhausted(pool: PgPool, fn: (state: {
    total: number;
    idle: number;
    waiting: number;
}) => void): () => void;
//# sourceMappingURL=pool.d.ts.map