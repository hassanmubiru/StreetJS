// packages/cli/src/tests/marzpay-dashboard.test.ts
// Unit tests for the scaffolded SaaS MarzPay billing dashboard controller (Task 13.2).
//
// These tests exercise the REAL scaffolded BillingDashboardController shipped as
// overlay template content (NOT a top-level export of create.ts) at
// `src/modules/dashboard/billing-dashboard.controller.ts` under the
// `--with-marzpay` flag. Mirroring marzpay-billing-pbt.test.ts, we read the
// registered template string, transpile it to JS, neutralize its non-resolvable
// runtime imports (the `streetjs` decorator import and `reflect-metadata`; all
// other imports are `import type` and are elided by transpilation), load it as a
// module, and drive the controller with fake org-scoped services / repos and a
// fake ctx that captures the rendered template + data + status.
//
// Coverage of Requirement 10 acceptance criteria:
//   • 403 with no billing data (Req 10.3): an unauthenticated caller (no ctx.org)
//     OR a caller whose role is not owner/admin gets the forbidden view at status
//     403, and the rendered data carries NO section/billing data.
//   • Org-scoped population (Req 10.2): an owner/admin sees each section populated
//     from the tenant's own records returned by the org-scoped services.
//   • Empty-state (Req 10.5): a section whose tenant-scoped collection is empty
//     renders an empty-state indicator (data-state="empty") while the others render.
//   • Per-section error indicator (Req 10.4): when one section's data source
//     throws, that section renders an error indicator (data-state="error") while
//     the other sections still render and no other tenant's data is substituted.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

// --- Minimal structural mirrors of the scaffolded contracts ----------------

type Role = 'owner' | 'admin' | 'member' | string;
interface ActiveOrg {
  id: string;
  slug: string;
  role: Role;
}

interface SubscriptionRecord {
  id: string;
  org_id: string;
  plan: string;
  status: string;
  current_period_end?: string;
}

interface BillingRecord {
  id: string;
  org_id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
}

interface InvoiceRecord {
  id: string;
  org_id: string;
  amount: number;
  currency: string;
  issued_at: string;
}

interface UsageRecord {
  id: string;
  org_id: string;
  metric: string;
  quantity: number;
}

/** A captured render: the template name, the view data, and the HTTP status. */
interface RenderCapture {
  template: string;
  data: Record<string, unknown>;
  status?: number;
}

/** The fake StreetContext shape the controller reads from. */
interface FakeCtx {
  org?: ActiveOrg;
  htmx: { view: (template: string, data: Record<string, unknown>, status?: number) => void };
}

/** The subscription-service surface the dashboard calls. */
interface FakeSubscriptionService {
  listSubscriptions(ctx: FakeCtx): Promise<SubscriptionRecord[]>;
  paymentHistory(ctx: FakeCtx, billing: unknown): Promise<BillingRecord[]>;
  listInvoices(ctx: FakeCtx, invoices: unknown): Promise<InvoiceRecord[]>;
  listUsage(ctx: FakeCtx, usage: unknown): Promise<UsageRecord[]>;
}

/** The billing-service surface the dashboard calls. */
interface FakeBillingService {
  resolvePlan(planId: string): { id: string; name: string } | null;
}

type DashboardCtor = new (
  billing: FakeBillingService,
  subscriptions: FakeSubscriptionService,
  invoices: unknown,
  billingRecords: unknown,
  usage: unknown,
) => { dashboard(ctx: FakeCtx): Promise<void> };

const TS_OPTS = {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true,
  },
} as const;

/**
 * Transpile the saas overlay's billing dashboard controller template and load the
 * REAL BillingDashboardController. Non-resolvable runtime imports are neutralized:
 *   - `import 'reflect-metadata';` is dropped (no decorator metadata is needed
 *     by the neutralized no-op decorators).
 *   - `import { Controller, Get } from 'streetjs';` value import is replaced with
 *     no-op decorator factories so the class/method decorators apply harmlessly.
 *   - every other import is an `import type` and is elided by transpilation.
 */
