import type { MetricsRegistry } from '../observability/prometheus.js';
export declare const TENANT_DAILY_STATS_MIGRATION_SQL = "CREATE TABLE IF NOT EXISTS street_tenant_daily_stats (\n  tenant_id TEXT NOT NULL,\n  date DATE NOT NULL,\n  metrics JSONB NOT NULL DEFAULT '{}',\n  created_at TIMESTAMPTZ DEFAULT NOW(),\n  PRIMARY KEY (tenant_id, date)\n);";
/**
 * A scoped metrics view for a single tenant.
 * All operations automatically add a `tenant_id` label.
 */
export declare class TenantMetricsView {
    private readonly _registry;
    private readonly _tenantId;
    constructor(_registry: MetricsRegistry, _tenantId: string);
    /**
     * Increment a counter metric for this tenant.
     * Registers the counter if it does not already exist.
     */
    counter(name: string, labels?: Record<string, string>): void;
    /**
     * Set a gauge metric value for this tenant.
     */
    gauge(name: string, value: number, labels?: Record<string, string>): void;
    /**
     * Record a histogram observation for this tenant.
     */
    observe(name: string, value: number, labels?: Record<string, string>): void;
}
export declare class TenantMetricsRegistry {
    private readonly _views;
    private readonly _registry;
    constructor(registry: MetricsRegistry, maxTenants?: number);
    /**
     * Returns (or creates) a `TenantMetricsView` for the given tenant ID.
     * Evicts the LRU entry automatically when the 10,000-tenant cap is reached.
     */
    forTenant(tenantId: string): TenantMetricsView;
}
//# sourceMappingURL=metrics.d.ts.map