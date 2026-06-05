/**
 * Universal query result returned by all Street database drivers.
 * Each row is a plain object mapping column names to their string (or null) values.
 * Numeric, boolean, and date values are represented as their string serialisation,
 * matching PostgreSQL text-protocol semantics and the SQLite text affinity.
 */
export interface DbResult {
    /** Result rows — empty array when the query produces no rows. */
    rows: Record<string, string | null>[];
    /**
     * Number of rows affected (INSERT/UPDATE/DELETE) or returned (SELECT).
     * For SELECT this is `rows.length`; for DML it is the affected-row count
     * reported by the database engine.
     */
    rowCount: number;
    /**
     * The SQL command that was executed, e.g. `"SELECT"`, `"INSERT"`,
     * `"UPDATE"`, `"DELETE"`, `"CREATE"`.
     * For PostgreSQL this is the CommandComplete tag; for SQLite it is
     * derived from the first token of the SQL statement.
     */
    command: string;
}
//# sourceMappingURL=types.d.ts.map