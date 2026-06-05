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
     * - Reads the file at `seedFile` path.
     * - Computes a SHA-256 hash of the file content.
     * - If the hash is already in `street_seed_runs`, the seed is skipped.
     * - Otherwise, executes the SQL inside a transaction and records the hash.
     *
     * @param pool     Any pool that satisfies SeedablePool.
     * @param seedFile Absolute (or relative-to-cwd) path to the .sql seed file.
     * @returns        `{ skipped: boolean, hash: string }` describing what happened.
     */
    static run(pool: SeedablePool, seedFile: string): Promise<{
        skipped: boolean;
        hash: string;
    }>;
}
export {};
//# sourceMappingURL=seeder.d.ts.map