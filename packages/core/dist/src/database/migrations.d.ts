import { PgPool } from './pool.js';
import type { QueryablePool } from './schema-inspector.js';
export interface EntityColumnMeta {
    /** Column name in the database */
    name: string;
    /** SQL type (e.g. 'TEXT', 'INTEGER') */
    type?: string;
}
export interface MigrationDiff {
    /** Safe statements — additive changes (ALTER TABLE … ADD COLUMN …) */
    safe: string[];
    /** Destructive statements — column removals (ALTER TABLE … DROP COLUMN …) */
    destructive: string[];
}
/**
 * Compares the live database schema (via SchemaInspector) against the
 * column metadata registered on entity classes via @Column() decorators
 * (stored under the `"street:columns"` Reflect key).
 *
 * Returns:
 *   safe        — ALTER TABLE … ADD COLUMN … for columns present in entities but not in DB
 *   destructive — ALTER TABLE … DROP COLUMN … for columns present in DB but not in entities
 */
export declare class MigrationDiffer {
    /**
     * Diff the live schema of `pool` against the given entity constructors.
     *
     * @param pool     Any queryable pool (PgPool, SqlitePool, etc.)
     * @param entities Array of entity class constructors decorated with @Column()
     */
    static diff(pool: QueryablePool, entities: object[]): Promise<MigrationDiff>;
}
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