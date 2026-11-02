// saas-billing-webhook.test.ts
// Unit tests for the SaaS starter Stripe billing webhook overlay.
//
// The billing logic ships as TEMPLATE-STRING source inside
// TEMPLATES.saas.extraFiles in packages/cli/src/commands/create.ts — it is
// scaffolded into generated projects, not exported as runtime symbols from the
// CLI. To exercise the REAL controller + service behaviour in isolation we
// extract each template, transpile it with the TypeScript compiler the CLI
// already depends on, rewrite its third-party imports to faithful local stubs
// (`streetjs` exceptions, and `@streetjs/plugin-stripe` which is NOT a CLI
// dependency), and dynamically import the result. The controller accepts an
// injectable `verifier`, so we inject a stub StripeWebhookVerifier and drive the
// real BillingController over a real BillingService backed by in-memory,
// transaction-aware fakes.
//
// Covers (Requirements 4.2, 4.3, 4.5, 4.6):
//   1. bad/expired signature (verifier throws) -> 400, no subscriptions change,
//      event id NOT recorded
//   2. verified event of an unhandled type     -> 200 no-op (subscriptions
//      unchanged, event id NOT recorded)
//   3. persist failure (repo.upsertInTx throws) -> 500, transaction rolls back
//      (existing row unchanged, event id NOT recorded)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { transpileModule, ModuleKind, ScriptTarget } from './ts-transpile-helper.js';
import { TEMPLATES } from '../commands/create.js';

/** Faithful stub of the streetjs HTTP exceptions the overlay imports. Mirrors
 * the real shape from packages/core/src/http/exceptions.ts: a numeric `status`
 * and `name` set to the constructor name. */
const STREETJS_STUB = `
class StreetException extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = this.constructor.name;
  }
}
export class BadRequestException extends StreetException { constructor(m = 'Bad Request', d) { super(400, m, d); } }
export class UnauthorizedException extends StreetException { constructor(m = 'Unauthorized') { super(401, m); } }
export class ForbiddenException extends StreetException { constructor(m = 'Forbidden') { super(403, m); } }
export class NotFoundException extends StreetException { constructor(m = 'Not Found') { super(404, m); } }
export class ConflictException extends StreetException { constructor(m = 'Conflict', d) { super(409, m, d); } }
export class InternalException extends StreetException { constructor(m = 'Internal Server Error', d) { super(500, m, d); } }
`;

/** Stub of @streetjs/plugin-stripe — NOT a dependency of the CLI package. The
 * controller only references these in defaultVerifier(), which our tests never
 * call (we inject a stub verifier), so the stub merely has to resolve the
 * import. If defaultVerifier WERE invoked it would surface a clear error. */
const PLUGIN_STRIPE_STUB = `
export function validateStripeConfig(input) {
  if (!input || !input.apiKey) throw new Error('stub: missing Stripe apiKey');
  return { apiKey: input.apiKey };
}
export class StripeClient {
  constructor(config) { this.config = config; }
  verify() { throw new Error('stub StripeClient.verify must not be called in unit tests'); }
}
export default { StripeClient, validateStripeConfig };
`;

/** Pull a scaffolded overlay file's source out of the saas template registry. */
function templateSource(path: string): string {
  const entry = TEMPLATES.saas.extraFiles?.find((f) => f.path === path);
  assert.ok(entry, `expected saas template to register ${path}`);
  return entry!.content;
}

/** Transpile one overlay template to an ESM module on disk (with its third-party
 * imports rewritten to local stubs) and dynamically import it. */
