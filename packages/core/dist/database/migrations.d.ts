import { PgPool } from './pool.js';
import type { QueryablePool } from './schema-inspector.js';
export interface EntityColumnMeta {
    /** Column name in the database */
    name: string;
    /** SQL type (e.g. 'TEXT', 'INTEGER'). Defaults to 'TEXT' when omitted. */
    type?: string;
    /** Whether the column accepts NULL. Defaults to true (nullable) when omitted. */
    nullable?: boolean;
    /** Optional column default expression rendered verbatim into the DDL. */
    default?: string;
}
export interface EntityIndexMeta {
    /** Index name. */
    name: string;
    /** Columns covered by the index, in declaration order. */
    columns: string[];
    /** Whether the index enforces uniqueness. */
    unique?: boolean;
}
export interface MigrationDiff {
    /**
     * Safe (additive) statements — applying these cannot lose data:
     * CREATE TABLE, ADD COLUMN for nullable/defaulted columns, CREATE INDEX.
     */
    safe: string[];
    /**
     * Destructive statements — applying these can lose data or fail on a
     * populated table: DROP TABLE, DROP COLUMN, column type changes,
     * and NOT NULL column additions without a default.
     */
    destructive: string[];
}
/**
 * Compares the live database schema (via SchemaInspector) against the
 * metadata registered on entity classes (column, index, table-name, and
 * primary-key metadata stored under the `street:*` Reflect keys).
 *
 * Returns two buckets of SQL statements:
 *   safe        — additive changes that cannot lose data: CREATE TABLE,
 *                 ADD COLUMN (nullable or defaulted), CREATE INDEX.
 *   destructive — changes that can lose data or fail on a populated table:
 *                 DROP TABLE, DROP COLUMN, column type changes, and
 *                 NOT NULL column additions without a default.
 *
 * Framework-managed tables (prefixed `street_`/`sqlite_`) are never proposed
 * for DROP.
 */
export declare class MigrationDiffer {
    /**
     * Diff the live schema of `pool` against the given entity constructors.
     *
     * @param pool     Any queryable pool (PgPool, SqlitePool, MysqlPool, etc.)
     * @param entities Array of entity class constructors carrying `street:*` metadata
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