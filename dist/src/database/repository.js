// src/database/repository.ts
// Generic repository and migration runner.
// ─── Base repository ────────────────────────────────────────────────────────────
export class StreetPostgresRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async findById(id) {
        const result = await this.pool.query(`SELECT * FROM ${this.tableName} WHERE id = $1 LIMIT 1`, [id]);
        if (result.rows.length === 0)
            return null;
        return this.mapRow(result.rows[0]);
    }
    async findAll(limit = 20, offset = 0) {
        const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);
        const safeOffset = Math.max(0, Math.floor(offset));
        const result = await this.pool.query(`SELECT * FROM ${this.tableName} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [safeLimit, safeOffset]);
        return result.rows.map((r) => this.mapRow(r));
    }
    async count() {
        const result = await this.pool.query(`SELECT COUNT(*) AS total FROM ${this.tableName}`);
        return parseInt(result.rows[0]?.['total'] ?? '0', 10);
    }
    async create(data) {
        const keys = Object.keys(data).filter((k) => data[k] !== undefined);
        const columns = keys.map((k) => `"${k}"`).join(', ');
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
        const params = keys.map((k) => data[k]);
        const result = await this.pool.query(`INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders}) RETURNING *`, params);
        const row = result.rows[0];
        if (!row)
            throw new Error('Insert returned no rows');
        return this.mapRow(row);
    }
    async update(id, data) {
        if (Object.keys(data).length === 0)
            return this.findById(id);
        const entries = Object.entries(data).filter(([, v]) => v !== undefined);
        const setClauses = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(', ');
        const params = entries.map(([, v]) => v);
        params.push(id); // last parameter for WHERE id = $N
        const result = await this.pool.query(`UPDATE ${this.tableName} SET ${setClauses} WHERE id = $${params.length} RETURNING *`, params);
        if (result.rows.length === 0)
            return null;
        return this.mapRow(result.rows[0]);
    }
    async delete(id) {
        const result = await this.pool.query(`DELETE FROM ${this.tableName} WHERE id = $1`, [id]);
        return result.command.startsWith('DELETE') && result.rowCount > 0;
    }
    /** Execute raw SQL within a transaction */
    async withTransaction(fn) {
        return this.pool.transaction(fn);
    }
    /** Stream rows with backpressure */
    streamAll(sql) {
        return this.pool.stream(sql);
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
// ─── SQL escaping helpers (deprecated — kept for reference) ────────────────────
// Parameterized queries via pool.query(sql, params) should be used instead.
//# sourceMappingURL=repository.js.map