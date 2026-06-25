// packages/cli/src/tests/marzpay-property-10-monetary-from-verified.pbt.test.ts
// Property-based test for design Property 10 (Task 11.10).
//
//   Property 10: Monetary values come only from the verified transaction
//   — for any webhook Raw_Body whose monetary fields (amount/currency/status)
//   DIFFER from the server-re-verified transaction for the same reference, the
//   persisted billing record's `amount`, `currency`, and `status` equal the
//   re-verified transaction's values and NEVER the Raw_Body's. The only value
//   the controller takes from the Raw_Body is `transaction.reference`.
//
//   Validates: Requirements 6.3
//
// Harness: this mirrors marzpay-integration.test.ts. It composes the REAL,
// separately-authored pieces end-to-end:
//   • the REAL plugin MarzPayClient (loaded from the built @streetjs/plugin-marzpay
//     dist) with a MOCK transport injected (no network);
//   • the REAL scaffolded overlay modules (orgScopedRepo tenant middleware,
//     BillingService, WebhookController), transpiled from their template strings
//     exactly as they ship in a generated project.
//
// A webhook scheme is bound on the spec so the REAL client.validateWebhook can
// accept a correctly-signed Raw_Body (MARZPAY_SPEC leaves it unbound). ctx.org
// is set directly (no OrgResolver wired) so recordPayment's orgScopedRepo write
// proceeds against the active tenant. fast-check generates, per run, a verified
// transaction and a Raw_Body whose amount/currency/status all DIFFER from it.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fc from 'fast-check';
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
type ActiveOrg = { id: string; slug?: string; role?: string };
type Ctx = {
  org?: ActiveOrg;
  headers?: Record<string, string | undefined>;
  state?: Record<string, unknown>;
  response?: { status: number; body: unknown };
  json?: (body: unknown, status: number) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCtor = new (...args: any[]) => any;

interface LoadedModules {
  BillingService: AnyCtor;
  WebhookController: AnyCtor;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MarzPayClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  MARZPAY_SPEC: any;
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
 * Transpile the overlay modules needed for the webhook persistence flow and
 * load them from one temp directory, neutralising non-resolvable imports
 * exactly as the existing marzpay overlay tests do. The REAL plugin
 * MarzPayClient is loaded from the built plugin dist.
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

  const dir = mkdtempSync(join(tmpdir(), 'street-marzpay-property10-'));
  writeFileSync(join(dir, 'tenant.mjs'), tenantJs, 'utf8');
  writeFileSync(join(dir, 'billing.mjs'), billingJs, 'utf8');
  writeFileSync(join(dir, 'webhook.mjs'), webhookJs, 'utf8');

  const billingMod = await import(pathToFileURL(join(dir, 'billing.mjs')).href);
  const webhookMod = await import(pathToFileURL(join(dir, 'webhook.mjs')).href);

  // The REAL plugin client from the built dist (sibling package in the workspace).
  const pluginUrl = new URL('../../../plugin-marzpay/dist/index.js', import.meta.url).href;
  const plugin = await import(pluginUrl);

  return {
    BillingService: billingMod.BillingService as AnyCtor,
    WebhookController: webhookMod.WebhookController as AnyCtor,
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

const CONFIG = { apiKey: 'ak', secretKey: 'sk-property10', environment: 'sandbox' as const };
const WEBHOOK_SCHEME = {
  signatureHeader: 'x-marzpay-signature',
  algorithm: 'sha256',
  encoding: 'hex',
} as const;
const PLANS = {
  plans: { pro: { id: 'pro', name: 'Pro Plan', amount: 50000, currency: 'UGX', interval: 'month' } },
};

interface VerifiedFields {
  amount: number;
  currency: string;
  status: string;
}

/**
 * Routes GET /transactions/* to a SERVER-VERIFIED transaction carrying the
 * supplied verified fields (the V2/V3 nested amount{raw,currency} shape). This
 * is the only re-verification source; the Raw_Body's monetary fields are never
 * consulted by the controller.
 */
function makeTransport(verified: VerifiedFields) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transport: any = (req: { method: string; url: string; body: string }) => {
    transport.requests.push(req);
    if (req.method === 'GET' && req.url.includes('/transactions/')) {
      const reference = decodeURIComponent(req.url.split('/transactions/')[1] ?? '');
      return Promise.resolve({
        status: 200,
        body: JSON.stringify({
          transaction: {
            uuid: 'uuid-' + reference,
            reference,
            amount: { raw: verified.amount, currency: verified.currency },
            status: verified.status,
          },
        }),
      });
    }
    return Promise.resolve({ status: 404, body: '{}' });
  };
  transport.requests = [] as Array<{ method: string; url: string; body: string }>;
  return transport;
}

// --- Generators -------------------------------------------------------------

const CURRENCIES = ['UGX', 'KES', 'USD', 'TZS', 'RWF', 'NGN'] as const;
const STATUSES = ['success', 'failed', 'pending', 'cancelled', 'reversed'] as const;

// A pair of monetary triples that DIFFER in every field (amount, currency,
// status). Built by generating the verified triple plus per-field deltas so the
// Raw_Body always carries genuinely different monetary values.
const divergingMonetaryArb = fc
  .record({
    verifiedAmount: fc.integer({ min: 1, max: 1_000_000_000 }),
    amountDelta: fc.integer({ min: 1, max: 1_000_000 }),
    verifiedCurrencyIdx: fc.integer({ min: 0, max: CURRENCIES.length - 1 }),
    currencyShift: fc.integer({ min: 1, max: CURRENCIES.length - 1 }),
    verifiedStatusIdx: fc.integer({ min: 0, max: STATUSES.length - 1 }),
    statusShift: fc.integer({ min: 1, max: STATUSES.length - 1 }),
  })
  .map((g) => {
    const verified: VerifiedFields = {
      amount: g.verifiedAmount,
      currency: CURRENCIES[g.verifiedCurrencyIdx]!,
      status: STATUSES[g.verifiedStatusIdx]!,
    };
    const rawBodyFields: VerifiedFields = {
      amount: g.verifiedAmount + g.amountDelta, // always differs (delta >= 1)
      currency: CURRENCIES[(g.verifiedCurrencyIdx + g.currencyShift) % CURRENCIES.length]!,
      status: STATUSES[(g.verifiedStatusIdx + g.statusShift) % STATUSES.length]!,
    };
    return { verified, rawBodyFields };
  });

const referenceArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,32}$/);
const eventTypeArb = fc.constantFrom('payment.success', 'payment.failed', 'payment.pending');

