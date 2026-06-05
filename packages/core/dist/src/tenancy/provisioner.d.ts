import type { MiddlewareFn } from '../core/types.js';
export declare const TENANT_USAGE_MIGRATION_SQL = "CREATE TABLE IF NOT EXISTS street_tenant_usage (\n  tenant_id TEXT NOT NULL,\n  period DATE NOT NULL,\n  metric_key TEXT NOT NULL,\n  value BIGINT NOT NULL DEFAULT 0,\n  updated_at TIMESTAMPTZ DEFAULT NOW(),\n  PRIMARY KEY (tenant_id, period, metric_key)\n);";
export interface QuotaStatus {
    allowed: boolean;
    current: number;
    limit: number;
    reset: Date;
}
export interface QuotaConfig {
    [key: string]: number;
}
type GenericPool = {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
        rowCount: number;
        command: string;
    }>;
    transaction?<T>(fn: (conn: {
        query(sql: string, params?: unknown[]): Promise<{
            rows: Record<string, unknown>[];
            rowCount: number;
            command: string;
        }>;
    }) => Promise<T>): Promise<T>;
};
export interface TenantService {
    provision(opts: {
        name: string;
        plan?: string;
        connectionString?: string;
    }): Promise<string>;
    checkQuota(tenantId: string, quotaKey: string): Promise<QuotaStatus>;
}
export declare class TenantServiceImpl implements TenantService {
    private readonly _pool;
    private readonly _quotaConfig;
    constructor(_pool: GenericPool, quotaConfig?: QuotaConfig);
    /**
     * Provision a new tenant:
     *  1. INSERTs a row into street_tenants
     *  2. Returns the new tenant's UUID
     *  3. Emits tenant:provisioned event (via EventBus if available)
     */
    provision(opts: {
        name: string;
        plan?: string;
        connectionString?: string;
    }): Promise<string>;
    /**
     * Check whether a tenant has exceeded their quota for a given metric key.
     * Returns QuotaStatus with current usage vs. configured limit.
     */
    checkQuota(tenantId: string, quotaKey: string): Promise<QuotaStatus>;
}
/**
 * Middleware factory that enforces quotas before each request.
 * Reads `ctx.state['tenant']` set by `tenantMiddleware`.
 * Returns 429 if quota is exceeded.
 * Emits `tenant:quota:warning` when usage is at 80%+ of the limit.
 */
export declare function QuotaEnforcer(service: TenantService, quotaKey: string, onWarning?: (tenantId: string, status: QuotaStatus) => void): MiddlewareFn;
export {};
//# sourceMappingURL=provisioner.d.ts.map