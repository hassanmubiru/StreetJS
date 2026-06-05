export declare const FEATURE_FLAGS_MIGRATION_SQL = "CREATE TABLE IF NOT EXISTS street_feature_flags (\n  name TEXT PRIMARY KEY,\n  enabled BOOLEAN DEFAULT false,\n  rules JSONB DEFAULT '[]',\n  updated_at TIMESTAMPTZ DEFAULT NOW()\n);";
export interface FeatureFlagRule {
    type: 'user_id' | 'role' | 'environment' | 'percentage';
    value: string | number;
}
export interface GenericPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
    }>;
}
export declare class FeatureFlagService {
    private readonly pool;
    private readonly ttlMs;
    private readonly cache;
    constructor(pool: GenericPool, ttlMs?: number);
    isEnabled(flagName: string, context?: {
        userId?: string;
        role?: string;
        environment?: string;
    }): Promise<boolean>;
    invalidateCache(flagName: string): void;
    private _loadFlag;
    private _evaluateRule;
}
//# sourceMappingURL=feature-flags.d.ts.map