import { PgPool } from './pool.js';
export declare class StreetMigrationRunner {
    private readonly pool;
    constructor(pool: PgPool);
    /** Run all pending migrations from the migrations directory */
    run(migrationsDir: string): Promise<void>;
    /** Rollback the last N migrations (requires rollback SQL files) */
    rollback(migrationsDir: string, steps?: number): Promise<void>;
    private _ensureTable;
    private _getApplied;
    private _getAppliedOrdered;
    private _getMigrationFiles;
}
//# sourceMappingURL=migrations.d.ts.map