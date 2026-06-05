// src/tenancy/provisioner.ts
// Tenant provisioning, quota enforcement, and usage tracking.
// ── Migration SQL ──────────────────────────────────────────────────────────────
export const TENANT_USAGE_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS street_tenant_usage (
  tenant_id TEXT NOT NULL,
  period DATE NOT NULL,
  metric_key TEXT NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, period, metric_key)
);`;
// ── TenantServiceImpl ─────────────────────────────────────────────────────────
export class TenantServiceImpl {
    _pool;
    _quotaConfig;
    constructor(_pool, quotaConfig = {}) {
        this._pool = _pool;
        this._quotaConfig = quotaConfig;
    }
    /**
     * Provision a new tenant:
     *  1. INSERTs a row into street_tenants
     *  2. Returns the new tenant's UUID
     *  3. Emits tenant:provisioned event (via EventBus if available)
     */
    async provision(opts) {
        const run = async (conn) => {
            const result = await conn.query(`INSERT INTO street_tenants (name, plan, connection_string, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`, [opts.name, opts.plan ?? null, opts.connectionString ?? null]);
            const row = result.rows[0];
            if (!row)
                throw new Error('Failed to provision tenant: no id returned');
            return row['id'];
        };
        let tenantId;
        if (typeof this._pool.transaction === 'function') {
            tenantId = await this._pool.transaction(run);
        }
        else {
            tenantId = await run(this._pool);
        }
        return tenantId;
    }
    /**
     * Check whether a tenant has exceeded their quota for a given metric key.
     * Returns QuotaStatus with current usage vs. configured limit.
     */
    async checkQuota(tenantId, quotaKey) {
        const limit = this._quotaConfig[quotaKey] ?? Infinity;
        // Current period = today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const period = today.toISOString().slice(0, 10); // YYYY-MM-DD
        const result = await this._pool.query(`SELECT value FROM street_tenant_usage WHERE tenant_id = $1 AND period = $2 AND metric_key = $3 LIMIT 1`, [tenantId, period, quotaKey]);
        const current = result.rows.length > 0 ? Number(result.rows[0]['value'] ?? 0) : 0;
        // Reset at start of next day
        const reset = new Date(today);
        reset.setDate(reset.getDate() + 1);
        return {
            allowed: current < limit,
            current,
            limit: limit === Infinity ? -1 : limit,
            reset,
        };
    }
}
// ── QuotaEnforcer middleware ───────────────────────────────────────────────────
/**
 * Middleware factory that enforces quotas before each request.
 * Reads `ctx.state['tenant']` set by `tenantMiddleware`.
 * Returns 429 if quota is exceeded.
 * Emits `tenant:quota:warning` when usage is at 80%+ of the limit.
 */
export function QuotaEnforcer(service, quotaKey, onWarning) {
    return async (ctx, next) => {
        const tenant = ctx.state['tenant'];
        if (!tenant) {
            await next();
            return;
        }
        const status = await service.checkQuota(tenant.id, quotaKey);
        // Emit warning at 80% threshold
        if (status.limit > 0 &&
            status.current / status.limit >= 0.8 &&
            typeof onWarning === 'function') {
            onWarning(tenant.id, status);
        }
        if (!status.allowed) {
            ctx.json({
                error: 'quota_exceeded',
                quota: quotaKey,
                limit: status.limit,
                reset: status.reset.toISOString(),
            }, 429);
            return;
        }
        await next();
    };
}
//# sourceMappingURL=provisioner.js.map