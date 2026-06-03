import type { DbResult } from '../types.js';
export interface SqlitePoolOptions {
    /** Path to the SQLite database file.  Use `':memory:'` for in-memory DBs. */
    filePath: string;
    /**
     * Maximum number of worker threads.
     * Defaults to 4.  Because SQLite allows only one writer at a time,
     * values beyond the number of concurrent readers rarely help for
     * write-heavy workloads.
     */
    maxWorkers?: number;
}
export declare class SqlitePool {
    private readonly filePath;
    private readonly maxWorkers;
    private readonly workers;
    private readonly waitQueue;
    private closed;
    /** Next message-id counter (shared across all workers; just needs to be unique). */
    private nextId;
    constructor(opts: SqlitePoolOptions);
    private _workerPath;
    private _createWorker;
    private _drainQueue;
    private _acquire;
    private _release;
    private _send;
    /**
     * Execute a single SQL statement.
     *
     * @param sql    SQL string, optionally with `?` positional placeholders.
     * @param params Positional parameter values.
     * @returns      Resolved `DbResult` (rows, rowCount, command).
     */
    query(sql: string, params?: unknown[]): Promise<DbResult>;
    /**
     * Execute a user-supplied function inside a serialised SQLite transaction.
     *
     * The callback receives a `query` helper bound to the same worker connection.
     * If the callback throws (or returns a rejected promise) the transaction is
     * rolled back; otherwise it is committed.
     *
     * Because each worker owns a single SQLite connection, the transaction is
     * guaranteed to run on one connection with no interleaving.
     *
     * @param fn  Async callback that performs the transactional operations.
     * @returns   The value returned by `fn`.
     */
    transaction<T>(fn: (query: (sql: string, params?: unknown[]) => Promise<DbResult>) => Promise<T>): Promise<T>;
    /**
     * Gracefully close all worker threads.
     * Any in-flight queries will complete; subsequent calls throw.
     */
    close(): Promise<void>;
}
//# sourceMappingURL=pool.d.ts.map