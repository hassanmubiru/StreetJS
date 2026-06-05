// src/enterprise/feature-flags.ts
// Feature flag service with per-user targeting rules and TTL caching.
import { createHash } from 'node:crypto';
export const FEATURE_FLAGS_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS street_feature_flags (
  name TEXT PRIMARY KEY,
  enabled BOOLEAN DEFAULT false,
  rules JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);`;
export class FeatureFlagService {
    pool;
    ttlMs;
    cache = new Map();
    constructor(pool, ttlMs = 30_000) {
        this.pool = pool;
        this.ttlMs = ttlMs;
    }
    async isEnabled(flagName, context) {
        const record = await this._loadFlag(flagName);
        if (!record)
            return false;
        if (!record.enabled)
            return false;
        // No rules → globally enabled
        if (!record.rules || record.rules.length === 0)
            return true;
        // Evaluate rules (OR logic: any matching rule enables the flag)
        for (const rule of record.rules) {
            if (this._evaluateRule(rule, flagName, context)) {
                return true;
            }
        }
        return false;
    }
    invalidateCache(flagName) {
        this.cache.delete(flagName);
    }
    async _loadFlag(flagName) {
        const cached = this.cache.get(flagName);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.record;
        }
        const result = await this.pool.query('SELECT name, enabled, rules FROM street_feature_flags WHERE name = $1', [flagName]);
        if (result.rows.length === 0)
            return null;
        const row = result.rows[0];
        const record = {
            name: row.name,
            enabled: Boolean(row.enabled),
            rules: Array.isArray(row.rules) ? row.rules : [],
        };
        this.cache.set(flagName, {
            record,
            expiresAt: Date.now() + this.ttlMs,
        });
        return record;
    }
    _evaluateRule(rule, flagName, context) {
        switch (rule.type) {
            case 'user_id':
                return context?.userId === rule.value;
            case 'role':
                return context?.role === rule.value;
            case 'environment':
                return process.env['NODE_ENV'] === rule.value;
            case 'percentage': {
                const userId = context?.userId;
                if (!userId)
                    return false;
                const pct = typeof rule.value === 'number' ? rule.value : Number(rule.value);
                if (isNaN(pct) || pct <= 0)
                    return false;
                if (pct >= 100)
                    return true;
                // Stable per-user hash: SHA256(flagName + userId)[0:8] % 100 < pct
                const hash = createHash('sha256')
                    .update(flagName + userId)
                    .digest('hex');
                const bucket = parseInt(hash.slice(0, 8), 16) % 100;
                return bucket < pct;
            }
            default:
                return false;
        }
    }
}
//# sourceMappingURL=feature-flags.js.map