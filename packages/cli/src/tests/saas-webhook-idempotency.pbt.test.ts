// saas-webhook-idempotency.pbt.test.ts
// Property-based test for the SaaS starter overlay's Stripe webhook idempotency
// guarantee (Property 8).
//
//   **Property 8: Webhook idempotency** — processing the same Stripe event id
//   twice yields the same `subscriptions` state as processing it once.
//
//   **Validates: Requirements 4.1**
//
// The billing logic is NOT a top-level runtime export of create.ts — it is
// shipped as an overlay TEMPLATE STRING in `TEMPLATES.saas.extraFiles`
// (`src/modules/billing/billing.service.ts`). To drive the property through the
// *real* scaffolded code (rather than a re-implementation), this test extracts
// that template string, transpiles it with the bundled TypeScript compiler,
// rewrites any `streetjs` / `@streetjs/plugin-stripe` import at a local stub
// (the service imports only types, so the rewrite is a harmless safety net), and
// dynamically imports the result.
//
// The property is exercised by driving the REAL `BillingService.handleEvent`
// over in-memory fakes for `SubscriptionRepository`, `ProcessedEventStore`, and
// `UnitOfWork` (a pass-through transaction). For any sequence of verified,
// handled events, processing the sequence with every event delivered twice must
// leave the `subscriptions` table byte-identical to delivering each event once,
// and each duplicate delivery must report a `'duplicate'` no-op.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

/** A verified Stripe event (mirrors the overlay's StripeEvent). */
interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/** The single subscriptions row shape the service upserts (one row per org). */
interface SubscriptionUpsert {
  org_id: string;
  plan: string;
  status: string;
  stripe_customer_id: string | null;
  current_period_end: string | null;
}

interface SubscriptionRow extends SubscriptionUpsert {
  id: string;
}

type Tx = unknown;

interface UnitOfWork {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}

interface ProcessedEventStore {
  hasProcessed(tx: Tx, eventId: string): Promise<boolean>;
  recordProcessed(tx: Tx, eventId: string): Promise<void>;
}

interface SubscriptionRepository {
  upsertInTx(tx: Tx, values: SubscriptionUpsert): Promise<void>;
  getByOrg(orgId: string): Promise<SubscriptionRow | null>;
}

type BillingEventOutcome =
  | { applied: true; orgId: string }
  | { applied: false; reason: 'duplicate' }
  | { applied: false; reason: 'ignored' };

interface BillingServiceLike {
  handleEvent(event: StripeEvent): Promise<BillingEventOutcome>;
  getSubscription(orgId: string): Promise<SubscriptionRow | null>;
}

type BillingServiceCtor = new (
  repo: SubscriptionRepository,
  events: ProcessedEventStore,
  uow: UnitOfWork,
  audit?: unknown,
) => BillingServiceLike;

// Stub standing in for `streetjs` / `@streetjs/plugin-stripe` imports. The
// service module imports only types (erased at transpile time), so this is a
// safety net that keeps the dynamic import resolvable regardless.
const STREETJS_STUB = `
export class BadRequestException extends Error {
  constructor(message = 'Bad Request') { super(message); this.status = 400; this.name = 'BadRequestException'; }
}
export class StripeClient {}
export function validateStripeConfig() { return true; }
export default {};
`;

/** Extract an overlay template, transpile it to ESM, and point any framework
 *  import at the local stub. Returns the emitted JavaScript source. */
