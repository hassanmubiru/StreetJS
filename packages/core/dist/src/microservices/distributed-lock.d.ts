export interface LockHandle {
    /** Release the lock. Safe to call multiple times. */
    release(): Promise<void>;
}
type GenericPool = {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
        rowCount: number;
        command: string;
    }>;
};
export declare class DistributedLock {
    private readonly _pool;
    constructor(_pool: GenericPool);
    /**
     * Acquire an advisory lock for the given key.
     *
     * Uses `pg_try_advisory_lock` (session-level, non-blocking).
     * Retries with exponential backoff until acquired or timeout.
     *
     * @param key    Logical lock key.
     * @param ttlMs  Auto-release after this many ms. Default: 30_000.
     * @returns      A `LockHandle` whose `release()` frees the lock.
     */
    acquire(key: string, ttlMs?: number): Promise<LockHandle>;
    private _tryAcquire;
}
export {};
//# sourceMappingURL=distributed-lock.d.ts.map