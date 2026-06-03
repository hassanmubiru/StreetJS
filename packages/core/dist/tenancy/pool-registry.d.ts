type GenericPool = {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, string | null>[];
        rowCount: number;
        command: string;
    }>;
};
export declare class TenantPoolRegistry {
    private readonly _masterPool;
    private readonly _pools;
    constructor(_masterPool: GenericPool);
    /**
     * Returns (or creates) a pool for the given tenant.
     * On first access for a tenant, queries `street_tenants` for the
     * `connection_string`, then builds a pool using the master pool's
     * underlying connection parameters.
     *
     * Returns `null` if the tenant is not found or has no connection_string.
     */
    getPool(tenantId: string): Promise<GenericPool | null>;
    /**
     * Build a tenant-specific pool from a connection string.
     * Dynamically imports PgPool and creates a real pool.
     */
    private _buildPool;
    /**
     * Release idle pools that have been unused for longer than `maxIdleMs`.
     * @param maxIdleMs  Default 300_000 (5 minutes).
     */
    releaseIdle(maxIdleMs?: number): void;
}
export {};
//# sourceMappingURL=pool-registry.d.ts.map