async function loadDashboardController(): Promise<{
  BillingDashboardController: DashboardCtor;
  cleanup: () => void;
}> {
  const file = TEMPLATES.saas.extraFiles?.find(
    (f) => f.path === 'src/modules/dashboard/billing-dashboard.controller.ts',
  );
  assert.ok(file, 'saas overlay must register the billing dashboard controller');

  const js = ts
    .transpileModule(file!.content, TS_OPTS)
    .outputText.replace(/import\s+['"]reflect-metadata['"];?/, '')
    .replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'const Controller = () => () => {}; const Get = () => () => {};',
    );

  const dir = mkdtempSync(join(tmpdir(), 'street-dashboard-test-'));
  writeFileSync(join(dir, 'dashboard.mjs'), js, 'utf8');

  const mod = await import(pathToFileURL(join(dir, 'dashboard.mjs')).href);

  return {
    BillingDashboardController: mod.BillingDashboardController as DashboardCtor,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// --- Fakes ------------------------------------------------------------------

/** A fake ctx that records exactly one render (template + data + status). */
function makeCtx(org: ActiveOrg | undefined): { ctx: FakeCtx; renders: RenderCapture[] } {
  const renders: RenderCapture[] = [];
  const ctx: FakeCtx = {
    org,
    htmx: {
      view: (template, data, status) => {
        renders.push({ template, data, status });
      },
    },
  };
  return { ctx, renders };
}

/** A fully-populated, single-tenant subscription service. */
function tenantSubscriptions(orgId: string): FakeSubscriptionService {
  return {
    listSubscriptions: async () => [
      { id: 's1', org_id: orgId, plan: 'pro', status: 'active', current_period_end: '2025-12-31' },
    ],
    paymentHistory: async () => [
      { id: 't1', org_id: orgId, reference: 'ref_a', amount: 5000, currency: 'UGX', status: 'completed' },
    ],
    listInvoices: async () => [
      { id: 'i1', org_id: orgId, amount: 5000, currency: 'UGX', issued_at: '2025-01-01' },
    ],
    listUsage: async () => [{ id: 'u1', org_id: orgId, metric: 'api_calls', quantity: 42 }],
  };
}

const planResolver: FakeBillingService = {
  resolvePlan: (planId) => (planId === 'pro' ? { id: 'pro', name: 'Pro Plan' } : null),
};

/** Concatenate every string value in the captured render data (the section HTML). */
function renderedHtml(data: Record<string, unknown>): string {
  return Object.values(data)
    .filter((v): v is string => typeof v === 'string')
    .join('\n');
}

// ---------------------------------------------------------------------------

describe('MarzPay billing dashboard controller', () => {
  let BillingDashboardController: DashboardCtor;
  let cleanup: () => void = () => {};

  before(async () => {
    const loaded = await loadDashboardController();
    BillingDashboardController = loaded.BillingDashboardController;
    cleanup = loaded.cleanup;
    assert.equal(
      typeof BillingDashboardController,
      'function',
      'BillingDashboardController must be importable from the overlay',
    );
  });

  after(() => cleanup());

  // ── Requirement 10.3: 403 with no billing data ──────────────────────────

  it('renders the forbidden view at 403 with no billing data for an unauthenticated caller — Validates: Requirement 10.3', async () => {
    const { ctx, renders } = makeCtx(undefined); // no ctx.org → unauthenticated
    const subs = tenantSubscriptions('org_a');
    const controller = new BillingDashboardController(planResolver, subs, {}, {}, {});

    await controller.dashboard(ctx);

    assert.equal(renders.length, 1, 'exactly one view is rendered');
    const render = renders[0]!;
    assert.equal(render.template, 'dashboard/forbidden', 'the forbidden view is rendered');
    assert.equal(render.status, 403, 'access is denied with a 403 status');

    // No section/billing data of any tenant may appear in the response data.
    const sectionKeys = ['currentPlan', 'billingStatus', 'transactions', 'invoices', 'usage', 'renewal'];
    for (const key of sectionKeys) {
      assert.ok(!(key in render.data), `forbidden render must not include section data "${key}"`);
    }
    const html = renderedHtml(render.data);
    assert.ok(!/data-section=/.test(html), 'no billing section markup may be present');
    assert.ok(!/ref_a/.test(html), 'no tenant billing data may be present');
  });

  it('renders the forbidden view at 403 with no billing data for a non-owner/admin role — Validates: Requirement 10.3', async () => {
    const { ctx, renders } = makeCtx({ id: 'org_a', slug: 'acme', role: 'member' });
    const subs = tenantSubscriptions('org_a');
    const controller = new BillingDashboardController(planResolver, subs, {}, {}, {});

    await controller.dashboard(ctx);

    assert.equal(renders.length, 1, 'exactly one view is rendered');
    const render = renders[0]!;
    assert.equal(render.template, 'dashboard/forbidden', 'the forbidden view is rendered for a member');
    assert.equal(render.status, 403, 'a non-owner/admin is denied with a 403 status');
    assert.ok(!('transactions' in render.data), 'no transactions section data may leak to a member');
    assert.ok(!/data-state=/.test(renderedHtml(render.data)), 'no section indicators may be present');
  });

  // ── Requirement 10.2: org-scoped population for owner/admin ──────────────

  for (const role of ['owner', 'admin'] as const) {
    it(`populates every section from the active tenant's records for an ${role} — Validates: Requirement 10.2`, async () => {
      const { ctx, renders } = makeCtx({ id: 'org_a', slug: 'acme', role });
      const subs = tenantSubscriptions('org_a');
      const controller = new BillingDashboardController(planResolver, subs, {}, {}, {});

      await controller.dashboard(ctx);

      assert.equal(renders.length, 1, 'exactly one view is rendered');
      const render = renders[0]!;
      assert.equal(render.template, 'dashboard/billing', 'the billing dashboard view is rendered');
      assert.notEqual(render.status, 403, 'an owner/admin is not denied');
      assert.equal(render.data.slug, 'acme');
      assert.equal(render.data.role, role);

      // Each section is present and populated from the tenant's own records.
      const html = renderedHtml(render.data);
      assert.ok(/Pro Plan/.test(html), 'current plan resolves the tenant subscription plan');
      assert.ok(/ref_a/.test(html), 'transactions render the tenant billing record reference');
      assert.ok(/api_calls/.test(html), 'usage renders the tenant usage metric');
      assert.ok(/2025-12-31/.test(html), 'renewal renders the tenant period end');

      // No empty-state or error indicators when every section has data.
      assert.ok(!/data-state="empty"/.test(html), 'no empty-state when sections have data');
      assert.ok(!/data-state="error"/.test(html), 'no error indicator when sources are available');
    });
  }

  // ── Requirement 10.5: empty-state indicator for an empty section ─────────

  it('renders an empty-state indicator for an empty section while other sections render — Validates: Requirement 10.5', async () => {
    const { ctx, renders } = makeCtx({ id: 'org_a', slug: 'acme', role: 'owner' });
    const subs = tenantSubscriptions('org_a');
    // Usage collection is empty for this tenant; other sections remain populated.
    subs.listUsage = async () => [];
    const controller = new BillingDashboardController(planResolver, subs, {}, {}, {});

    await controller.dashboard(ctx);

    const render = renders[0]!;
    assert.equal(render.template, 'dashboard/billing');
    const usage = String(render.data.usage ?? '');
    assert.ok(/data-state="empty"/.test(usage), 'the empty usage section renders an empty-state indicator');
    assert.ok(!/data-state="error"/.test(usage), 'an empty section is not an error');

    // The other sections still render their tenant data.
    const html = renderedHtml(render.data);
    assert.ok(/Pro Plan/.test(html), 'the current plan section still renders');
    assert.ok(/ref_a/.test(html), 'the transactions section still renders');
    assert.ok(/data-section="usage"/.test(usage), 'the usage section is still present as a section');
  });

  // ── Requirement 10.4: per-section error indicator, no cross-tenant data ──

  it('renders an error indicator for an unavailable section while other sections render and no other tenant data is substituted — Validates: Requirement 10.4', async () => {
    const { ctx, renders } = makeCtx({ id: 'org_a', slug: 'acme', role: 'owner' });
    const subs = tenantSubscriptions('org_a');
    // The invoices data source is unavailable for this tenant (load throws).
    subs.listInvoices = async () => {
      throw new Error('invoice store unavailable');
    };
    const controller = new BillingDashboardController(planResolver, subs, {}, {}, {});

    await controller.dashboard(ctx);

    const render = renders[0]!;
    assert.equal(render.template, 'dashboard/billing');
    const invoices = String(render.data.invoices ?? '');
    assert.ok(/data-state="error"/.test(invoices), 'the failing section renders an error indicator');
    assert.ok(/data-section="invoices"/.test(invoices), 'the failing section is still rendered as a section');
    assert.ok(!/data-state="empty"/.test(invoices), 'an unavailable section is not an empty-state');

    // The other sections still render their available tenant data.
    const html = renderedHtml(render.data);
    assert.ok(/Pro Plan/.test(html), 'the current plan section still renders');
    assert.ok(/ref_a/.test(html), 'the transactions section still renders');
    assert.ok(/api_calls/.test(html), 'the usage section still renders');

    // No other tenant's data may be substituted for the unavailable invoices.
    assert.ok(!/org_b|ref_b|other-tenant/.test(html), 'no foreign-tenant data may be substituted');
  });

  it('isolates failures per section: a failing section never aborts the whole dashboard — Validates: Requirements 10.4', async () => {
    const { ctx, renders } = makeCtx({ id: 'org_a', slug: 'acme', role: 'admin' });
    const subs = tenantSubscriptions('org_a');
    // Both the transactions and usage data sources are unavailable.
    subs.paymentHistory = async () => {
      throw new Error('billing store unavailable');
    };
    subs.listUsage = async () => {
      throw new Error('usage store unavailable');
    };
    const controller = new BillingDashboardController(planResolver, subs, {}, {}, {});

    await controller.dashboard(ctx);

    assert.equal(renders.length, 1, 'the dashboard still renders despite multiple failing sections');
    const render = renders[0]!;
    assert.ok(/data-state="error"/.test(String(render.data.transactions ?? '')), 'transactions error indicator');
    assert.ok(/data-state="error"/.test(String(render.data.usage ?? '')), 'usage error indicator');
    // The available sections still render their tenant data.
    assert.ok(/Pro Plan/.test(renderedHtml(render.data)), 'available sections still render');
  });
});
