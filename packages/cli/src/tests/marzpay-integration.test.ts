// packages/cli/src/tests/marzpay-integration.test.ts
// Integration tests for the MarzPay SaaS integration (Requirement 14.2).
//
// These compose the REAL, separately-authored pieces end-to-end:
//   • the REAL plugin MarzPayClient (loaded from the built
//     @streetjs/plugin-marzpay dist) with a MOCK transport injected (no network);
//   • the REAL scaffolded overlay modules (orgScopedRepo tenant middleware,
//     BillingService, SubscriptionService, WebhookController, and the billing
//     dashboard controller), transpiled from their template strings exactly as
//     they ship in a generated project.
//
// Three flows are covered, each tenant-scoped:
//   1. Checkout flow            — startCheckout -> MarzPay initialize -> org-scoped record.
//   2. Webhook processing       — validate-before-persist -> re-verify -> org-scoped record.
//   3. SaaS billing flow        — plan resolution + persistence + tenant-scoped dashboard read.
//
// Validates: Requirements 14.2, 6.3, 6.4, 6.5, 6.7, 6.8, 10.2

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { transpileModule, ModuleKind, ScriptTarget } from './ts-transpile-helper.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

// --- Shared structural contracts (mirrors of the scaffolded shapes) ---------

interface OrgScopedRow {
  org_id: string;
  [k: string]: unknown;
}
interface Repo<T extends OrgScopedRow> {
  find(filter: Record<string, unknown>): Promise<T[]>;
  findOne(filter: Record<string, unknown>): Promise<T | null>;
  insert(values: Partial<T>): Promise<T>;
  update(filter: Record<string, unknown>, values: Partial<T>): Promise<T>;
}
interface PlanDefinition {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
}
interface BillingConfig {
  plans: Record<string, PlanDefinition>;
}
type ActiveOrg = { id: string; slug: string; role: string };
type Ctx = {
  org?: ActiveOrg;
  headers?: Record<string, string | undefined>;
  state?: Record<string, unknown>;
  response?: { status: number; body: unknown };
  json?: (body: unknown, status: number) => void;
  htmx?: { view: (template: string, data: Record<string, unknown>, status?: number) => void };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtor = new (...args: any[]) => any;

interface LoadedModules {
  BillingService: AnyCtor;
  SubscriptionService: AnyCtor;
  WebhookController: AnyCtor;
  BillingDashboardController: AnyCtor;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MarzPayClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MARZPAY_SPEC: any;
  cleanup: () => void;
}

const TS_OPTS = {
  compilerOptions: {
    module: ModuleKind.ESNext,
    target: ScriptTarget.ES2022,
    experimentalDecorators: true,
  },
} as const;

function templateContent(path: string): string {
  const file = TEMPLATES.saas.extraFiles?.find((f) => f.path === path);
  assert.ok(file, `saas overlay must register ${path}`);
  return file!.content;
}

/**
 * Transpile every overlay module needed for the integration flows and load them
 * from one temp directory. Non-resolvable imports are neutralized exactly as the
 * existing marzpay overlay tests do:
 *   - `streetjs` value imports -> local Error subclasses / no-op decorators.
 *   - `reflect-metadata` is dropped.
 *   - relative `../../middleware/tenant.js` -> the sibling `./tenant.mjs`.
 *   - `@streetjs/plugin-marzpay` and cross-module imports are type-only -> elided.
 * The REAL plugin MarzPayClient is loaded from the built plugin dist.
 */
async function loadModules(): Promise<LoadedModules> {
  const tenantJs = ts
    .transpileModule(templateContent('src/middleware/tenant.ts'), TS_OPTS)
    .outputText.replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'class ForbiddenException extends Error {} class UnauthorizedException extends Error {}',
    );

  const billingJs = ts
    .transpileModule(templateContent('src/modules/billing/marzpay-billing.service.ts'), TS_OPTS)
    .outputText.replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'class BadRequestException extends Error {}',
    )
    .replace(/['"]\.\.\/\.\.\/middleware\/tenant\.js['"]/, "'./tenant.mjs'");

  const subscriptionJs = ts
    .transpileModule(templateContent('src/modules/billing/marzpay-subscription.service.ts'), TS_OPTS)
    .outputText.replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'class BadRequestException extends Error {}',
    )
    .replace(/['"]\.\.\/\.\.\/middleware\/tenant\.js['"]/, "'./tenant.mjs'");

  const webhookJs = ts
    .transpileModule(templateContent('src/modules/billing/marzpay-webhook.controller.ts'), TS_OPTS)
    .outputText.replace(/import\s+['"]reflect-metadata['"];?/, '')
    .replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'const Controller = () => () => {}; const Post = () => () => {}; class BadRequestException extends Error {}',
    );

  const dashboardJs = ts
    .transpileModule(templateContent('src/modules/dashboard/billing-dashboard.controller.ts'), TS_OPTS)
    .outputText.replace(/import\s+['"]reflect-metadata['"];?/, '')
    .replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'const Controller = () => () => {}; const Get = () => () => {};',
    );

  const dir = mkdtempSync(join(tmpdir(), 'street-marzpay-integration-'));
  writeFileSync(join(dir, 'tenant.mjs'), tenantJs, 'utf8');
  writeFileSync(join(dir, 'billing.mjs'), billingJs, 'utf8');
  writeFileSync(join(dir, 'subscription.mjs'), subscriptionJs, 'utf8');
  writeFileSync(join(dir, 'webhook.mjs'), webhookJs, 'utf8');
  writeFileSync(join(dir, 'dashboard.mjs'), dashboardJs, 'utf8');

  const billingMod = await import(pathToFileURL(join(dir, 'billing.mjs')).href);
  const subscriptionMod = await import(pathToFileURL(join(dir, 'subscription.mjs')).href);
  const webhookMod = await import(pathToFileURL(join(dir, 'webhook.mjs')).href);
  const dashboardMod = await import(pathToFileURL(join(dir, 'dashboard.mjs')).href);

  // The REAL plugin client from the built dist (sibling package in the workspace).
  const pluginUrl = new URL('../../../plugin-marzpay/dist/index.js', import.meta.url).href;
  const plugin = await import(pluginUrl);

  return {
    BillingService: billingMod.BillingService as AnyCtor,
    SubscriptionService: subscriptionMod.SubscriptionService as AnyCtor,
    WebhookController: webhookMod.WebhookController as AnyCtor,
    BillingDashboardController: dashboardMod.BillingDashboardController as AnyCtor,
    MarzPayClient: plugin.MarzPayClient,
    MARZPAY_SPEC: plugin.MARZPAY_SPEC,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// --- In-memory org-scoped backing repository --------------------------------

function rowMatches(row: OrgScopedRow, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => row[k] === v);
}
function makeRepo<T extends OrgScopedRow>(): Repo<T> & { rows: T[] } {
  const rows: T[] = [];
  let seq = 0;
  return {
    rows,
    async find(filter) {
      return rows.filter((r) => rowMatches(r, filter));
    },
    async findOne(filter) {
      return rows.find((r) => rowMatches(r, filter)) ?? null;
    },
    async insert(values) {
      const row = { id: (values as { id?: string }).id ?? `row_${++seq}`, ...(values as T) };
      rows.push(row);
      return row;
    },
    async update(filter, values) {
      const row = rows.find((r) => rowMatches(r, filter));
      if (!row) throw new Error('update target not found');
      Object.assign(row, values);
      return row;
    },
  };
}

// --- A mock transport for the REAL MarzPayClient ----------------------------

const BASE_URL = 'https://wallet.wearemarz.com/api/v1';
const WEBHOOK_SCHEME = { signatureHeader: 'x-marzpay-signature', algorithm: 'sha256', encoding: 'hex' } as const;

/**
 * Routes the verified MarzPay requests the flows use:
 *   - POST /collect-money  -> echoes the sent reference + a pending status + redirect.
 *   - GET  /transactions/* -> returns a server-verified transaction for re-verification.
 * Records each request so flows can assert what was sent.
 */
function makeTransport() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transport: any = (req: { method: string; url: string; body: string }) => {
    transport.requests.push(req);
    if (req.method === 'POST' && req.url.endsWith('/collect-money')) {
      const sent = JSON.parse(req.body) as { reference: string };
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({
          data: {
            transaction: { reference: sent.reference, status: 'pending' },
            redirect_url: 'https://pay.example/redirect/' + sent.reference,
          },
        }),
      });
    }
    if (req.method === 'GET' && req.url.includes('/transactions/')) {
      const reference = decodeURIComponent(req.url.split('/transactions/')[1] ?? '');
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({
          transaction: { uuid: 'uuid-' + reference, reference, amount: { raw: 50000, currency: 'UGX' }, status: 'success' },
        }),
      });
    }
    return Promise.resolve({ status: 404, body: '{}' });
  };
  transport.requests = [] as Array<{ method: string; url: string; body: string }>;
  return transport;
}

