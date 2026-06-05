import { EventEmitter } from 'node:events';
import { MysqlConnection, type MysqlConnectOptions, type MysqlResultStream } from './wire.js';
import type { DbResult } from '../types.js';
export interface MysqlPoolOptions extends MysqlConnectOptions {
    minConnections?: number;
    maxConnections?: number;
    idleTimeoutMs?: number;
    acquireTimeoutMs?: number;
}
export declare class MysqlPool {
    private readonly connections;
    private readonly waitQueue;
    private readonly MAX_WAIT;
    private pendingCreations;
    private readonly opts;
    private readonly sweepTimer;
    private closed;
    /** Internal EventEmitter for pool lifecycle events (e.g. pool:exhausted). */
    readonly events: EventEmitter;
    constructor(opts: MysqlPoolOptions);
    /** Warm up minimum connections eagerly. */
    initialize(): Promise<void>;
    private _createConnection;
    /** Acquire a free connection (or create one up to max, or enqueue). */
    acquire(): Promise<MysqlConnection>;
    /** Release a connection back to the pool. */
    release(conn: MysqlConnection): void;
    private _removeConnection;
    private _maybeCreateReplacement;
    /** Stream query results with automatic connection management. */
    stream(sql: string): Promise<MysqlResultStream>;
    /** Execute a query with automatic connection management. */
    query(sql: string, params?: unknown[]): Promise<DbResult>;
    /** Execute a function inside a transaction; auto-rollback on error. */
    transaction<T>(fn: (conn: MysqlConnection) => Promise<T>): Promise<T>;
    private _sweepIdle;
    close(): Promise<void>;
    get size(): number;
    get idle(): number;
}
//# sourceMappingURL=pool.d.ts.map