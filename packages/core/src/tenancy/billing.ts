// src/tenancy/billing.ts
// Billing-provider-agnostic usage reporting adapter for multi-tenant apps.

/** A usage snapshot for a tenant over a billing period. */
export interface UsageMetrics {
  [metricKey: string]: number;
}

/** Identifies a billing period (inclusive start, exclusive end). */
export interface BillingPeriod {
  start: Date;
  end: Date;
}

/**
 * Adapter interface for reporting tenant usage to an external billing system
 * (Stripe, Chargebee, a custom ledger, etc.). The framework never couples to a
 * specific provider — applications implement this interface.
 */
export interface TenantBillingAdapter {
  reportUsage(tenantId: string, period: BillingPeriod, metrics: UsageMetrics): Promise<void>;
}

/**
 * A no-op adapter that records reported usage in memory. Useful as a default
 * and for tests; never use it as a real billing backend.
 */
export class InMemoryBillingAdapter implements TenantBillingAdapter {
  readonly reports: Array<{ tenantId: string; period: BillingPeriod; metrics: UsageMetrics }> = [];

  async reportUsage(tenantId: string, period: BillingPeriod, metrics: UsageMetrics): Promise<void> {
    this.reports.push({ tenantId, period, metrics });
  }
}