async function loadOverlay(dir: string, templatePath: string, outFile: string): Promise<Record<string, unknown>> {
  const transpiled = transpileModule(templateSource(templatePath), {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  const rewritten = transpiled
    .replace(/from ['"]streetjs['"]/g, "from './streetjs.mjs'")
    .replace(/from ['"]@streetjs\/plugin-stripe['"]/g, "from './plugin-stripe.mjs'");
  const abs = join(dir, outFile);
  writeFileSync(abs, rewritten, 'utf8');
  return import(pathToFileURL(abs).href) as Promise<Record<string, unknown>>;
}

/**
 * In-memory, transaction-aware backing store for the BillingService.
 *
 * uow.transaction(work) buffers all writes done through `tx` and only COMMITS
 * them to the durable state if `work` resolves; if `work` throws, the buffer is
 * discarded — a faithful rollback. This lets the persist-failure test prove the
 * subscriptions row is left unchanged and the event id is never recorded.
 */
function makeStore(opts: { failUpsert?: boolean; seedSubs?: Record<string, any> } = {}) {
  const committed = {
    subs: new Map<string, any>(Object.entries(opts.seedSubs ?? {})),
    events: new Set<string>(),
  };

  const uow = {
    async transaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
      const buffer = { subs: new Map<string, any>(), events: new Set<string>() };
      const tx = { buffer };
      const result = await work(tx); // throws propagate WITHOUT committing
      for (const [k, v] of buffer.subs) committed.subs.set(k, v);
      for (const e of buffer.events) committed.events.add(e);
      return result;
    },
  };

  const repo = {
    upsertCalls: 0,
    async upsertInTx(tx: any, values: any) {
      repo.upsertCalls++;
      if (opts.failUpsert) throw new Error('simulated persist failure');
      tx.buffer.subs.set(values.org_id, { id: 'sub-' + values.org_id, ...values });
    },
    async getByOrg(orgId: string) {
      return committed.subs.get(orgId) ?? null;
    },
  };

  const events = {
    async hasProcessed(tx: any, eventId: string) {
      return committed.events.has(eventId) || tx.buffer.events.has(eventId);
    },
    async recordProcessed(tx: any, eventId: string) {
      tx.buffer.events.add(eventId);
    },
  };

  return { committed, uow, repo, events };
}

/** A fake StreetContext capturing json(body, status) responses. */
function makeCtx(init: { headers?: Record<string, string>; rawBody?: unknown } = {}) {
  const responses: { body: unknown; status: number }[] = [];
  return {
    headers: init.headers ?? {},
    state: { rawBody: init.rawBody } as Record<string, unknown>,
    json(body: unknown, status: number) {
      responses.push({ body, status });
    },
    responses,
    get lastStatus() {
      return responses.length ? responses[responses.length - 1].status : undefined;
    },
  };
}

describe('saas overlay — Stripe billing webhook', () => {
  let dir: string;
  let BillingService: any;
  let BillingController: any;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'saas-billing-webhook-'));
    writeFileSync(join(dir, 'streetjs.mjs'), STREETJS_STUB, 'utf8');
    writeFileSync(join(dir, 'plugin-stripe.mjs'), PLUGIN_STRIPE_STUB, 'utf8');

    const service = await loadOverlay(dir, 'src/modules/billing/billing.service.ts', 'billing.service.mjs');
    const controller = await loadOverlay(dir, 'src/modules/billing/billing.controller.ts', 'billing.controller.mjs');
    BillingService = service['BillingService'];
    BillingController = controller['BillingController'];

    assert.equal(typeof BillingService, 'function', 'BillingService must be exported by the overlay');
    assert.equal(typeof BillingController, 'function', 'BillingController must be exported by the overlay');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Requirement 4.2 / 4.3 — a bad or expired (>300s) signature is rejected with
  // 400; no subscriptions row is touched and no event id is recorded.
  it('rejects a bad/expired signature with 400 and changes no state', async () => {
    const store = makeStore();
    const billing = new BillingService(store.repo, store.events, store.uow);
    const verifier = {
      verify() {
        throw new Error('bad or expired signature');
      },
    };
    const controller = new BillingController(billing, { verifier, webhookSecret: 'whsec_test' });
    const ctx = makeCtx({
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
      rawBody: '{"id":"evt_bad","type":"customer.subscription.updated"}',
    });

    await controller.webhook(ctx);

    assert.equal(ctx.lastStatus, 400, 'a bad/expired signature must map to HTTP 400');
    assert.equal(store.repo.upsertCalls, 0, 'no upsert may be attempted when verification fails');
    assert.equal(store.committed.subs.size, 0, 'no subscriptions row may change on a bad signature');
    assert.equal(store.committed.events.has('evt_bad'), false, 'the event id must NOT be recorded');
  });

  // Requirement 4.6 — a verified event whose type is none of the three handled
  // types is a no-op: the controller returns 200 and nothing is persisted.
  it('returns 200 and no-ops for a verified but unhandled event type', async () => {
    const store = makeStore();
    const billing = new BillingService(store.repo, store.events, store.uow);
    const event = {
      id: 'evt_unhandled',
      type: 'invoice.payment_succeeded', // not one of the 3 handled types
      data: { object: { metadata: { org_id: 'org-1' } } },
    };
    const verifier = { verify: () => event };
    const controller = new BillingController(billing, { verifier, webhookSecret: 'whsec_test' });
    const ctx = makeCtx({
      headers: { 'stripe-signature': 't=1,v1=valid' },
      rawBody: JSON.stringify(event),
    });

    await controller.webhook(ctx);

    assert.equal(ctx.lastStatus, 200, 'an unhandled event type must still acknowledge with 200');
    assert.equal(store.repo.upsertCalls, 0, 'an unhandled event must not upsert a subscriptions row');
    assert.equal(store.committed.subs.size, 0, 'subscriptions state is unchanged for an unhandled event');
    assert.equal(store.committed.events.has('evt_unhandled'), false, 'an ignored event id is not recorded');
  });

  // Requirement 4.5 — a persist failure inside handleEvent rolls the transaction
  // back and propagates, so the controller returns 500, the existing
  // subscriptions row is unchanged, and the event id is not recorded.
  it('maps a persist failure to 500 and rolls the transaction back', async () => {
    const existing = {
      'org-1': { id: 'sub-org-1', org_id: 'org-1', plan: 'pro', status: 'active', stripe_customer_id: 'cus_old', current_period_end: '2020-01-01T00:00:00.000Z' },
    };
    const store = makeStore({ failUpsert: true, seedSubs: existing });
    const billing = new BillingService(store.repo, store.events, store.uow);
    const event = {
      id: 'evt_persist_fail',
      type: 'customer.subscription.updated',
      data: { object: { metadata: { org_id: 'org-1', plan: 'enterprise' }, status: 'active', customer: 'cus_new', current_period_end: 1893456000 } },
    };
    const verifier = { verify: () => event };
    const controller = new BillingController(billing, { verifier, webhookSecret: 'whsec_test' });
    const ctx = makeCtx({
      headers: { 'stripe-signature': 't=1,v1=valid' },
      rawBody: JSON.stringify(event),
    });

    await controller.webhook(ctx);

    assert.equal(ctx.lastStatus, 500, 'a persist failure must map to HTTP 500 so Stripe retries');
    assert.equal(store.repo.upsertCalls, 1, 'the upsert was attempted exactly once before failing');
    assert.deepEqual(
      store.committed.subs.get('org-1'),
      existing['org-1'],
      'the existing subscriptions row must be left unchanged after rollback',
    );
    assert.equal(store.committed.events.has('evt_persist_fail'), false, 'the event id must NOT be recorded on rollback');
  });
});
