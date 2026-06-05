// src/database/schema-inspector.ts
// Database schema introspection for PostgreSQL, MySQL, and SQLite.
// Provides a unified DatabaseSchema regardless of the underlying engine.
// ─── SchemaInspector ─────────────────────────────────────────────────────────
export class SchemaInspector {
    /** Schema cache keyed by pool object reference. */
    static _cache = new Map();
    /**
     * Inspect the connected database and return its schema.
     * Results are cached for `opts.ttlMs` milliseconds (default 60 000).
     */
    static async inspect(pool, opts) {
        const ttlMs = opts?.ttlMs ?? 60_000;
        const now = Date.now();
        const cached = SchemaInspector._cache.get(pool);
        if (cached && cached.expiresAt > now) {
            return cached.schema;
        }
        // Detect dialect by duck-typing the pool
        let schema;
        if (SchemaInspector._isSqlitePool(pool)) {
            schema = await SchemaInspector._inspectSqlite(pool);
        }
        else if (SchemaInspector._isPgPool(pool)) {
            schema = await SchemaInspector._inspectPostgres(pool);
        }
        else {
            // MySQL or any other pool that satisfies QueryablePool
            schema = await SchemaInspector._inspectMysql(pool);
        }
        SchemaInspector._cache.set(pool, {
            schema,
            expiresAt: now + ttlMs,
        });
        return schema;
    }
    /**
     * Remove the cached schema for `pool`, forcing the next `inspect()` call
     * to fetch fresh data from the database.
     */
    static invalidateCache(pool) {
        SchemaInspector._cache.delete(pool);
    }
    // ── Dialect detection ───────────────────────────────────────────────────────
    static _isSqlitePool(pool) {
        // SqlitePool uses worker_threads and exposes a `filePath`-based constructor.
        // We detect it by checking for a `transaction` method that accepts a
        // function taking a `query` helper — a signature unique to SqlitePool.
        // More robustly: check for the `_workerPath` property that only SqlitePool has.
        // Safest: rely on the pool constructor name.
        return (pool !== null &&
            typeof pool === 'object' &&
            pool['constructor'] !== undefined &&
            pool.constructor.name === 'SqlitePool');
    }
    static _isPgPool(pool) {
        return (pool !== null &&
            typeof pool === 'object' &&
            pool.constructor.name === 'PgPool');
    }
    // ── PostgreSQL introspection ────────────────────────────────────────────────
    /**
     * Inspect a PostgreSQL database.
     * Uses 3 round-trips:
     *   1. columns + primary keys (information_schema.columns + key_column_usage)
     *   2. foreign keys (information_schema.referential_constraints + key_column_usage)
     *   3. indexes (pg_indexes)
     */
    static async _inspectPostgres(pool) {
        // Round-trip 1: columns and primary key membership
        const colSql = `
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        CASE WHEN kcu.column_name IS NOT NULL THEN true ELSE false END AS is_pk
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.table_schema, kcu.table_name, kcu.column_name
        FROM information_schema.key_column_usage kcu
        JOIN information_schema.table_constraints tc
          ON  tc.constraint_name = kcu.constraint_name
          AND tc.table_schema    = kcu.table_schema
          AND tc.table_name      = kcu.table_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema    = current_schema()
      ) kcu
        ON  kcu.table_schema  = c.table_schema
        AND kcu.table_name    = c.table_name
        AND kcu.column_name   = c.column_name
      WHERE c.table_schema = current_schema()
        AND c.table_name IN (
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_type   = 'BASE TABLE'
        )
      ORDER BY c.table_name, c.ordinal_position
    `;
        // Round-trip 2: foreign keys
        const fkSql = `
      SELECT
        kcu.table_name,
        kcu.column_name,
        ccu.table_name  AS ref_table,
        ccu.column_name AS ref_column
      FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON  kcu.constraint_name = rc.constraint_name
        AND kcu.table_schema    = rc.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON  ccu.constraint_name = rc.unique_constraint_name
        AND ccu.table_schema    = rc.unique_constraint_schema
      WHERE rc.constraint_schema = current_schema()
      ORDER BY kcu.table_name, kcu.column_name
    `;
        // Round-trip 3: indexes
        const idxSql = `
      SELECT
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
      ORDER BY tablename, indexname
    `;
        const [colResult, fkResult, idxResult] = await Promise.all([
            pool.query(colSql),
            pool.query(fkSql),
            pool.query(idxSql),
        ]);
        // Build table map from columns
        const tableMap = new Map();
        for (const row of colResult.rows) {
            const tbl = row['table_name'] ?? '';
            if (!tableMap.has(tbl)) {
                tableMap.set(tbl, { name: tbl, columns: [], primaryKey: [], foreignKeys: [], indexes: [] });
            }
            const ts = tableMap.get(tbl);
            const col = {
                name: row['column_name'] ?? '',
                type: row['data_type'] ?? '',
                nullable: row['is_nullable'] === 'YES',
                default: row['column_default'] ?? null,
            };
            ts.columns.push(col);
            if (row['is_pk'] === 'true' || row['is_pk'] === 't') {
                ts.primaryKey.push(col.name);
            }
        }
        // Attach foreign keys
        for (const row of fkResult.rows) {
            const tbl = row['table_name'] ?? '';
            const ts = tableMap.get(tbl);
            if (!ts)
                continue;
            ts.foreignKeys.push({
                column: row['column_name'] ?? '',
                refTable: row['ref_table'] ?? '',
                refColumn: row['ref_column'] ?? '',
            });
        }
        // Parse and attach indexes
        for (const row of idxResult.rows) {
            const tbl = row['tablename'] ?? '';
            const ts = tableMap.get(tbl);
            if (!ts)
                continue;
            const indexDef = row['indexdef'] ?? '';
            const indexName = row['indexname'] ?? '';
            const unique = /CREATE UNIQUE INDEX/i.test(indexDef);
            // Parse column list from index definition:
            // "CREATE [UNIQUE] INDEX name ON table USING method (col1, col2)"
            const colMatch = indexDef.match(/\(([^)]+)\)/);
            const columns = colMatch
                ? colMatch[1].split(',').map((s) => s.trim().replace(/^"(.+)"$/, '$1'))
                : [];
            ts.indexes.push({ name: indexName, columns, unique });
        }
        return {
            tables: Array.from(tableMap.values()),
            inspectedAt: new Date(),
        };
    }
    // ── MySQL introspection ─────────────────────────────────────────────────────
    /**
     * Inspect a MySQL/MariaDB database using information_schema catalog tables.
     * Uses 3 parallel round-trips: columns+pk, foreign keys, indexes.
     */
    static async _inspectMysql(pool) {
        const colSql = `
      SELECT
        c.TABLE_NAME      AS table_name,
        c.COLUMN_NAME     AS column_name,
        c.DATA_TYPE       AS data_type,
        c.IS_NULLABLE     AS is_nullable,
        c.COLUMN_DEFAULT  AS column_default,
        c.COLUMN_KEY      AS column_key
      FROM information_schema.COLUMNS c
      WHERE c.TABLE_SCHEMA = DATABASE()
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
    `;
        const fkSql = `
      SELECT
        kcu.TABLE_NAME        AS table_name,
        kcu.COLUMN_NAME       AS column_name,
        kcu.REFERENCED_TABLE_NAME  AS ref_table,
        kcu.REFERENCED_COLUMN_NAME AS ref_column
      FROM information_schema.KEY_COLUMN_USAGE kcu
      WHERE kcu.TABLE_SCHEMA            = DATABASE()
        AND kcu.REFERENCED_TABLE_NAME  IS NOT NULL
      ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME
    `;
        const idxSql = `
      SELECT
        TABLE_NAME  AS table_name,
        INDEX_NAME  AS index_name,
        COLUMN_NAME AS column_name,
        NON_UNIQUE  AS non_unique
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
    `;
        const [colResult, fkResult, idxResult] = await Promise.all([
            pool.query(colSql),
            pool.query(fkSql),
            pool.query(idxSql),
        ]);
        const tableMap = new Map();
        for (const row of colResult.rows) {
            const tbl = row['table_name'] ?? '';
            if (!tableMap.has(tbl)) {
                tableMap.set(tbl, { name: tbl, columns: [], primaryKey: [], foreignKeys: [], indexes: [] });
            }
            const ts = tableMap.get(tbl);
            const col = {
                name: row['column_name'] ?? '',
                type: row['data_type'] ?? '',
                nullable: row['is_nullable'] === 'YES',
                default: row['column_default'] ?? null,
            };
            ts.columns.push(col);
            if (row['column_key'] === 'PRI') {
                ts.primaryKey.push(col.name);
            }
        }
        for (const row of fkResult.rows) {
            const tbl = row['table_name'] ?? '';
            const ts = tableMap.get(tbl);
            if (!ts)
                continue;
            ts.foreignKeys.push({
                column: row['column_name'] ?? '',
                refTable: row['ref_table'] ?? '',
                refColumn: row['ref_column'] ?? '',
            });
        }
        // Group index rows (one row per column in the index) into IndexMeta
        const indexAccum = new Map();
        for (const row of idxResult.rows) {
            const tbl = row['table_name'] ?? '';
            const idxName = row['index_name'] ?? '';
            const key = `${tbl}::${idxName}`;
            if (!indexAccum.has(key)) {
                indexAccum.set(key, {
                    tableName: tbl,
                    name: idxName,
                    columns: [],
                    unique: row['non_unique'] === '0',
                });
            }
            indexAccum.get(key).columns.push(row['column_name'] ?? '');
        }
        for (const idx of indexAccum.values()) {
            const ts = tableMap.get(idx.tableName);
            if (!ts)
                continue;
            ts.indexes.push({ name: idx.name, columns: idx.columns, unique: idx.unique });
        }
        return {
            tables: Array.from(tableMap.values()),
            inspectedAt: new Date(),
        };
    }
    // ── SQLite introspection ────────────────────────────────────────────────────
    /**
     * Inspect a SQLite database using PRAGMA statements.
     * Fetches the table list first, then issues PRAGMA queries for each table.
     */
    static async _inspectSqlite(pool) {
        // Get all user tables (exclude internal sqlite_ tables)
        const tablesResult = await pool.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
        const tableNames = tablesResult.rows.map((r) => r['name'] ?? '');
        const tables = await Promise.all(tableNames.map((name) => SchemaInspector._inspectSqliteTable(pool, name)));
        return { tables, inspectedAt: new Date() };
    }
    static async _inspectSqliteTable(pool, tableName) {
        // Run all three PRAGMAs for this table
        const [colResult, idxListResult, fkResult] = await Promise.all([
            pool.query(`PRAGMA table_info(${JSON.stringify(tableName)})`),
            pool.query(`PRAGMA index_list(${JSON.stringify(tableName)})`),
            pool.query(`PRAGMA foreign_key_list(${JSON.stringify(tableName)})`),
        ]);
        // Columns and primary key from table_info
        // Columns: cid, name, type, notnull, dflt_value, pk
        const columns = [];
        const primaryKey = [];
        for (const row of colResult.rows) {
            columns.push({
                name: row['name'] ?? '',
                type: row['type'] ?? '',
                nullable: row['notnull'] === '0',
                default: row['dflt_value'] ?? null,
            });
            if (row['pk'] !== '0' && row['pk'] !== null) {
                // pk > 0 means it's part of the primary key; value indicates position
                primaryKey.push({ pos: Number(row['pk']), name: row['name'] ?? '' });
            }
        }
        // Sort primary key columns by their pk position
        const pkEntries = colResult.rows
            .filter((r) => r['pk'] !== '0' && r['pk'] !== null && r['pk'] !== undefined)
            .sort((a, b) => Number(a['pk']) - Number(b['pk']))
            .map((r) => r['name'] ?? '');
        // Foreign keys from foreign_key_list
        // Columns: id, seq, table, from, to, on_update, on_delete, match
        const foreignKeys = fkResult.rows.map((row) => ({
            column: row['from'] ?? '',
            refTable: row['table'] ?? '',
            refColumn: row['to'] ?? '',
        }));
        // Indexes from index_list, then fetch columns for each non-partial index
        // Columns: seq, name, unique, origin, partial
        const indexes = [];
        for (const idxRow of idxListResult.rows) {
            const idxName = idxRow['name'] ?? '';
            // Fetch columns for this index via PRAGMA index_info
            const infoResult = await pool.query(`PRAGMA index_info(${JSON.stringify(idxName)})`);
            // Columns: seqno, cid, name
            const cols = infoResult.rows
                .sort((a, b) => Number(a['seqno']) - Number(b['seqno']))
                .map((r) => r['name'] ?? '');
            indexes.push({
                name: idxName,
                columns: cols,
                unique: idxRow['unique'] === '1',
            });
        }
        return {
            name: tableName,
            columns,
            primaryKey: pkEntries,
            foreignKeys,
            indexes,
        };
    }
}
//# sourceMappingURL=schema-inspector.js.map