// src/database/migrations.ts
// Ordered, idempotent SQL migration runner with tracking table.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { PgPool } from './pool.js';
import { Injectable } from '../core/container.js';
import { SchemaInspector } from './schema-inspector.js';
const MIGRATIONS_TABLE = 'street_migrations';
// Finding 5 fix: safe filename pattern — no path separators, no dotdot
const SAFE_MIGRATION_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9_\-.]*\.sql$/;
/**
 * Resolve and validate that `dir` is an absolute path and that every
 * migration file stays within it (prevents path traversal).
 */
function resolveAndValidateDir(dir) {
    const resolved = resolve(dir);
    return resolved;
}
function assertFileWithinDir(dir, filename) {
    // Filename must match safe pattern — no slashes, no dotdot
    if (!SAFE_MIGRATION_FILENAME.test(filename)) {
        throw new Error(`Unsafe migration filename rejected: ${filename}`);
    }
    const fullPath = join(dir, filename);
    // Double-check the resolved path is still inside the directory
    const resolvedFull = resolve(fullPath);
    if (!resolvedFull.startsWith(dir + sep) && resolvedFull !== dir) {
        throw new Error(`Migration file escapes migrations directory: ${filename}`);
    }
    return resolvedFull;
}
// ─── Reflect metadata keys ─────────────────────────────────────────────────────
/** Column definitions: EntityColumnMeta[] (set by an @Column()/@Entity() decorator). */
const COLUMNS_META_KEY = 'street:columns';
/** Index definitions: EntityIndexMeta[]. */
const INDEXES_META_KEY = 'street:indexes';
/** Explicit table name override: string. */
const TABLE_META_KEY = 'street:table';
/** Primary key column names: string[]. */
const PRIMARY_KEY_META_KEY = 'street:primaryKey';
// ─── SQL identifier / literal safety ───────────────────────────────────────────
/** Plain SQL identifier (table, column, index name). */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** SQL type token, allowing length/precision specifiers e.g. VARCHAR(255), NUMERIC(10,2). */
const SAFE_SQL_TYPE = /^[A-Za-z0-9_ (),]+$/;
/** Conservative default-expression pattern — forbids statement terminators. */
const SAFE_DEFAULT = /^[A-Za-z0-9_'". :+\-()]*$/;
/** Type synonyms used to avoid false-positive "type change" diffs across dialects. */
const TYPE_SYNONYMS = {
    INT: 'INTEGER',
    INT4: 'INTEGER',
    INT8: 'BIGINT',
    BOOL: 'BOOLEAN',
    'CHARACTER VARYING': 'VARCHAR',
    'DOUBLE PRECISION': 'DOUBLE',
    'TIMESTAMP WITHOUT TIME ZONE': 'TIMESTAMP',
    'TIMESTAMP WITH TIME ZONE': 'TIMESTAMPTZ',
};
function assertSafeIdentifier(kind, value) {
    if (!SAFE_IDENTIFIER.test(value)) {
        throw new Error(`Unsafe ${kind} in entity metadata rejected: ${JSON.stringify(value)}`);
    }
    return value;
}
function assertSafeType(type) {
    if (!SAFE_SQL_TYPE.test(type)) {
        throw new Error(`Unsafe SQL type in entity metadata rejected: ${JSON.stringify(type)}`);
    }
    return type;
}
function renderDefault(value) {
    if (!SAFE_DEFAULT.test(value)) {
        throw new Error(`Unsafe column default in entity metadata rejected: ${JSON.stringify(value)}`);
    }
    return value;
}
/** Normalize a SQL type for equivalence comparison (uppercase, strip size, map synonyms). */
function canonicalType(type) {
    const stripped = type.trim().toUpperCase().replace(/\s*\([^)]*\)/g, '').trim();
    return TYPE_SYNONYMS[stripped] ?? stripped;
}
/** Framework-managed tables that must never be proposed for DROP. */
function isFrameworkTable(name) {
    return name.startsWith('street_') || name.startsWith('sqlite_');
}
// ─── Metadata readers ──────────────────────────────────────────────────────────
function resolveTableName(entity) {
    const fromMeta = Reflect.getMetadata(TABLE_META_KEY, entity);
    if (typeof fromMeta === 'string' && fromMeta)
        return fromMeta;
    const staticName = entity['tableName'];
    if (typeof staticName === 'string' && staticName)
        return staticName;
    const ctor = entity;
    return ctor.name ? ctor.name.toLowerCase() : '';
}
function readColumns(entity) {
    return Reflect.getMetadata(COLUMNS_META_KEY, entity) ?? [];
}
function readIndexes(entity) {
    return Reflect.getMetadata(INDEXES_META_KEY, entity) ?? [];
}
function readPrimaryKey(entity) {
    return Reflect.getMetadata(PRIMARY_KEY_META_KEY, entity) ?? [];
}
// ─── DDL rendering ─────────────────────────────────────────────────────────────
function renderColumnDef(col) {
    const name = assertSafeIdentifier('column name', col.name);
    const type = assertSafeType((col.type ?? 'TEXT').trim());
    let def = `${name} ${type}`;
    if (col.nullable === false)
        def += ' NOT NULL';
    if (col.default !== undefined && col.default !== null) {
        def += ` DEFAULT ${renderDefault(col.default)}`;
    }
    return def;
}
function renderCreateTable(tableName, cols, primaryKey) {
    const defs = cols.map(renderColumnDef);
    if (primaryKey.length > 0) {
        const pkCols = primaryKey.map((c) => assertSafeIdentifier('primary key column', c));
        defs.push(`PRIMARY KEY (${pkCols.join(', ')})`);
    }
    return `CREATE TABLE ${tableName} (${defs.join(', ')});`;
}
function renderCreateIndex(tableName, idx) {
    const name = assertSafeIdentifier('index name', idx.name);
    const cols = idx.columns.map((c) => assertSafeIdentifier('index column', c));
    const unique = idx.unique ? 'UNIQUE ' : '';
    return `CREATE ${unique}INDEX ${name} ON ${tableName} (${cols.join(', ')});`;
}
// ─── MigrationDiffer ──────────────────────────────────────────────────────────
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
export class MigrationDiffer {
    /**
     * Diff the live schema of `pool` against the given entity constructors.
     *
     * @param pool     Any queryable pool (PgPool, SqlitePool, MysqlPool, etc.)
     * @param entities Array of entity class constructors carrying `street:*` metadata
     */
    static async diff(pool, entities) {
        // Invalidate cache so we always read the current live schema
        SchemaInspector.invalidateCache(pool);
        const liveSchema = await SchemaInspector.inspect(pool, { ttlMs: 0 });
        const safe = [];
        const destructive = [];
        const entityTableNames = new Set();
        for (const entity of entities) {
            const tableName = resolveTableName(entity);
            if (!tableName)
                continue;
            assertSafeIdentifier('table name', tableName);
            entityTableNames.add(tableName);
            const entityCols = readColumns(entity);
            const entityIndexes = readIndexes(entity);
            const primaryKey = readPrimaryKey(entity);
            const liveTable = liveSchema.tables.find((t) => t.name === tableName);
            // Entire table missing → CREATE TABLE (+ its indexes). Both are safe.
            if (!liveTable) {
                if (entityCols.length > 0) {
                    safe.push(renderCreateTable(tableName, entityCols, primaryKey));
                    for (const idx of entityIndexes) {
                        safe.push(renderCreateIndex(tableName, idx));
                    }
                }
                continue;
            }
            const liveColMap = new Map(liveTable.columns.map((c) => [c.name, c]));
            const entityColNames = new Set(entityCols.map((c) => c.name));
            for (const col of entityCols) {
                const liveCol = liveColMap.get(col.name);
                if (!liveCol) {
                    // Column missing in DB → ADD COLUMN.
                    // A NOT NULL column without a default cannot be added to a populated
                    // table, so it is classified destructive; otherwise it is additive.
                    const stmt = `ALTER TABLE ${tableName} ADD COLUMN ${renderColumnDef(col)};`;
                    const requiresValue = col.nullable === false &&
                        (col.default === undefined || col.default === null);
                    if (requiresValue)
                        destructive.push(stmt);
                    else
                        safe.push(stmt);
                    continue;
                }
                // Column exists in both → detect a type change (potential narrowing).
                if (col.type && canonicalType(col.type) !== canonicalType(liveCol.type)) {
                    assertSafeIdentifier('column name', col.name);
                    const newType = assertSafeType(col.type.trim());
                    destructive.push(`ALTER TABLE ${tableName} ALTER COLUMN ${col.name} TYPE ${newType};`);
                }
            }
            // Columns in DB but not in entity → DROP COLUMN (destructive)
            for (const liveCol of liveTable.columns) {
                if (!entityColNames.has(liveCol.name)) {
                    destructive.push(`ALTER TABLE ${tableName} DROP COLUMN ${assertSafeIdentifier('column name', liveCol.name)};`);
                }
            }
            // Indexes declared on the entity but absent in DB → CREATE INDEX (safe)
            const liveIndexNames = new Set(liveTable.indexes.map((i) => i.name));
            for (const idx of entityIndexes) {
                if (!liveIndexNames.has(idx.name)) {
                    safe.push(renderCreateIndex(tableName, idx));
                }
            }
        }
        // Live tables not represented by any entity → DROP TABLE (destructive),
        // excluding framework-managed tables.
        for (const liveTable of liveSchema.tables) {
            if (entityTableNames.has(liveTable.name))
                continue;
            if (isFrameworkTable(liveTable.name))
                continue;
            destructive.push(`DROP TABLE ${assertSafeIdentifier('table name', liveTable.name)};`);
        }
        return { safe, destructive };
    }
}
let StreetMigrationRunner = class StreetMigrationRunner {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /** Run all pending migrations from the migrations directory */
    async run(migrationsDir) {
        // Finding 5 fix: resolve and validate the directory path
        const safeDir = resolveAndValidateDir(migrationsDir);
        await this._ensureTable();
        const appliedSet = await this._getApplied();
        const files = await this._getMigrationFiles(safeDir);
        for (const file of files) {
            if (appliedSet.has(file)) {
                console.log(`[migrations] Skipping already applied: ${file}`);
                continue;
            }
            // Finding 5 fix: validate each filename before constructing the path
            const fullPath = assertFileWithinDir(safeDir, file);
            const sql = await readFile(fullPath, 'utf8');
            console.log(`[migrations] Applying: ${file}`);
            await this.pool.transaction(async (conn) => {
                await conn.query(sql);
                await conn.query(`INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES ($1, NOW())`, [file]);
            });
            console.log(`[migrations] Applied: ${file}`);
        }
        console.log('[migrations] All migrations complete.');
    }
    /** Rollback the last N migrations (requires rollback SQL files) */
    async rollback(migrationsDir, steps = 1) {
        // Finding 5 fix: resolve and validate the directory path
        const safeDir = resolveAndValidateDir(migrationsDir);
        const applied = await this._getAppliedOrdered();
        const toRollback = applied.slice(-steps).reverse();
        for (const name of toRollback) {
            const rollbackFile = name.replace(/\.sql$/, '.rollback.sql');
            // Finding 5 fix: validate rollback filename too
            const fullPath = assertFileWithinDir(safeDir, rollbackFile);
            let sql;
            try {
                sql = await readFile(fullPath, 'utf8');
            }
            catch {
                throw new Error(`Rollback file not found: ${rollbackFile}`);
            }
            console.log(`[migrations] Rolling back: ${name}`);
            await this.pool.transaction(async (conn) => {
                await conn.query(sql);
                await conn.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = $1`, [name]);
            });
            console.log(`[migrations] Rolled back: ${name}`);
        }
    }
    async _ensureTable() {
        await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    }
    async _getApplied() {
        const result = await this.pool.query(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY applied_at ASC`);
        return new Set(result.rows.map((r) => r['name'] ?? '').filter(Boolean));
    }
    async _getAppliedOrdered() {
        const result = await this.pool.query(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY applied_at ASC`);
        return result.rows.map((r) => r['name'] ?? '').filter(Boolean);
    }
    async _getMigrationFiles(dir) {
        let entries;
        try {
            entries = await readdir(dir);
        }
        catch {
            console.warn(`[migrations] Directory not found: ${dir}`);
            return [];
        }
        return entries
            .filter((f) => f.endsWith('.sql') && !f.endsWith('.rollback.sql') && SAFE_MIGRATION_FILENAME.test(f))
            .sort(); // lexicographic = timestamp order
    }
};
StreetMigrationRunner = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PgPool])
], StreetMigrationRunner);
export { StreetMigrationRunner };
//# sourceMappingURL=migrations.js.map