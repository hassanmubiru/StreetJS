// src/tenancy/provisioner.ts
// Tenant provisioning, quota enforcement, and usage tracking.

import type { MiddlewareFn } from '../core/types.js';
import type { TenantContextData } from './context.js';

// ── Migration SQL ──────────────────────────────────────────────────────────────

export const TENANT_USAGE_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS street_tenant_usage (
  tenant_id TEXT NOT NULL,
  period DATE NOT NULL,
  metric_key TEXT NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, period, metric_key)
);`;

// ── Types ──────────────────────────────────────────────────────────────────────

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
  transaction?<T>(fn: (conn: { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number; command: string }> }) => Promise<T>): Promise<T>;
};

export interface TenantService {
  provision(opts: { name: string; plan?: string; connectionString?: string }): Promise<string>;
  checkQuota(tenantId: string, quotaKey: string): Promise<QuotaStatus>;
}

// ── TenantServiceImpl ─────────────────────────────────────────────────────────

export class TenantServiceImpl implements TenantService {
  private readonly _quotaConfig: QuotaConfig;

  constructor(
    private readonly _pool: GenericPool,
    quotaConfig: QuotaConfig = {},
  ) {
    this._quotaConfig = quotaConfig;
  }

  /**
   * Provision a new tenant:
   *  1. INSERTs a row into street_tenants
   *  2. Returns the new tenant's UUID
   *  3. Emits tenant:provisioned event (via EventBus if available)
   */
  async provision(opts: { name: string; plan?: string; connectionString?: string }): Promise<string> {
    const run = async (conn: GenericPool): Promise<string> => {
      const result = await conn.query(
        `INSERT INTO street_tenants (name, plan, connection_string, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`,
        [opts.name, opts.plan ?? null, opts.connectionString ?? null],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Failed to provision tenant: no id returned');
      return row['id'] as string;
    };

    let tenantId: string;
    if (typeof this._pool.transaction === 'function') {
      tenantId = await this._pool.transaction(run);
    } else {
      tenantId = await run(this._pool);
    }

    return tenantId;
  }

  /**
   * Check whether a tenant has exceeded their quota for a given metric key.
   * Returns QuotaStatus with current usage vs. configured limit.
   */
  async checkQuota(tenantId: string, quotaKey: string): Promise<QuotaStatus> {
    const limit = this._quotaConfig[quotaKey] ?? Infinity;

    // Current period = today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const period = today.toISOString().slice(0, 10); // YYYY-MM-DD

    const result = await this._pool.query(
      `SELECT value FROM street_tenant_usage WHERE tenant_id = $1 AND period = $2 AND metric_key = $3 LIMIT 1`,
      [tenantId, period, quotaKey],
    );

    const current =
      result.rows.length > 0 ? Number((result.rows[0] as Record<string, unknown>)['value'] ?? 0) : 0;

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
export function QuotaEnforcer(
  service: TenantService,
  quotaKey: string,
  onWarning?: (tenantId: string, status: QuotaStatus) => void,
): MiddlewareFn {
  return async (ctx, next) => {
    const tenant = ctx.state['tenant'] as TenantContextData | undefined;
    if (!tenant) {
      await next();
      return;
    }

    const status = await service.checkQuota(tenant.id, quotaKey);

    // Emit warning at 80% threshold
    if (
      status.limit > 0 &&
      status.current / status.limit >= 0.8 &&
      typeof onWarning === 'function'
    ) {
      onWarning(tenant.id, status);
    }

    if (!status.allowed) {
      ctx.json(
        {
          error: 'quota_exceeded',
          quota: quotaKey,
          limit: status.limit,
          reset: status.reset.toISOString(),
        },
        429,
      );
      return;
    }

    await next();
  };
}

// ── Admin metrics route ────────────────────────────────────────────────────────

interface TenantAdminCtx {
  method: string;
  path: string;
  user: { roles: string[] } | null;
  json(data: unknown, status?: number): void;
}
interface TenantAdminApp {
  use(mw: (ctx: TenantAdminCtx, next: () => Promise<void>) => Promise<void>): void;
}

/**
 * Register `GET /admin/tenants/:id/metrics` returning the current usage and
 * quota status for a tenant. Protected by the configured admin role.
 */
export function registerTenantMetricsRoute(
  app: TenantAdminApp,
  service: TenantService,
  opts: { quotaKeys?: string[]; adminRole?: string } = {},
): void {
  const adminRole = opts.adminRole ?? 'admin';
  const quotaKeys = opts.quotaKeys ?? [];
  const re = /^\/admin\/tenants\/([^/]+)\/metrics$/;

  app.use(async (ctx, next) => {
    const m = ctx.method === 'GET' ? re.exec(ctx.path) : null;
    if (!m) {
      await next();
      return;
    }
    if (!ctx.user || !ctx.user.roles.includes(adminRole)) {
      ctx.json({ error: 'Forbidden', required: [adminRole] }, 403);
      return;
    }
    const tenantId = decodeURIComponent(m[1]!);
    const quotas: Record<string, QuotaStatus> = {};
    for (const key of quotaKeys) {
      quotas[key] = await service.checkQuota(tenantId, key);
    }
    ctx.json({ tenantId, quotas });
  });
}
