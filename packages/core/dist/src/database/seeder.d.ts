export interface SeedablePool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, string | null>[];
        rowCount: number;
        command: string;
    }>;
    transaction<T>(fn: (conn: SeedablePoolConn) => Promise<T>): Promise<T>;
}
type PgConnLike = {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, string | null>[];
        rowCount: number;
        command: string;
    }>;
};
type SqliteQueryFn = (sql: string, params?: unknown[]) => Promise<{
    rows: Record<string, string | null>[];
    rowCount: number;
    command: string;
}>;
export type SeedablePoolConn = PgConnLike | SqliteQueryFn;
export declare class StreetSeeder {
    /**
     * Run a seed file against `pool`.
     *
     * - Validates the seed filename (rejecting path traversal / unsafe names).
     * - Reads the file content and computes a SHA-256 hash of it.
     * - If the hash is already recorded in `street_seed_runs`, the seed is skipped.
     * - Otherwise executes the SQL inside `pool.transaction()` and records the
     *   filename + hash in the same transaction (so a failed seed records nothing).
     *
     * @param pool     Any pool that satisfies SeedablePool.
     * @param seedFile Absolute (or relative-to-cwd) path to the `.sql` seed file.
     * @returns        `{ skipped, hash, name }` describing what happened.
     */
    static run(pool: SeedablePool, seedFile: string): Promise<{
        skipped: boolean;
        hash: string;
        name: string;
    }>;
}
export {};
//# sourceMappingURL=seeder.d.ts.map