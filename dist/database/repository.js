// src/database/repository.ts
// Generic repository and migration runner.
// ─── Base repository ────────────────────────────────────────────────────────────
export class StreetPostgresRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async findById(id) {
        const safeId = escapeString(id);
        const result = await this.pool.query(`SELECT * FROM ${this.tableName} WHERE id = '${safeId}' LIMIT 1`);
        if (result.rows.length === 0)
            return null;
        return this.mapRow(result.rows[0]);
    }
    async findAll(limit = 20, offset = 0) {
        const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);
        const safeOffset = Math.max(0, Math.floor(offset));
        const result = await this.pool.query(`SELECT * FROM ${this.tableName} ORDER BY created_at DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`);
        return result.rows.map((r) => this.mapRow(r));
    }
    async count() {
        const result = await this.pool.query(`SELECT COUNT(*) AS total FROM ${this.tableName}`);
        return parseInt(result.rows[0]?.['total'] ?? '0', 10);
    }
    async create(data) {
        const { columns, values } = buildInsert(data);
        const result = await this.pool.query(`INSERT INTO ${this.tableName} (${columns}) VALUES (${values}) RETURNING *`);
        const row = result.rows[0];
        if (!row)
            throw new Error('Insert returned no rows');
        return this.mapRow(row);
    }
    async update(id, data) {
        if (Object.keys(data).length === 0)
            return this.findById(id);
        const safeId = escapeString(id);
        const setClauses = buildUpdate(data);
        const result = await this.pool.query(`UPDATE ${this.tableName} SET ${setClauses} WHERE id = '${safeId}' RETURNING *`);
        if (result.rows.length === 0)
            return null;
        return this.mapRow(result.rows[0]);
    }
    async delete(id) {
        const safeId = escapeString(id);
        const result = await this.pool.query(`DELETE FROM ${this.tableName} WHERE id = '${safeId}'`);
        return result.command.startsWith('DELETE') && result.rowCount > 0;
    }
    /** Execute raw SQL within a transaction */
    async withTransaction(fn) {
        return this.pool.transaction(fn);
    }
    /** Stream rows with backpressure */
    streamAll(sql) {
        return this.pool['connections']
            .find((p) => !p.inUse)
            ?.conn.queryStream(sql) ?? (() => { throw new Error('No idle connection for streaming'); })();
    }
}
// ─── ACID ledger service ────────────────────────────────────────────────────────
export class LedgerTransactionService {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async execute(operations, onSuccess) {
        return this.pool.transaction(async (conn) => {
            for (const op of operations) {
                await op(conn);
            }
            if (onSuccess)
                return onSuccess();
        });
    }
}
// ─── SQL escaping helpers ───────────────────────────────────────────────────────
function escapeString(val) {
    return val.replace(/'/g, "''").replace(/\\/g, '\\\\');
}
function escapeValue(val) {
    if (val === null || val === undefined)
        return 'NULL';
    if (typeof val === 'boolean')
        return val ? 'TRUE' : 'FALSE';
    if (typeof val === 'number')
        return isFinite(val) ? String(val) : 'NULL';
    return `'${escapeString(String(val))}'`;
}
function buildInsert(data) {
    const keys = Object.keys(data).filter((k) => data[k] !== undefined);
    const columns = keys.map((k) => `"${k}"`).join(', ');
    const values = keys.map((k) => escapeValue(data[k])).join(', ');
    return { columns, values };
}
function buildUpdate(data) {
    return Object.entries(data)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `"${k}" = ${escapeValue(v)}`)
        .join(', ');
}
//# sourceMappingURL=repository.js.map