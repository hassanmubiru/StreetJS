// src/tenancy/context.ts
// Tenant isolation: resolution strategies, middleware, and SQL migration.

import type { MiddlewareFn } from '../core/types.js';

// ── Migration SQL ──────────────────────────────────────────────────────────────

export const TENANTS_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS street_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plan TEXT,
  connection_string TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);`;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TenantContextData {
  id: string;
  name: string;
  plan?: string;
  connectionString?: string;
}

export type TenantResolutionStrategy = 'subdomain' | 'path' | 'header';

export interface TenantMiddlewareOptions {
  strategy: TenantResolutionStrategy;
  headerName?: string;
  pool: {
    query(sql: string, params?: unknown[]): Promise<{
      rows: Record<string, string | null>[];
      rowCount: number;
      command: string;
    }>;
  };
}

// ── Tenant resolution helpers ─────────────────────────────────────────────────

function extractTenantIdentifier(
  strategy: TenantResolutionStrategy,
  hostHeader: string | undefined,
  path: string,
  headers: Record<string, string>,
  headerName: string,
): string | null {
  switch (strategy) {
    case 'subdomain': {
      // e.g. "acme.example.com" → "acme"
      const host = hostHeader ?? '';
      const parts = host.split('.');
      if (parts.length >= 3) return parts[0] ?? null;
      return null;
    }
    case 'path': {
      // e.g. "/t/acme/users" → "acme"
      const match = path.match(/^\/t\/([^/]+)/);
      return match?.[1] ?? null;
    }
    case 'header': {
      return headers[headerName.toLowerCase()] ?? null;
    }
    default:
      return null;
  }
}

// ── tenantMiddleware factory ──────────────────────────────────────────────────

export function tenantMiddleware(opts: TenantMiddlewareOptions): MiddlewareFn {
  const headerName = opts.headerName ?? 'x-tenant-id';

  return async (ctx, next) => {
    const hostHeader = ctx.req.headers.host;
    const identifier = extractTenantIdentifier(
      opts.strategy,
      hostHeader,
      ctx.path,
      ctx.headers,
      headerName,
    );

    if (!identifier) {
      ctx.json({ error: 'tenant_not_found' }, 400);
      return;
    }

    // Look up tenant by name or id
    const result = await opts.pool.query(
      `SELECT id, name, plan, connection_string FROM street_tenants WHERE (name = $1 OR id::text = $1) AND status = 'active' LIMIT 1`,
      [identifier],
    );

    if (result.rowCount === 0 || result.rows.length === 0) {
      ctx.json({ error: 'tenant_not_found' }, 400);
      return;
    }

    const row = result.rows[0];
    if (!row) {
      ctx.json({ error: 'tenant_not_found' }, 400);
      return;
    }

    const tenant: TenantContextData = {
      id: row['id'] as string,
      name: row['name'] as string,
      plan: row['plan'] ?? undefined,
      connectionString: row['connection_string'] ?? undefined,
    };

    ctx.state['tenant'] = tenant;
    await next();
  };
}
