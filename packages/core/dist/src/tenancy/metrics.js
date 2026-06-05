// src/tenancy/metrics.ts
// Per-tenant metrics with LRU eviction at 10,000 tenants.
import { LruCache } from '../cache/lru.js';
// ── Migration SQL ──────────────────────────────────────────────────────────────
export const TENANT_DAILY_STATS_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS street_tenant_daily_stats (
  tenant_id TEXT NOT NULL,
  date DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, date)
);`;
// ── TenantMetricsView ─────────────────────────────────────────────────────────
/**
 * A scoped metrics view for a single tenant.
 * All operations automatically add a `tenant_id` label.
 */
export class TenantMetricsView {
    _registry;
    _tenantId;
    constructor(_registry, _tenantId) {
        this._registry = _registry;
        this._tenantId = _tenantId;
    }
    /**
     * Increment a counter metric for this tenant.
     * Registers the counter if it does not already exist.
     */
    counter(name, labels = {}) {
        let metric;
        try {
            metric = this._registry.counter(name, `Tenant counter: ${name}`, ['tenant_id', ...Object.keys(labels)]);
        }
        catch {
            // Already registered — get it from the registry via a fresh Counter ref
            // The MetricsRegistry doesn't expose a `get`, so we work around it by
            // tracking metrics in a local map on the view.
            metric = _getOrRegisterCounter(this._registry, name, Object.keys(labels));
        }
        metric.inc({ tenant_id: this._tenantId, ...labels });
    }
    /**
     * Set a gauge metric value for this tenant.
     */
    gauge(name, value, labels = {}) {
        let metric;
        try {
            metric = this._registry.gauge(name, `Tenant gauge: ${name}`, ['tenant_id', ...Object.keys(labels)]);
        }
        catch {
            metric = _getOrRegisterGauge(this._registry, name, Object.keys(labels));
        }
        metric.set(value, { tenant_id: this._tenantId, ...labels });
    }
    /**
     * Record a histogram observation for this tenant.
     */
    observe(name, value, labels = {}) {
        let metric;
        try {
            metric = this._registry.histogram(name, `Tenant histogram: ${name}`, undefined, ['tenant_id', ...Object.keys(labels)]);
        }
        catch {
            metric = _getOrRegisterHistogram(this._registry, name, Object.keys(labels));
        }
        metric.observe(value, { tenant_id: this._tenantId, ...labels });
    }
}
// ── Metric caches (module-level) ──────────────────────────────────────────────
// MetricsRegistry throws on duplicate registration; we cache refs to avoid re-registration.
const _counterCache = new Map();
const _gaugeCache = new Map();
const _histogramCache = new Map();
function _getOrRegisterCounter(registry, name, extraLabels) {
    const cached = _counterCache.get(name);
    if (cached)
        return cached;
    try {
        const c = registry.counter(name, `Tenant counter: ${name}`, ['tenant_id', ...extraLabels]);
        _counterCache.set(name, c);
        return c;
    }
    catch {
        // Another registration racing; return a no-op stub
        return { name, help: '', labelNames: [], inc: () => undefined, render: () => '' };
    }
}
function _getOrRegisterGauge(registry, name, extraLabels) {
    const cached = _gaugeCache.get(name);
    if (cached)
        return cached;
    try {
        const g = registry.gauge(name, `Tenant gauge: ${name}`, ['tenant_id', ...extraLabels]);
        _gaugeCache.set(name, g);
        return g;
    }
    catch {
        return { name, help: '', labelNames: [], set: () => undefined, render: () => '' };
    }
}
function _getOrRegisterHistogram(registry, name, extraLabels) {
    const cached = _histogramCache.get(name);
    if (cached)
        return cached;
    try {
        const h = registry.histogram(name, `Tenant histogram: ${name}`, undefined, ['tenant_id', ...extraLabels]);
        _histogramCache.set(name, h);
        return h;
    }
    catch {
        return { name, help: '', labelNames: [], buckets: [], observe: () => undefined, render: () => '' };
    }
}
// ── TenantMetricsRegistry ─────────────────────────────────────────────────────
const DEFAULT_MAX_TENANTS = 10_000;
export class TenantMetricsRegistry {
    _views;
    _registry;
    constructor(registry, maxTenants = DEFAULT_MAX_TENANTS) {
        this._registry = registry;
        this._views = new LruCache({
            maxEntries: maxTenants,
            ttlMs: 24 * 60 * 60 * 1000, // 24 hours
        });
    }
    /**
     * Returns (or creates) a `TenantMetricsView` for the given tenant ID.
     * Evicts the LRU entry automatically when the 10,000-tenant cap is reached.
     */
    forTenant(tenantId) {
        const existing = this._views.get(tenantId);
        if (existing)
            return existing;
        const view = new TenantMetricsView(this._registry, tenantId);
        this._views.set(tenantId, view);
        return view;
    }
}
//# sourceMappingURL=metrics.js.map