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
    constructor(opts: PoolOptions);
    /** Warm up minimum connections */
    initialize(): Promise<void>;
    private _createConnection;
    /** Acquire a free connection (or create one up to max, or wait) */
    acquire(): Promise<PgConnection>;
    /** Release connection back to pool */
    release(conn: PgConnection): void;
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
}
//# sourceMappingURL=pool.d.ts.map