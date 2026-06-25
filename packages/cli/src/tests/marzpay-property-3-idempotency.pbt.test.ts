// packages/cli/src/tests/marzpay-property-3-idempotency.pbt.test.ts
// Property-based test for the SaaS MarzPay webhook idempotency guarantee
// (marzpay-scope-alignment, design Property 3).
//
//   Feature: marzpay-scope-alignment, Property 3: Webhook processing is
//   idempotent (including concurrent delivery)
//
//   For any verified webhook event with reference `r`, processing that event two
//   or more times — sequentially OR concurrently — applies the billing-state
//   write AT MOST ONCE: the Processed_Event_Store (marzpay_events) and
//   billing_records each contain EXACTLY ONE row for `r`, and the credited
//   amount is applied a single time.
//
//   **Validates: Requirements 7.2, 7.3, 14.5**
//
// The webhook controller, billing service, and tenant repo all ship as overlay
// TEMPLATE STRINGS in `TEMPLATES.saas.extraFiles` (they are NOT top-level
// exports of create.ts). To exercise the REAL scaffolded behaviour rather than a
// re-implementation, this test extracts those template strings, transpiles them
// to ESM, neutralises their non-resolvable imports (`reflect-metadata`,
// `streetjs`, `@streetjs/plugin-marzpay`, the relative `tenant.js`), and
// dynamically imports the result. The property then drives the REAL
// `WebhookController.handle(ctx)` — including its check-and-record-in-one-
// transaction idempotency block and the REAL `orgScopedEventStore` +
// `BillingService.recordPayment` writes — over in-memory backings whose event
// and billing inserts enforce the same `UNIQUE(reference)` constraint the
// migration (005) establishes, so a concurrent second insert loses the race.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

// ── Structural mirrors of the scaffolded contracts (types only) ────────────

interface BillingRecord {
  id?: string;
  org_id: string;
  plan: string;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  created_at: string;
}

interface ProcessedEvent {
  reference: string;
  org_id: string;
  processed_at: string;
}

type Tx = unknown;

interface Repo {
  find(filter: Record<string, unknown>): Promise<BillingRecord[]>;
  findOne(filter: Record<string, unknown>): Promise<BillingRecord | null>;
  insert(values: Partial<BillingRecord>): Promise<BillingRecord>;
  update(filter: Record<string, unknown>, values: Partial<BillingRecord>): Promise<BillingRecord>;
}

interface EventRowGateway {
  exists(tx: Tx, filter: { org_id: string; reference: string }): Promise<boolean>;
  insert(tx: Tx, row: ProcessedEvent): Promise<void>;
}

interface ProcessedEventStore {
  hasProcessed(tx: Tx, reference: string): Promise<boolean>;
  recordProcessed(tx: Tx, reference: string): Promise<void>;
}

interface UnitOfWork {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}

interface VerifiedTransaction {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
}

interface FakeContext {
  headers: Record<string, string | undefined>;
  state: Record<string, unknown>;
  org?: { id: string };
  responses: Array<{ body: unknown; status: number }>;
  json(body: unknown, status: number): void;
}

type BillingServiceCtor = new (repo: Repo, plans: unknown, client: unknown) => {
  recordPayment(ctx: FakeContext, event: VerifiedWebhookEvent): Promise<BillingRecord>;
};

interface VerifiedWebhookEvent {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  plan?: string;
}

type OrgScopedEventStoreFn = (gateway: EventRowGateway, orgId: string) => ProcessedEventStore;

type WebhookControllerCtor = new (
  client: unknown,
  billing: InstanceType<BillingServiceCtor>,
  events?: ProcessedEventStore,
  uow?: UnitOfWork,
  orgResolver?: unknown,
) => { handle(ctx: FakeContext): Promise<void> };

const TS_OPTS = {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    experimentalDecorators: true,
  },
} as const;

function templateContent(relPath: string): string {
  const entry = TEMPLATES.saas.extraFiles?.find((f) => f.path === relPath);
  assert.ok(entry, `overlay template "${relPath}" must be registered in TEMPLATES.saas.extraFiles`);
  return entry!.content;
}