// ---------------------------------------------------------------------------

describe('Property 10: Monetary values come only from the verified transaction (Requirements 6.3)', () => {
  let mods: LoadedModules;

  before(async () => {
    mods = await loadModules();
  });
  after(() => mods.cleanup());

  it('persists amount/currency/status from the re-verified transaction, never the Raw_Body', async () => {
    // Feature: marzpay-scope-alignment, Property 10: Monetary values come only from the verified transaction
    await fc.assert(
      fc.asyncProperty(
        referenceArb,
        eventTypeArb,
        divergingMonetaryArb,
        async (reference, eventType, { verified, rawBodyFields }) => {
          // Sanity: the generator must produce genuinely divergent monetary fields.
          assert.notEqual(rawBodyFields.amount, verified.amount);
          assert.notEqual(rawBodyFields.currency, verified.currency);
          assert.notEqual(rawBodyFields.status, verified.status);

          const transport = makeTransport(verified);
          // Bind a webhook scheme so the REAL client.validateWebhook can accept a
          // correctly-signed body (MARZPAY_SPEC leaves it unbound).
          const spec = { ...mods.MARZPAY_SPEC, webhook: WEBHOOK_SCHEME };
          const client = new mods.MarzPayClient(CONFIG, spec, transport);
          const repo = makeRepo();
          const billing = new mods.BillingService(repo, PLANS, client);
          // No OrgResolver wired: the controller relies on the ambient ctx.org.
          const controller = new mods.WebhookController(client, billing);

          // The Raw_Body carries monetary fields that DIFFER from the verified
          // transaction; only transaction.reference is honoured by the controller.
          const rawBody = JSON.stringify({
            event_type: eventType,
            amount: rawBodyFields.amount,
            currency: rawBodyFields.currency,
            status: rawBodyFields.status,
            transaction: {
              reference,
              amount: rawBodyFields.amount,
              currency: rawBodyFields.currency,
              status: rawBodyFields.status,
            },
          });
          const signature = createHmac('sha256', CONFIG.secretKey)
            .update(rawBody, 'utf8')
            .digest('hex');

          let captured: { status: number; body: unknown } | undefined;
          const ctx: Ctx = {
            org: { id: 'org_property10', slug: 'acme', role: 'owner' },
            headers: { 'x-marzpay-signature': signature },
            state: { rawBody },
            json: (body, status) => {
              captured = { status, body };
            },
          };

          await controller.handle(ctx);

          // The signed, re-verifiable webhook is accepted and persisted.
          assert.deepEqual(captured, { status: 200, body: { received: true } });
          assert.equal(repo.rows.length, 1, 'exactly one billing record is persisted');
          const record = repo.rows[0]!;

          // Persisted monetary values EQUAL the re-verified transaction's values.
          assert.equal(record.amount, verified.amount, 'amount is the verified value');
          assert.equal(record.currency, verified.currency, 'currency is the verified value');
          assert.equal(record.status, verified.status, 'status is the verified value');

          // Persisted monetary values are NEVER the Raw_Body's values.
          assert.notEqual(record.amount, rawBodyFields.amount, 'amount is never the Raw_Body amount');
          assert.notEqual(
            record.currency,
            rawBodyFields.currency,
            'currency is never the Raw_Body currency',
          );
          assert.notEqual(record.status, rawBodyFields.status, 'status is never the Raw_Body status');

          // The only Raw_Body value used is transaction.reference, carried through
          // to the persisted record verbatim.
          assert.equal(record.reference, reference, 'the reference is carried from the Raw_Body');
        },
      ),
      { numRuns: 200 },
    );
  });
});
