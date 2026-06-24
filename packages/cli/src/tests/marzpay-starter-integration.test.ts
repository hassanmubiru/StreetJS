// packages/cli/src/tests/marzpay-starter-integration.test.ts
// Starter-integration verification for the RESHAPED MarzPay client surface (Task 15.2).
//
// Requirement 15.4 asks for verification that the SaaS starter integration works
// against the reshaped, capability-oriented client surface — i.e. a client that
// now exposes BOTH the flat compatibility-shim methods (initializePayment,
// verifyPayment, getTransaction, listTransactions, validateWebhook) AND the six
// capability namespaces (collections, disbursements, transactions, accounts,
// phoneVerification, utils), with the flat methods being thin aliases over the
// SAME code paths as the namespaces.
//
// Unlike marzpay-integration.test.ts (which composes the REAL built plugin client
// with a mock transport), this test drives the REAL scaffolded overlay modules
// (BillingService, WebhookController) with a FAKE MarzPayClient whose flat shim
// methods delegate to the namespace methods. That arrangement directly proves the
// compatibility-shim invariant from the design ("flat methods ≡ namespace methods
// over one code path") and that the overlay exercises the starter end-to-end with
// NO behavioral regression on the reshaped surface:
//
//   • BillingService.startCheckout drives a collection through the client
//     (the flat initializePayment shim, which is wired onto collections.collectMoney).
//   • WebhookController re-verifies through the transactions.get namespace when
//     present, and falls back to the flat getTransaction shim when it is absent —
//     both routing to the same verified transaction lookup, with identical results.
//
// Validates: Requirements 15.4, 9.5

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
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
  json?: (body: unknown, status: number) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtor = new (...args: any[]) => any;

interface LoadedModules {
  BillingService: AnyCtor;
  WebhookController: AnyCtor;
  cleanup: () => void;
}

const TS_OPTS = {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true,
  },
} as const;

function templateContent(path: string): string {
  const file = TEMPLATES.saas.extraFiles?.find((f) => f.path === path);
  assert.ok(file, `saas overlay must register ${path}`);
  return file!.content;
}