function compileOverlay(relPath: string, stubFileName: string): string {
  const entry = TEMPLATES.saas.extraFiles?.find((f) => f.path === relPath);
  assert.ok(entry, `overlay template "${relPath}" must be registered in TEMPLATES.saas.extraFiles`);
  const js = ts.transpileModule(entry!.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return js
    .replace(/from\s+['"]streetjs['"]/g, `from './${stubFileName}'`)
    .replace(/from\s+['"]@streetjs\/plugin-stripe['"]/g, `from './${stubFileName}'`);
}

let BillingService: BillingServiceCtor;
let tempDir: string;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'saas-webhook-idempotency-'));

  const stubFile = 'streetjs-stub.mjs';
  writeFileSync(join(tempDir, stubFile), STREETJS_STUB, 'utf8');

  const svcFile = join(tempDir, 'billing.service.mjs');
  writeFileSync(svcFile, compileOverlay('src/modules/billing/billing.service.ts', stubFile), 'utf8');

  const svcMod = await import(pathToFileURL(svcFile).href);
  BillingService = svcMod.BillingService as BillingServiceCtor;

  assert.equal(typeof BillingService, 'function', 'BillingService must load from the overlay template');
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Fresh in-memory backing for one BillingService instance. */
function makeBacking() {
  // One subscriptions row per org, keyed by org_id (mirrors the UNIQUE-by-org
  // upsert semantics). A stable synthetic id per org keeps rows comparable.
  const subs = new Map<string, SubscriptionRow>();
  const processed = new Set<string>();

  const repo: SubscriptionRepository = {
    async upsertInTx(_tx, values) {
      subs.set(values.org_id, { id: `sub_${values.org_id}`, ...values });
    },
    async getByOrg(orgId) {
      return subs.get(orgId) ?? null;
    },
  };

  const events: ProcessedEventStore = {
    async hasProcessed(_tx, eventId) {
      return processed.has(eventId);
    },
    async recordProcessed(_tx, eventId) {
      processed.add(eventId);
    },
  };

  // Pass-through unit of work: runs the work in-line; a throw simply propagates
  // (nothing is committed beyond what the work already mutated).
  const uow: UnitOfWork = {
    async transaction(work) {
      return work({});
    },
  };

  return { subs, processed, repo, events, uow };
}

/** Snapshot the full subscriptions table as a plain comparable object. */
function snapshot(subs: Map<string, SubscriptionRow>): Record<string, SubscriptionRow> {
  const out: Record<string, SubscriptionRow> = {};
  for (const [orgId, row] of [...subs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[orgId] = row;
  }
  return out;
}

describe('Property 8: Stripe webhook idempotency (Requirements 4.1)', () => {
  const HANDLED_TYPES = [
    'checkout.session.completed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ] as const;

  // Each generated event targets one of a small pool of orgs (so repeated
  // upserts to the same org are common), carries org metadata as the real
  // service reads it, and varies plan/status/customer/period.
  const eventSpecArb = fc.record({
    orgId: fc.constantFrom('org_a', 'org_b', 'org_c'),
    type: fc.constantFrom(...HANDLED_TYPES),
    plan: fc.constantFrom('free', 'pro', 'enterprise'),
    status: fc.constantFrom('active', 'trialing', 'past_due'),
    customer: fc.option(fc.stringMatching(/^cus_[a-z0-9]{1,8}$/), { nil: undefined }),
    periodEnd: fc.option(fc.integer({ min: 1_600_000_000, max: 2_000_000_000 }), { nil: undefined }),
  });

  /** Materialise a generated spec into a verified-event shape + a unique id. */
  function toEvent(spec: fc.infer<typeof eventSpecArb>, index: number): StripeEvent {
    const object: Record<string, unknown> = {
      metadata: { org_id: spec.orgId, plan: spec.plan },
      status: spec.status,
    };
    if (spec.customer !== undefined) object['customer'] = spec.customer;
    if (spec.periodEnd !== undefined) object['current_period_end'] = spec.periodEnd;
    return { id: `evt_${index}`, type: spec.type, data: { object } };
  }

  it('delivering every event twice leaves subscriptions identical to delivering once; duplicates are no-ops', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(eventSpecArb, { minLength: 1, maxLength: 12 }), async (specs) => {
        // Unique event ids by index isolate idempotency from genuine state
        // transitions (distinct events for the same org legitimately update it).
        const events = specs.map((s, i) => toEvent(s, i));

        // Run A — deliver each event exactly once.
        const once = makeBacking();
        const svcOnce = new BillingService(once.repo, once.events, once.uow);
        for (const ev of events) {
          const outcome = await svcOnce.handleEvent(ev);
          assert.equal(outcome.applied, true, 'first delivery of a handled event must apply');
        }

        // Run B — deliver each event twice, back to back.
        const twice = makeBacking();
        const svcTwice = new BillingService(twice.repo, twice.events, twice.uow);
        for (const ev of events) {
          const first = await svcTwice.handleEvent(ev);
          assert.equal(first.applied, true, 'first delivery must apply');

          const orgId = (first as { applied: true; orgId: string }).orgId;
          const rowAfterFirst = await svcTwice.getSubscription(orgId);

          const second = await svcTwice.handleEvent(ev);
          assert.equal(second.applied, false, 'second delivery of the same event id must NOT apply');
          assert.equal(
            (second as { applied: false; reason: string }).reason,
            'duplicate',
            'a re-delivered event id must be reported as a duplicate no-op',
          );

          const rowAfterSecond = await svcTwice.getSubscription(orgId);
          assert.deepEqual(
            rowAfterSecond,
            rowAfterFirst,
            'the duplicate delivery must not change the org subscriptions row',
          );
        }

        // The whole subscriptions table must be identical under once vs. twice.
        assert.deepEqual(
          snapshot(twice.subs),
          snapshot(once.subs),
          'processing each event twice must yield the same subscriptions state as once',
        );
      }),
      { numRuns: 200 },
    );
  });
});
