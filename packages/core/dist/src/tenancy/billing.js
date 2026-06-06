// src/tenancy/billing.ts
// Billing-provider-agnostic usage reporting adapter for multi-tenant apps.
/**
 * A no-op adapter that records reported usage in memory. Useful as a default
 * and for tests; never use it as a real billing backend.
 */
export class InMemoryBillingAdapter {
    reports = [];
    async reportUsage(tenantId, period, metrics) {
        this.reports.push({ tenantId, period, metrics });
    }
}
//# sourceMappingURL=billing.js.map