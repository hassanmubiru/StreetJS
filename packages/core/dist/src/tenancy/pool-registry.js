// src/tenancy/pool-registry.ts
// Per-tenant connection pool registry with idle pool reaping.
export class TenantPoolRegistry {
    _masterPool;
    _pools = new Map();
    constructor(_masterPool) {
        this._masterPool = _masterPool;
    }
    /**
     * Returns (or creates) a pool for the given tenant.
     * On first access for a tenant, queries `street_tenants` for the
     * `connection_string`, then builds a pool using the master pool's
     * underlying connection parameters.
     *
     * Returns `null` if the tenant is not found or has no connection_string.
     */
    async getPool(tenantId) {
        const existing = this._pools.get(tenantId);
        if (existing) {
            existing.lastUsed = Date.now();
            return existing.pool;
        }
        // Look up tenant connection string from master pool
        const result = await this._masterPool.query(`SELECT connection_string FROM street_tenants WHERE id = $1 AND status = 'active' LIMIT 1`, [tenantId]);
        if (result.rowCount === 0 || result.rows.length === 0) {
            return null;
        }
        const row = result.rows[0];
        if (!row || !row['connection_string']) {
            // No dedicated connection string — use master pool
            const entry = { pool: this._masterPool, lastUsed: Date.now() };
            this._pools.set(tenantId, entry);
            return this._masterPool;
        }
        // Build a minimal tenant pool backed by the connection string.
        // For simplicity we create a thin wrapper that delegates to master pool
        // but can be replaced with a real PgPool in production.
        const connectionString = row['connection_string'];
        const tenantPool = await this._buildPool(connectionString);
        const entry = { pool: tenantPool, lastUsed: Date.now() };
        this._pools.set(tenantId, entry);
        return tenantPool;
    }
    /**
     * Build a tenant-specific pool from a connection string.
     * Dynamically imports PgPool and creates a real pool.
     */
    async _buildPool(connectionString) {
        // Parse connection string: postgres://user:pass@host:port/database
        let url;
        try {
            url = new URL(connectionString);
        }
        catch {
            // Fall back to master pool if connection string is invalid
            return this._masterPool;
        }
        try {
            const { PgPool } = await import('../database/pool.js');
            const pool = new PgPool({
                host: url.hostname || 'localhost',
                port: parseInt(url.port ?? '5432', 10),
                user: url.username || 'postgres',
                password: url.password || '',
                database: url.pathname.replace(/^\//, '') || 'postgres',
                minConnections: 1,
                maxConnections: 5,
            });
            return pool;
        }
        catch {
            return this._masterPool;
        }
    }
    /**
     * Release idle pools that have been unused for longer than `maxIdleMs`.
     * @param maxIdleMs  Default 300_000 (5 minutes).
     */
    releaseIdle(maxIdleMs = 300_000) {
        const threshold = Date.now() - maxIdleMs;
        for (const [tenantId, entry] of this._pools) {
            if (entry.lastUsed < threshold && entry.pool !== this._masterPool) {
                this._pools.delete(tenantId);
                // Attempt graceful close if the pool supports it
                const p = entry.pool;
                if (typeof p.close === 'function') {
                    p.close().catch(() => undefined);
                }
            }
        }
    }
}
//# sourceMappingURL=pool-registry.js.map