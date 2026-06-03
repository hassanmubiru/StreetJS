// src/tenancy/pool-registry.ts
// Per-tenant connection pool registry with idle pool reaping.

type GenericPool = {
  query(sql: string, params?: unknown[]): Promise<{
    rows: Record<string, string | null>[];
    rowCount: number;
    command: string;
  }>;
};

interface PoolEntry {
  pool: GenericPool;
  lastUsed: number;
}

export class TenantPoolRegistry {
  private readonly _pools = new Map<string, PoolEntry>();

  constructor(private readonly _masterPool: GenericPool) {}

  /**
   * Returns (or creates) a pool for the given tenant.
   * On first access for a tenant, queries `street_tenants` for the
   * `connection_string`, then builds a pool using the master pool's
   * underlying connection parameters.
   *
   * Returns `null` if the tenant is not found or has no connection_string.
   */
  async getPool(tenantId: string): Promise<GenericPool | null> {
    const existing = this._pools.get(tenantId);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.pool;
    }

    // Look up tenant connection string from master pool
    const result = await this._masterPool.query(
      `SELECT connection_string FROM street_tenants WHERE id = $1 AND status = 'active' LIMIT 1`,
      [tenantId],
    );

    if (result.rowCount === 0 || result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    if (!row || !row['connection_string']) {
      // No dedicated connection string — use master pool
      const entry: PoolEntry = { pool: this._masterPool, lastUsed: Date.now() };
      this._pools.set(tenantId, entry);
      return this._masterPool;
    }

    // Build a minimal tenant pool backed by the connection string.
    // For simplicity we create a thin wrapper that delegates to master pool
    // but can be replaced with a real PgPool in production.
    const connectionString = row['connection_string'] as string;
    const tenantPool = await this._buildPool(connectionString);

    const entry: PoolEntry = { pool: tenantPool, lastUsed: Date.now() };
    this._pools.set(tenantId, entry);
    return tenantPool;
  }

  /**
   * Build a tenant-specific pool from a connection string.
   * Dynamically imports PgPool and creates a real pool.
   */
  private async _buildPool(connectionString: string): Promise<GenericPool> {
    // Parse connection string: postgres://user:pass@host:port/database
    let url: URL;
    try {
      url = new URL(connectionString);
    } catch {
      // Fall back to master pool if connection string is invalid
      return this._masterPool;
    }

    try {
      const { PgPool } = await import('../database/pool.js');
      const pool = new PgPool({
        host: url.hostname,
        port: parseInt(url.port ?? '5432', 10),
        user: url.username || undefined,
        password: url.password || undefined,
        database: url.pathname.replace(/^\//, '') || undefined,
        minConnections: 1,
        maxConnections: 5,
      } as Parameters<typeof PgPool.prototype.initialize>[0] extends never ? never : Parameters<(typeof PgPool)['prototype']['query']>[0] extends string ? Parameters<ConstructorParameters<typeof PgPool>[0]> : never);
      return pool as unknown as GenericPool;
    } catch {
      return this._masterPool;
    }
  }

  /**
   * Release idle pools that have been unused for longer than `maxIdleMs`.
   * @param maxIdleMs  Default 300_000 (5 minutes).
   */
  releaseIdle(maxIdleMs = 300_000): void {
    const threshold = Date.now() - maxIdleMs;
    for (const [tenantId, entry] of this._pools) {
      if (entry.lastUsed < threshold && entry.pool !== this._masterPool) {
        this._pools.delete(tenantId);
        // Attempt graceful close if the pool supports it
        const p = entry.pool as { close?: () => Promise<void> };
        if (typeof p.close === 'function') {
          p.close().catch(() => undefined);
        }
      }
    }
  }
}