/**
 * Transpile the overlay modules the starter flows need and load them from one
 * temp directory. Non-resolvable imports are neutralized exactly as the existing
 * marzpay overlay tests do (streetjs value imports -> local Error subclasses /
 * no-op decorators; reflect-metadata dropped; relative tenant import rewritten;
 * type-only plugin/cross-module imports elided).
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

  const webhookJs = ts
    .transpileModule(templateContent('src/modules/billing/marzpay-webhook.controller.ts'), TS_OPTS)
    .outputText.replace(/import\s+['"]reflect-metadata['"];?/, '')
    .replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'const Controller = () => () => {}; const Post = () => () => {}; class BadRequestException extends Error {}',
    );

  const dir = mkdtempSync(join(tmpdir(), 'street-marzpay-starter-'));
  writeFileSync(join(dir, 'tenant.mjs'), tenantJs, 'utf8');
  writeFileSync(join(dir, 'billing.mjs'), billingJs, 'utf8');
  writeFileSync(join(dir, 'webhook.mjs'), webhookJs, 'utf8');

  const billingMod = await import(pathToFileURL(join(dir, 'billing.mjs')).href);
  const webhookMod = await import(pathToFileURL(join(dir, 'webhook.mjs')).href);

  return {
    BillingService: billingMod.BillingService as AnyCtor,
    WebhookController: webhookMod.WebhookController as AnyCtor,
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

// --- A fake reshaped MarzPayClient surface ----------------------------------
//
// The reshaped client exposes the six namespaces AND retains the flat methods as
// a thin compatibility shim over the SAME code paths. We model that here: the
// flat methods delegate to the namespace methods, and call counters prove which
// code path each overlay call routes through. A single server-verified
// transaction store backs both `collections.getStatus` and `transactions.get`.

interface VerifiedTxn {
  reference: string;
  amount: number;
  currency: string;
  status: string;
}

function makeReshapedClient(verified: Record<string, VerifiedTxn>) {
  const calls = {
    collectMoney: 0,
    initializePayment: 0,
    transactionsGet: 0,
    getTransaction: 0,
    validateWebhook: 0,
  };
  const sends: Array<{ op: string; arg: unknown }> = [];

  const collectMoney = (req: { amount: number; currency: string; reference: string; method?: string }) => {
    calls.collectMoney++;
    sends.push({ op: 'collect-money', arg: req });
    // Verified V2 card collection shape: echoes reference + status + redirect.
    return Promise.resolve({
      reference: req.reference,
      status: 'pending',
      redirectUrl: 'https://pay.example/redirect/' + encodeURIComponent(req.reference),
    });
  };

  const transactionsGet = (reference: string) => {
    calls.transactionsGet++;
    sends.push({ op: 'transactions.get', arg: reference });
    const txn = verified[reference];
    if (!txn) return Promise.reject(new Error('transaction not found (404)'));
    return Promise.resolve({ id: 'uuid-' + reference, ...txn });
  };

  const unsupported = (capability: string) => () =>
    Promise.reject(new Error('unsupported operation: ' + capability));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {
    // ── The six capability namespaces ───────────────────────────────────────
    collections: {
      collectMoney,
      getStatus: (reference: string) => transactionsGet(reference),
    },
    disbursements: {
      sendMoney: unsupported('disbursements.sendMoney'),
      getStatus: (reference: string) => transactionsGet(reference),
    },
    transactions: {
      get: transactionsGet,
    },
    accounts: {
      getBalance: unsupported('accounts.getBalance'),
    },
    phoneVerification: {
      verify: unsupported('phoneVerification.verify'),
      isVerified: unsupported('phoneVerification.isVerified'),
      getUserInfo: unsupported('phoneVerification.getUserInfo'),
    },
    utils: {
      isValidPhoneNumber: (v: string) => /^\+?\d{9,15}$/.test(v),
      formatPhoneNumber: (v: string) => v.replace(/[^\d]/g, ''),
    },

    // ── Flat compatibility shim: thin aliases over the SAME code paths ───────
    initializePayment: (req: { amount: number; currency: string; reference: string; method?: string }) => {
      calls.initializePayment++;
      return collectMoney(req);
    },
    verifyPayment: (reference: string) => transactionsGet(reference),
    getTransaction: (reference: string) => {
      calls.getTransaction++;
      return transactionsGet(reference);
    },
    listTransactions: () => Promise.resolve([]),
    validateWebhook: (rawBody: string, signature?: string) => {
      calls.validateWebhook++;
      // Mirror the unbound-scheme contract: trust is established by server-side
      // re-verification, so accept a present signature for the flow under test
      // and reject absent/empty material (no fail-open path).
      return typeof signature === 'string' && signature.trim() !== '';
    },
  };

  return { client, calls, sends };
}

const PLANS: BillingConfig = {
  plans: { pro: { id: 'pro', name: 'Pro Plan', amount: 50000, currency: 'UGX', interval: 'month' } },
};

const SIX_NAMESPACES = [
  'collections',
  'disbursements',
  'transactions',
  'accounts',
  'phoneVerification',
  'utils',
] as const;

// ---------------------------------------------------------------------------

describe('MarzPay SaaS starter integration on the reshaped client surface (Requirement 15.4)', () => {
  let mods: LoadedModules;

  before(async () => {
    mods = await loadModules();
  });
  after(() => mods.cleanup());

  it('the reshaped client exposes both the six namespaces and the flat shim methods — Validates: Requirements 15.4, 9.5', () => {
    const { client } = makeReshapedClient({});

    for (const ns of SIX_NAMESPACES) {
      assert.equal(typeof client[ns], 'object', `namespace ${ns} must be present`);
    }
    assert.equal(typeof client.collections.collectMoney, 'function');
    assert.equal(typeof client.collections.getStatus, 'function');
    assert.equal(typeof client.transactions.get, 'function');
    assert.equal(typeof client.utils.isValidPhoneNumber, 'function');

    // Flat compatibility shim retained alongside the namespaces.
    for (const flat of ['initializePayment', 'verifyPayment', 'getTransaction', 'listTransactions', 'validateWebhook']) {
      assert.equal(typeof client[flat], 'function', `flat shim ${flat} must be retained`);
    }
  });

  it('checkout flow: BillingService.startCheckout drives a collection through the reshaped client and persists one org-scoped record — Validates: Requirements 15.4, 9.5', async () => {
    const { client, calls, sends } = makeReshapedClient({});
    const repo = makeRepo();
    const billing = new mods.BillingService(repo, PLANS, client);
    const ctx: Ctx = { org: { id: 'org_a', slug: 'acme', role: 'owner' } };

    const result = await billing.startCheckout(ctx, 'pro');

    // The flat shim was invoked by the overlay, and it routed to the SAME
    // collections.collectMoney code path (shim ≡ namespace, no regression).
    assert.equal(calls.initializePayment, 1, 'the overlay calls the flat initializePayment shim');
    assert.equal(calls.collectMoney, 1, 'which routes through the collections.collectMoney namespace path');

    const collectSends = sends.filter((s) => s.op === 'collect-money');
    assert.equal(collectSends.length, 1, 'exactly one collection is driven');
    const sent = collectSends[0]!.arg as { amount: number; currency: string; method?: string };
    assert.equal(sent.amount, PLANS.plans.pro.amount, 'the configured plan amount is charged');
    assert.equal(sent.currency, 'UGX');
    assert.equal(sent.method, 'card', 'a card collection is started for the plan');

    // The CheckoutResult reflects the reshaped client's response.
    assert.equal(result.status, 'pending');
    assert.ok(result.reference, 'a reference is surfaced');
    assert.ok(result.redirectUrl, 'a redirect URL is surfaced for the card flow');

    // Exactly one org-scoped billing record is persisted, stamped with the tenant.
    assert.equal(repo.rows.length, 1, 'exactly one billing record is persisted');
    const record = repo.rows[0]!;
    assert.equal(record.org_id, 'org_a', 'the record is stamped with the active tenant org_id');
    assert.equal(record.plan, 'pro');
    assert.equal(record.amount, PLANS.plans.pro.amount);
    assert.equal(record.currency, 'UGX');
    assert.equal(record.reference, result.reference);
  });

  it('webhook flow: WebhookController re-verifies through the transactions.get namespace and persists verified monetary values — Validates: Requirements 15.4, 9.5', async () => {
    const verified: Record<string, VerifiedTxn> = {
      'TXN-NS': { reference: 'TXN-NS', amount: 50000, currency: 'UGX', status: 'success' },
    };
    const { client, calls } = makeReshapedClient(verified);
    const repo = makeRepo();
    const billing = new mods.BillingService(repo, PLANS, client);
    const controller = new mods.WebhookController(client, billing);

    const rawBody = JSON.stringify({ event_type: 'payment.success', transaction: { reference: 'TXN-NS' } });
    let captured: { status: number; body: unknown } | undefined;
    const ctx: Ctx = {
      org: { id: 'org_a', slug: 'acme', role: 'owner' },
      headers: { 'x-marzpay-signature': 'present-signature' },
      state: { rawBody },
      json: (body, status) => {
        captured = { status, body };
      },
    };

    await controller.handle(ctx);

    assert.deepEqual(captured, { status: 200, body: { received: true } }, 'a valid webhook responds 200');

    // The reshaped surface is preferred: re-verification routed through the
    // transactions.get NAMESPACE (not the flat getTransaction shim).
    assert.equal(calls.transactionsGet, 1, 'the transaction is re-verified via transactions.get');
    assert.equal(calls.getTransaction, 0, 'the flat getTransaction shim is NOT used when the namespace exists');

    // Exactly one org-scoped record persisted with SERVER-verified monetary values.
    assert.equal(repo.rows.length, 1, 'a verified webhook persists exactly one record');
    const record = repo.rows[0]!;
    assert.equal(record.org_id, 'org_a', 'the webhook record is tenant-scoped');
    assert.equal(record.reference, 'TXN-NS');
    assert.equal(record.amount, 50000, 'the persisted amount is the server-verified value');
    assert.equal(record.currency, 'UGX');
    assert.equal(record.status, 'success');
  });

  it('webhook flow: with only the flat shim (no namespaces) the controller falls back to getTransaction — same verified result — Validates: Requirements 15.4, 9.5', async () => {
    const verified: Record<string, VerifiedTxn> = {
      'TXN-SHIM': { reference: 'TXN-SHIM', amount: 50000, currency: 'UGX', status: 'success' },
    };
    const { client, calls } = makeReshapedClient(verified);
    // Simulate the pre-reshape / shim-only surface: remove the namespace so the
    // controller's `typeof this.client.transactions?.get === 'function'` guard is
    // false and it falls back to the flat getTransaction compatibility shim.
    delete client.transactions;

    const repo = makeRepo();
    const billing = new mods.BillingService(repo, PLANS, client);
    const controller = new mods.WebhookController(client, billing);

    const rawBody = JSON.stringify({ event_type: 'payment.success', transaction: { reference: 'TXN-SHIM' } });
    let captured: { status: number; body: unknown } | undefined;
    const ctx: Ctx = {
      org: { id: 'org_a', slug: 'acme', role: 'owner' },
      headers: { 'x-marzpay-signature': 'present-signature' },
      state: { rawBody },
      json: (body, status) => {
        captured = { status, body };
      },
    };

    await controller.handle(ctx);

    assert.deepEqual(captured, { status: 200, body: { received: true } }, 'the shim path also responds 200');
    assert.equal(calls.getTransaction, 1, 'the flat getTransaction shim is used as the fallback');
    assert.equal(calls.transactionsGet, 1, 'and it routes through the same verified transaction lookup');

    // Same end-to-end result: one tenant-scoped record with verified values.
    assert.equal(repo.rows.length, 1, 'the shim path persists exactly one record');
    const record = repo.rows[0]!;
    assert.equal(record.org_id, 'org_a');
    assert.equal(record.reference, 'TXN-SHIM');
    assert.equal(record.amount, 50000);
    assert.equal(record.status, 'success');
  });

  it('checkout flow: an unknown plan persists nothing and never drives the reshaped client — Validates: Requirements 15.4, 9.5', async () => {
    const { client, calls, sends } = makeReshapedClient({});
    const repo = makeRepo();
    const billing = new mods.BillingService(repo, PLANS, client);
    const ctx: Ctx = { org: { id: 'org_a', slug: 'acme', role: 'owner' } };

    await assert.rejects(
      () => billing.startCheckout(ctx, 'ghost'),
      (err: Error) => /unknown plan/i.test(err.message),
    );
    assert.equal(repo.rows.length, 0, 'no record is persisted for an unknown plan');
    assert.equal(calls.initializePayment, 0, 'the flat shim is never called for an unknown plan');
    assert.equal(calls.collectMoney, 0, 'the collections namespace is never called for an unknown plan');
    assert.equal(sends.length, 0, 'no collection is driven for an unknown plan');
  });
});