const CONFIG = { apiKey: 'ak', secretKey: 'sk-integration', environment: 'sandbox' as const };
const PLANS: BillingConfig = {
  plans: { pro: { id: 'pro', name: 'Pro Plan', amount: 50000, currency: 'UGX', interval: 'month' } },
};

function renderedHtml(data: Record<string, unknown>): string {
  return Object.values(data)
    .filter((v): v is string => typeof v === 'string')
    .join('\n');
}

// ---------------------------------------------------------------------------

describe('MarzPay integration (Requirement 14.2)', () => {
  let mods: LoadedModules;

  before(async () => {
    mods = await loadModules();
  });
  after(() => mods.cleanup());

  // ── 1. Checkout flow ──────────────────────────────────────────────────────
  it('checkout flow: startCheckout initializes MarzPay and persists one org-scoped record — Validates: Requirements 14.2, 6.5, 6.7, 6.8', async () => {
    const transport = makeTransport();
    const client = new mods.MarzPayClient(CONFIG, mods.MARZPAY_SPEC, transport);
    const repo = makeRepo();
    const billing = new mods.BillingService(repo, PLANS, client);
    const ctx: Ctx = { org: { id: 'org_a', slug: 'acme', role: 'owner' } };

    const result = await billing.startCheckout(ctx, 'pro');

    // The verified POST /collect-money request was sent with the plan's amount.
    const posts = transport.requests.filter((r: { url: string }) => r.url.endsWith('/collect-money'));
    assert.equal(posts.length, 1, 'exactly one collect-money request is sent');
    assert.equal(posts[0].url, BASE_URL + '/collect-money');
    const sentBody = JSON.parse(posts[0].body);
    assert.equal(sentBody.amount, PLANS.plans.pro.amount, 'the configured plan amount is charged');
    assert.equal(sentBody.method, 'card', 'a card collection is started for the plan');

    // The CheckoutResult reflects the MarzPay response.
    assert.equal(result.status, 'pending');
    assert.equal(result.reference, sentBody.reference);
    assert.ok(result.redirectUrl, 'a redirect URL is surfaced for the card flow');

    // Exactly one org-scoped billing record is persisted, stamped with the tenant.
    assert.equal(repo.rows.length, 1, 'exactly one billing record is persisted');
    const record = repo.rows[0]!;
    assert.equal(record.org_id, 'org_a', 'the record is stamped with the active tenant org_id');
    assert.equal(record.plan, 'pro');
    assert.equal(record.amount, PLANS.plans.pro.amount);
    assert.equal(record.currency, 'UGX');
    assert.equal(record.reference, sentBody.reference);
  });

  it('checkout flow: an unknown plan persists nothing and never calls MarzPay — Validates: Requirement 6.6', async () => {
    const transport = makeTransport();
    const client = new mods.MarzPayClient(CONFIG, mods.MARZPAY_SPEC, transport);
    const repo = makeRepo();
    const billing = new mods.BillingService(repo, PLANS, client);
    const ctx: Ctx = { org: { id: 'org_a', slug: 'acme', role: 'owner' } };

    await assert.rejects(
      () => billing.startCheckout(ctx, 'ghost'),
      (err: Error) => /unknown plan/i.test(err.message),
    );
    assert.equal(repo.rows.length, 0, 'no record is persisted for an unknown plan');
    assert.equal(transport.requests.length, 0, 'MarzPay is never called for an unknown plan');
  });

  // ── 2. Webhook processing ────────────────────────────────────────────────
  it('webhook processing: a validly-signed webhook re-verifies and persists an org-scoped record — Validates: Requirements 14.2, 6.3, 6.8', async () => {
    const transport = makeTransport();
    // Bind a webhook scheme so the REAL client.validateWebhook can verify a
    // signed payload (MARZPAY_SPEC leaves it unbound; the controller flow itself
    // is identical — validate THEN re-verify THEN persist).
    const spec = { ...mods.MARZPAY_SPEC, webhook: WEBHOOK_SCHEME };
    const client = new mods.MarzPayClient(CONFIG, spec, transport);
    const repo = makeRepo();
    const billing = new mods.BillingService(repo, PLANS, client);
    const controller = new mods.WebhookController(client, billing);

    const rawBody = JSON.stringify({ event_type: 'payment.success', transaction: { reference: 'TXN-77' } });
    const signature = createHmac('sha256', CONFIG.secretKey).update(rawBody, 'utf8').digest('hex');

    let captured: { status: number; body: unknown } | undefined;
    const ctx: Ctx = {
      org: { id: 'org_a', slug: 'acme', role: 'owner' },
      headers: { 'x-marzpay-signature': signature },
      state: { rawBody },
      json: (body, status) => {
        captured = { status, body };
      },
    };

    await controller.handle(ctx);

    assert.deepEqual(captured, { status: 200, body: { received: true } }, 'a valid webhook responds 200');

    // Re-verification: the transaction was re-fetched server-side (GET /transactions).
    const gets = transport.requests.filter((r: { url: string }) => r.url.includes('/transactions/'));
    assert.equal(gets.length, 1, 'the transaction is re-verified exactly once');

    // Exactly one org-scoped record persisted with the SERVER-verified amount,
    // not any amount from the (unsigned) payload body.
    assert.equal(repo.rows.length, 1, 'a verified webhook persists exactly one record');
    const record = repo.rows[0]!;
    assert.equal(record.org_id, 'org_a', 'the webhook record is tenant-scoped');
    assert.equal(record.reference, 'TXN-77');
    assert.equal(record.amount, 50000, 'the persisted amount is the server-verified value');
    assert.equal(record.status, 'success');
  });

  it('webhook processing: a tampered/invalid webhook is rejected and persists nothing — Validates: Requirement 6.4', async () => {
    const transport = makeTransport();
    const spec = { ...mods.MARZPAY_SPEC, webhook: WEBHOOK_SCHEME };
    const client = new mods.MarzPayClient(CONFIG, spec, transport);
    const repo = makeRepo();
    const billing = new mods.BillingService(repo, PLANS, client);
    const controller = new mods.WebhookController(client, billing);

    const originalBody = JSON.stringify({ event_type: 'payment.success', transaction: { reference: 'TXN-88' } });
    const signature = createHmac('sha256', CONFIG.secretKey).update(originalBody, 'utf8').digest('hex');
    // Deliver a body mutated AFTER signing — the signature no longer matches.
    const tamperedBody = originalBody.replace('TXN-88', 'TXN-EVIL');

    let captured: { status: number; body: unknown } | undefined;
    const ctx: Ctx = {
      org: { id: 'org_a', slug: 'acme', role: 'owner' },
      headers: { 'x-marzpay-signature': signature },
      state: { rawBody: tamperedBody },
      json: (body, status) => {
        captured = { status, body };
      },
    };

    await controller.handle(ctx);

    assert.deepEqual(
      captured,
      { status: 400, body: { error: 'webhook validation failed' } },
      'an invalid webhook is rejected with a 400',
    );
    assert.equal(repo.rows.length, 0, 'a rejected webhook persists NOTHING');
    assert.equal(
      transport.requests.length,
      0,
      'no re-verification (or any MarzPay call) happens when validation fails',
    );
  });

  // ── 3. SaaS billing flow (plan resolution + persistence + dashboard read) ──
  it('SaaS billing flow: persisted records surface tenant-scoped on the dashboard with resolved plan — Validates: Requirements 14.2, 10.2', async () => {
    const transport = makeTransport();
    const client = new mods.MarzPayClient(CONFIG, mods.MARZPAY_SPEC, transport);

    // Shared org-scoped repositories.
    const billingRepo = makeRepo();
    const subscriptionRepo = makeRepo();
    const invoiceRepo = makeRepo();
    const usageRepo = makeRepo();

    const billing = new mods.BillingService(billingRepo, PLANS, client);
    const subscriptions = new mods.SubscriptionService(subscriptionRepo, PLANS);
    const dashboard = new mods.BillingDashboardController(
      billing,
      subscriptions,
      invoiceRepo,
      billingRepo,
      usageRepo,
    );

    const orgA: Ctx = { org: { id: 'org_a', slug: 'acme', role: 'owner' } };
    const orgB: Ctx = { org: { id: 'org_b', slug: 'other', role: 'owner' } };

    // Tenant A: subscribe (plan resolution) and run a checkout (persistence).
    await subscriptions.create(orgA, 'pro');
    const checkout = await billing.startCheckout(orgA, 'pro');

    // Dashboard read for tenant A: shows the resolved plan + its own record.
    const rendersA: Array<{ template: string; data: Record<string, unknown>; status?: number }> = [];
    const ctxA: Ctx = { ...orgA, htmx: { view: (template, data, status) => rendersA.push({ template, data, status }) } };
    await dashboard.dashboard(ctxA);

    assert.equal(rendersA.length, 1, 'the dashboard renders once');
    assert.equal(rendersA[0]!.template, 'dashboard/billing', 'an owner sees the billing dashboard');
    const htmlA = renderedHtml(rendersA[0]!.data);
    assert.ok(/Pro Plan/.test(htmlA), 'plan resolution shows the configured plan name');
    assert.ok(htmlA.includes(checkout.reference), 'the tenant\'s own billing record reference appears');

    // Dashboard read for tenant B: sees NONE of tenant A's data.
    const rendersB: Array<{ template: string; data: Record<string, unknown>; status?: number }> = [];
    const ctxB: Ctx = { ...orgB, htmx: { view: (template, data, status) => rendersB.push({ template, data, status }) } };
    await dashboard.dashboard(ctxB);

    const htmlB = renderedHtml(rendersB[0]!.data);
    assert.ok(!htmlB.includes(checkout.reference), 'tenant B must not see tenant A\'s billing record');
    assert.ok(!/org_a/.test(htmlB), 'no tenant A identifier may leak into tenant B\'s dashboard');

    // Persistence is itself tenant-scoped: both writes are stamped to org_a.
    assert.equal(billingRepo.rows.length, 1);
    assert.equal(billingRepo.rows[0]!.org_id, 'org_a');
    assert.equal(subscriptionRepo.rows.length, 1);
    assert.equal(subscriptionRepo.rows[0]!.org_id, 'org_a');
  });
});
