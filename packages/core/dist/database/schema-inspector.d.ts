import type { PgPool } from '../database/pool.js';
import type { SqlitePool } from './sqlite/pool.js';
import type { DbResult } from './types.js';
export interface ColumnMeta {
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
}
export interface IndexMeta {
    name: string;
    columns: string[];
    unique: boolean;
}
export interface FkMeta {
    column: string;
    refTable: string;
    refColumn: string;
}
export interface TableSchema {
    name: string;
    columns: ColumnMeta[];
    primaryKey: string[];
    foreignKeys: FkMeta[];
    indexes: IndexMeta[];
}
export interface DatabaseSchema {
    tables: TableSchema[];
    inspectedAt: Date;
}
/**
 * Minimal interface satisfied by PgPool, MysqlPool, and SqlitePool.
 * Used internally so we can call `pool.query()` without importing
 * the not-yet-published mysql module.
 */
export interface QueryablePool {
    query(sql: string, params?: unknown[]): Promise<DbResult>;
}
interface CacheEntry {
    schema: DatabaseSchema;
    expiresAt: number;
}
export declare class SchemaInspector {
    /** Schema cache keyed by pool object reference. */
    static readonly _cache: Map<object, CacheEntry>;
    /**
     * Inspect the connected database and return its schema.
     * Results are cached for `opts.ttlMs` milliseconds (default 60 000).
     */
    static inspect(pool: PgPool | SqlitePool | QueryablePool, opts?: {
        ttlMs?: number;
    }): Promise<DatabaseSchema>;
    /**
     * Remove the cached schema for `pool`, forcing the next `inspect()` call
     * to fetch fresh data from the database.
     */
    static invalidateCache(pool: PgPool | SqlitePool | QueryablePool): void;
    private static _isSqlitePool;
    private static _isPgPool;
    /**
     * Inspect a PostgreSQL database.
     * Uses 3 round-trips:
     *   1. columns + primary keys (information_schema.columns + key_column_usage)
     *   2. foreign keys (information_schema.referential_constraints + key_column_usage)
     *   3. indexes (pg_indexes)
     */
    private static _inspectPostgres;
    /**
     * Inspect a MySQL/MariaDB database using information_schema catalog tables.
     * Uses 3 parallel round-trips: columns+pk, foreign keys, indexes.
     */
    private static _inspectMysql;
    /**
     * Inspect a SQLite database using PRAGMA statements.
     * Fetches the table list first, then issues PRAGMA queries for each table.
     */
    private static _inspectSqlite;
    private static _inspectSqliteTable;
}
export {};
//# sourceMappingURL=schema-inspector.d.ts.map