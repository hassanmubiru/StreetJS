import type { MiddlewareFn } from '../core/types.js';
export declare const TENANTS_MIGRATION_SQL = "CREATE TABLE IF NOT EXISTS street_tenants (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  name TEXT NOT NULL,\n  plan TEXT,\n  connection_string TEXT,\n  status TEXT DEFAULT 'active',\n  created_at TIMESTAMPTZ DEFAULT NOW()\n);";
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
export declare function tenantMiddleware(opts: TenantMiddlewareOptions): MiddlewareFn;
//# sourceMappingURL=context.d.ts.map