let BillingService: BillingServiceCtor;
let WebhookController: WebhookControllerCtor;
let orgScopedEventStore: OrgScopedEventStoreFn;
let tempDir: string;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'marzpay-property-3-'));

  // 1) tenant.ts -> tenant.mjs (only the exception classes are used at runtime).
  const tenantJs = ts
    .transpileModule(templateContent('src/middleware/tenant.ts'), TS_OPTS)
    .outputText.replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'class ForbiddenException extends Error {} class UnauthorizedException extends Error {}',
    );

  // 2) marzpay-billing.service.ts -> billing.mjs (BillingService + orgScopedEventStore).
  const billingJs = ts
    .transpileModule(templateContent('src/modules/billing/marzpay-billing.service.ts'), TS_OPTS)
    .outputText.replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'class BadRequestException extends Error {}',
    )
    .replace(/['"]\.\.\/\.\.\/middleware\/tenant\.js['"]/, "'./tenant.mjs'");

  // 3) marzpay-webhook.controller.ts -> controller.mjs.
  //    - drop the reflect-metadata side-effect import (no decorator metadata emitted),
  //    - replace the streetjs value import with no-op decorators + BadRequestException,
  //    - the @streetjs/plugin-marzpay and ./marzpay-billing.service.js imports are
  //      type-only and elided by transpilation.
  const controllerJs = ts
    .transpileModule(templateContent('src/modules/billing/marzpay-webhook.controller.ts'), TS_OPTS)
    .outputText.replace(/import\s*['"]reflect-metadata['"];?/, '')
    .replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'const Controller = () => () => {}; const Post = () => () => {}; class BadRequestException extends Error {}',
    )
    .replace(/import\s*\{[^}]*\}\s*from\s*['"]@streetjs\/plugin-marzpay['"];?/, '')
    .replace(/import\s*(?:type\s*)?\{[^}]*\}\s*from\s*['"]\.\/marzpay-billing\.service\.js['"];?/, '');

  writeFileSync(join(tempDir, 'tenant.mjs'), tenantJs, 'utf8');
  writeFileSync(join(tempDir, 'billing.mjs'), billingJs, 'utf8');
  writeFileSync(join(tempDir, 'controller.mjs'), controllerJs, 'utf8');

  const billingMod = await import(pathToFileURL(join(tempDir, 'billing.mjs')).href);
  const controllerMod = await import(pathToFileURL(join(tempDir, 'controller.mjs')).href);

  BillingService = billingMod.BillingService as BillingServiceCtor;
  orgScopedEventStore = billingMod.orgScopedEventStore as OrgScopedEventStoreFn;
  WebhookController = controllerMod.WebhookController as WebhookControllerCtor;

  assert.equal(typeof BillingService, 'function', 'BillingService must load from the overlay template');
  assert.equal(typeof orgScopedEventStore, 'function', 'orgScopedEventStore must load from the overlay template');
  assert.equal(typeof WebhookController, 'function', 'WebhookController must load from the overlay template');
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Fresh in-memory backing for one webhook controller. Both the billing repo and
 * the marzpay_events gateway enforce a synchronous UNIQUE(reference) check that
 * THROWS on a duplicate insert, faithfully modelling the migration-005 unique
 * constraints. Because the check-then-push runs with no intervening await, it is
 * atomic on the single JS thread, so a concurrent second delivery loses the race
 * exactly as the real DB constraint resolves it.
 */
function makeBacking(orgId: string) {
  const billingRows: BillingRecord[] = [];
  const eventRows: ProcessedEvent[] = [];

  const repo: Repo = {
    find: async (filter) => {
      const ref = (filter as { reference?: string }).reference;
      return billingRows.filter((r) => ref === undefined || r.reference === ref);
    },
    findOne: async (filter) => {
      const ref = (filter as { reference?: string }).reference;
      return billingRows.find((r) => r.reference === ref) ?? null;
    },
    insert: async (values) => {
      const ref = String((values as BillingRecord).reference);
      // UNIQUE(reference) on billing_records (migration 005).
      if (billingRows.some((r) => r.reference === ref)) {
        throw new Error('UNIQUE constraint failed: billing_records.reference');
      }
      const row: BillingRecord = { id: `bill_${billingRows.length}`, ...(values as BillingRecord) };
      billingRows.push(row);
      return row;
    },
    update: async (_f, v) => v as BillingRecord,
  };

  const gateway: EventRowGateway = {
    exists: async (_tx, filter) =>
      eventRows.some((e) => e.org_id === filter.org_id && e.reference === filter.reference),
    insert: async (_tx, row) => {
      // UNIQUE(reference) PK on marzpay_events (migration 005).
      if (eventRows.some((e) => e.reference === row.reference)) {
        throw new Error('UNIQUE constraint failed: marzpay_events.reference');
      }
      eventRows.push(row);
    },
  };

  // Real org-scoped event store over the in-memory gateway.
  const events = orgScopedEventStore(gateway, orgId);

  // Pass-through unit of work: runs the work in-line; a throw simply propagates
  // (the loser of a concurrent race never reaches its billing insert because the
  // event insert throws first, so no orphan row is left behind).
  const uow: UnitOfWork = { transaction: (work) => work({}) };

  const billing = new BillingService(repo, { plans: {} }, {});

  return { billingRows, eventRows, repo, gateway, events, uow, billing };
}

/** A fake MarzPayClient: validateWebhook passes; the reshaped `transactions.get`
 *  echoes a verified transaction with server-sourced monetary values. */
function makeFakeClient(amount: number, currency: string, status: string) {
  return {
    validateWebhook(_rawBody: string, _signature: string | undefined): boolean {
      return true;
    },
    transactions: {
      async get(reference: string): Promise<VerifiedTransaction> {
        return { id: `txn_${reference}`, reference, amount, currency, status };
      },
    },
  };
}

function makeCtx(orgId: string, rawBody: string, signature: string | undefined): FakeContext {
  return {
    headers: { 'x-marzpay-signature': signature },
    state: { rawBody },
    org: { id: orgId },
    responses: [],
    json(body, status) {
      this.responses.push({ body, status });
    },
  };
}

describe('Property 3: Webhook processing is idempotent including concurrent delivery (Requirements 7.2, 7.3, 14.5)', () => {
  // A verified MarzPay webhook payload whose reference selects the transaction to
  // re-verify. status is a successful settlement so the positive persistence path
  // is taken on the FIRST delivery.
  const eventArb = fc.record({
    reference: fc.stringMatching(/^ref_[a-zA-Z0-9_-]{1,24}$/),
    orgId: fc.stringMatching(/^org_[a-z0-9]{1,8}$/),
    amount: fc.integer({ min: 1, max: 5_000_000 }),
    currency: fc.constantFrom('UGX', 'USD', 'KES', 'EUR'),
    status: fc.constantFrom('completed', 'success', 'settled'),
    // Number of redeliveries to attempt (>= 2 total deliveries).
    deliveries: fc.integer({ min: 2, max: 6 }),
    // Deliver sequentially (back-to-back) or concurrently (Promise.all).
    concurrent: fc.boolean(),
    signature: fc.option(fc.stringMatching(/^[a-f0-9]{0,64}$/), { nil: undefined }),
  });

  it('processing the same verified reference 2+ times (sequential or concurrent) writes exactly one event row and one billing row, crediting the amount once', async () => {
    await fc.assert(
      fc.asyncProperty(eventArb, async (spec) => {
        const rawBody = JSON.stringify({
          event_type: 'payment.success',
          transaction: { reference: spec.reference },
        });

        const backing = makeBacking(spec.orgId);
        const client = makeFakeClient(spec.amount, spec.currency, spec.status);
        const controller = new WebhookController(
          client,
          backing.billing,
          backing.events,
          backing.uow,
        );

        // Build N independent contexts (one per delivery) sharing the SAME
        // backing — only the persistence layer dedup may prevent a second write.
        const deliver = () =>
          controller.handle(makeCtx(spec.orgId, rawBody, spec.signature));

        if (spec.concurrent) {
          // Concurrent double-delivery: the loser's transaction throws on the
          // UNIQUE(reference) race; allSettled tolerates that expected rejection.
          const results = await Promise.allSettled(
            Array.from({ length: spec.deliveries }, deliver),
          );
          // At least one delivery must have succeeded (the winner).
          assert.ok(
            results.some((r) => r.status === 'fulfilled'),
            'at least one concurrent delivery must succeed',
          );
        } else {
          // Sequential redelivery: every call resolves (duplicates are no-ops via
          // the hasProcessed gate inside the shared transaction).
          for (let i = 0; i < spec.deliveries; i++) {
            await deliver();
          }
        }

        // ── The core idempotency invariant (Requirements 7.2, 7.3) ───────────
        const billingForRef = backing.billingRows.filter((r) => r.reference === spec.reference);
        const eventsForRef = backing.eventRows.filter((e) => e.reference === spec.reference);

        assert.equal(
          eventsForRef.length,
          1,
          'marzpay_events must contain exactly one row for the reference',
        );
        assert.equal(
          billingForRef.length,
          1,
          'billing_records must contain exactly one row for the reference',
        );

        // The credited amount/currency/status are applied a single time and come
        // ONLY from the re-verified transaction.
        const row = billingForRef[0]!;
        assert.equal(row.amount, spec.amount, 'the credited amount must equal the verified amount');
        assert.equal(row.currency, spec.currency, 'the currency must equal the verified currency');
        assert.equal(row.status, spec.status, 'the status must equal the verified status');
        assert.equal(row.org_id, spec.orgId, 'the billing row must be stamped with the server-side org id');

        // The processed-event row is scoped to the same tenant.
        assert.equal(eventsForRef[0]!.org_id, spec.orgId, 'the event row must be org-scoped');

        // Total rows across the whole backing also reflect a single application
        // (only one reference is ever delivered per property run).
        assert.equal(backing.billingRows.length, 1, 'no extra billing rows may exist');
        assert.equal(backing.eventRows.length, 1, 'no extra event rows may exist');
      }),
      { numRuns: 150 },
    );
  });
});
