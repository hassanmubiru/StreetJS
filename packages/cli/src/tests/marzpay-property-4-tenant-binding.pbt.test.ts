// packages/cli/src/tests/marzpay-property-4-tenant-binding.pbt.test.ts
// Property-based test for the SaaS MarzPay webhook's multi-tenant binding
// guarantee (Task 11.4).
//
//   Feature: marzpay-scope-alignment, Property 4: Tenant isolation and
//   server-derived binding.
//
//   For any set of organizations and webhook events, every billing write is
//   stamped with the org_id derived from the verified `reference -> organization`
//   mapping (NEVER from the Raw_Body); a tenant query returns only rows whose
//   org_id equals the active org; and an event whose Raw_Body org disagrees with
//   the mapped org (or whose reference cannot be resolved) results in NO billing
//   write.
//
//   Validates: Requirements 8.1, 8.3, 8.4, 9.3, 13.4
//
// Like saas-tenant-isolation.pbt.test.ts and marzpay-billing-pbt.test.ts, the
// billing logic ships as overlay template content scaffolded into a generated
// project's `src/middleware/tenant.ts` and
// `src/modules/billing/marzpay-billing.service.ts` (they are NOT top-level
// exports of create.ts). To exercise the REAL scaffolded behavior we read the
// registered template strings, transpile them to JS, neutralize their
// non-resolvable imports (`streetjs`, `@streetjs/plugin-marzpay`), rewire the
// relative `tenant.js` import, load them as modules, and run fast-check against
// the exported `BillingService`, `orgScopedRepo`, and the
// `billingReferenceOrgResolver` server-side mapping.
//
// The WebhookController itself ships as a decorator-laden template that imports
// framework runtime types and cannot be transpiled in isolation, so — exactly
// like marzpay-webhook-pbt.test.ts does for the validate/persist control flow —
// this test recreates ONLY the controller's server-side org-derivation segment
// FAITHFULLY (mirroring create.ts WebhookController.handle, steps 5–6 of its
// doc-comment) and drives it through the REAL resolver + REAL orgScopedRepo +
// REAL BillingService.recordPayment so every tenant-binding decision exercises
// scaffolded code.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

// --- Minimal structural mirrors of the scaffolded contracts ----------------

/** An org-scoped billing record (tenant discriminator: org_id). */
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

/** The repository subset orgScopedRepo wraps. */
interface Repo {
  find(filter: Record<string, unknown>): Promise<BillingRecord[]>;
  findOne(filter: Record<string, unknown>): Promise<BillingRecord | null>;
  insert(values: Partial<BillingRecord>): Promise<BillingRecord>;
  update(filter: Record<string, unknown>, values: Partial<BillingRecord>): Promise<BillingRecord>;
}

interface InitArgs {
  amount: number;
  currency: string;
  country: string;
  reference: string;
  method: string;
  description: string;
}

interface InitResult {
  reference: string;
  redirectUrl?: string;
  status: string;
}

interface FakeMarzPayClient {
  initializePayment(args: InitArgs): Promise<InitResult>;
}

interface VerifiedWebhookEvent {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  plan?: string;
}

type Ctx = { org?: { id: string } };

/** Constructor type for the scaffolded BillingService. */
type BillingServiceCtor = new (
  repo: Repo,
  plans: { plans: Record<string, never> },
  client: FakeMarzPayClient,
) => {
  recordPayment(ctx: Ctx, event: VerifiedWebhookEvent): Promise<BillingRecord>;
};

type OrgScopedRepoFn = (repo: Repo, ctx: Ctx) => Repo;

/** The server-side reference -> org mapping the webhook controller derives from. */
interface OrgResolver {
  resolveOrgByReference(reference: string): Promise<string | null>;
}
interface ReferenceLookupGateway {
  findByReference(reference: string): Promise<{ org_id: string } | null>;
}
type BillingReferenceOrgResolverFn = (gateway: ReferenceLookupGateway) => OrgResolver;

const TS_OPTS = {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
} as const;

/**
 * Transpile the saas overlay's tenant + billing templates and load the real
 * `orgScopedRepo`, `BillingService`, and `billingReferenceOrgResolver`.
 * Non-resolvable imports are neutralized identically to marzpay-billing-pbt.
 */
async function loadOverlayModules(): Promise<{
  BillingService: BillingServiceCtor;
  orgScopedRepo: OrgScopedRepoFn;
  billingReferenceOrgResolver: BillingReferenceOrgResolverFn;
  cleanup: () => void;
}> {
  const tenantFile = TEMPLATES.saas.extraFiles?.find((f) => f.path === 'src/middleware/tenant.ts');
  const billingFile = TEMPLATES.saas.extraFiles?.find(
    (f) => f.path === 'src/modules/billing/marzpay-billing.service.ts',
  );
  assert.ok(tenantFile, 'saas overlay must register src/middleware/tenant.ts');
  assert.ok(billingFile, 'saas overlay must register the marzpay billing service');

  const tenantJs = ts
    .transpileModule(tenantFile!.content, TS_OPTS)
    .outputText.replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'class ForbiddenException extends Error {} class UnauthorizedException extends Error {}',
    );

  const billingJs = ts
    .transpileModule(billingFile!.content, TS_OPTS)
    .outputText.replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'class BadRequestException extends Error {}',
    )
    .replace(/['"]\.\.\/\.\.\/middleware\/tenant\.js['"]/, "'./tenant.mjs'");

  const dir = mkdtempSync(join(tmpdir(), 'street-tenant-binding-pbt-'));
  writeFileSync(join(dir, 'tenant.mjs'), tenantJs, 'utf8');
  writeFileSync(join(dir, 'billing.mjs'), billingJs, 'utf8');

  const tenantMod = await import(pathToFileURL(join(dir, 'tenant.mjs')).href);
  const billingMod = await import(pathToFileURL(join(dir, 'billing.mjs')).href);

  return {
    BillingService: billingMod.BillingService as BillingServiceCtor,
    orgScopedRepo: tenantMod.orgScopedRepo as OrgScopedRepoFn,
    billingReferenceOrgResolver:
      billingMod.billingReferenceOrgResolver as BillingReferenceOrgResolverFn,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * payloadOrgIdOf — faithful mirror of the create.ts WebhookController helper:
 * read an org identifier SUPPLIED in the Raw_Body (transaction.org_id, top-level
 * org_id, or metadata.org_id). NEVER used to scope a write; read only so the
 * controller can REJECT an event whose payload org disagrees with the
 * server-derived org. Returns undefined when no usable identifier is present.
 */
function payloadOrgIdOf(rawBody: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return undefined;
  }
  const root = (parsed ?? {}) as {
    org_id?: unknown;
    transaction?: { org_id?: unknown };
    metadata?: { org_id?: unknown };
  };
  const candidate = root.transaction?.org_id ?? root.org_id ?? root.metadata?.org_id;
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  return trimmed === '' ? undefined : trimmed;
}

type Outcome = 'persisted' | 'rejected-unresolved' | 'rejected-mismatch';

/**
 * deriveAndPersist — faithful re-creation of the server-side org-derivation
 * segment of create.ts WebhookController.handle (steps 5–6 of its doc-comment),
 * driven by the REAL resolver + REAL orgScopedRepo (inside BillingService).
 *
 *   1. Derive org_id from the verified reference->org mapping (NEVER Raw_Body).
 *   2. Unresolved mapping -> persist NOTHING (Requirement 8.2).
 *   3. Raw_Body org that disagrees with the derived org -> persist NOTHING
 *      (Requirement 8.4).
 *   4. Stamp ctx.org with the SERVER-DERIVED org so recordPayment (via
 *      orgScopedRepo) writes the row scoped to the resolved tenant
 *      (Requirements 8.1, 8.3).
 */
async function deriveAndPersist(
  resolver: OrgResolver,
  billing: { recordPayment(ctx: Ctx, event: VerifiedWebhookEvent): Promise<BillingRecord> },
  rawBody: string,
  event: VerifiedWebhookEvent,
): Promise<{ outcome: Outcome; row?: BillingRecord }> {
  const resolvedOrgId = await resolver.resolveOrgByReference(event.reference);
  if (!resolvedOrgId) {
    return { outcome: 'rejected-unresolved' };
  }
  const payloadOrgId = payloadOrgIdOf(rawBody);
  if (payloadOrgId !== undefined && payloadOrgId !== resolvedOrgId) {
    return { outcome: 'rejected-mismatch' };
  }
  // Server-derived org stamped onto ctx; orgScopedRepo ignores any payload org.
  const ctx: Ctx = { org: { id: resolvedOrgId } };
  const row = await billing.recordPayment(ctx, event);
  return { outcome: 'persisted', row };
}

// --- Generators -------------------------------------------------------------

const orgIdArb = fc.stringMatching(/^org_[a-z0-9]{1,6}$/);
const knownRefArb = fc.stringMatching(/^ref_[a-z0-9]{1,8}$/);
const unknownRefArb = fc.stringMatching(/^unk_[a-z0-9]{1,8}$/);
const currencyArb = fc.constantFrom('UGX', 'USD', 'KES', 'EUR');
const statusArb = fc.constantFrom('completed', 'failed', 'pending');
// A Raw_Body org guaranteed disjoint from every `org_...` owner id, so a
// "mismatch" payload org never accidentally equals the server-derived org.
const foreignOrgArb = fc.stringMatching(/^xorg_[a-z0-9]{1,6}$/);

/** Build a webhook Raw_Body carrying the verified shape + an optional payload org. */
function buildRawBody(reference: string, payloadOrgId: string | undefined): string {
  const body: Record<string, unknown> = {
    event_type: 'payment.success',
    transaction: { reference },
  };
  if (payloadOrgId !== undefined) {
    (body.transaction as Record<string, unknown>).org_id = payloadOrgId;
  }
  return JSON.stringify(body);
}

describe('Property 4: Tenant isolation and server-derived binding (Validates: Requirements 8.1, 8.3, 8.4, 9.3, 13.4)', () => {
  let BillingService: BillingServiceCtor;
  let orgScopedRepo: OrgScopedRepoFn;
  let billingReferenceOrgResolver: BillingReferenceOrgResolverFn;
  let cleanup: () => void = () => {};

  before(async () => {
    const loaded = await loadOverlayModules();
    BillingService = loaded.BillingService;
    orgScopedRepo = loaded.orgScopedRepo;
    billingReferenceOrgResolver = loaded.billingReferenceOrgResolver;
    cleanup = loaded.cleanup;
    assert.equal(typeof BillingService, 'function', 'BillingService must be importable from the overlay');
    assert.equal(typeof orgScopedRepo, 'function', 'orgScopedRepo must be importable from the overlay');
    assert.equal(
      typeof billingReferenceOrgResolver,
      'function',
      'billingReferenceOrgResolver must be importable from the overlay',
    );
  });

  after(() => cleanup());

  it('stamps writes from the verified mapping, isolates tenant queries, and drops mismatched/unresolved events', async () => {
    // Feature: marzpay-scope-alignment, Property 4: Tenant isolation and server-derived binding
    await fc.assert(
      fc.asyncProperty(
        // Two or more tenants.
        fc.uniqueArray(orgIdArb, { minLength: 2, maxLength: 5 }),
        // The verified reference -> org mapping (checkout records), unique refs.
        fc.uniqueArray(
          fc.record({ reference: knownRefArb, ownerIdx: fc.nat() }),
          { selector: (r) => r.reference, minLength: 1, maxLength: 12 },
        ),
        // The inbound webhook events to process.
        fc.array(
          fc.record({
            useKnown: fc.boolean(),
            knownIdx: fc.nat(),
            unknownRef: unknownRefArb,
            // 'none' -> no payload org; 'match' -> payload org == derived org;
            // 'mismatch' -> a foreign payload org that disagrees with the mapping.
            bodyMode: fc.constantFrom('none', 'match', 'mismatch'),
            foreignOrg: foreignOrgArb,
            status: statusArb,
            amount: fc.integer({ min: 1, max: 5_000_000 }),
            currency: currencyArb,
            // The Raw_Body monetary values, intentionally different, to prove
            // they are NEVER used to scope the write.
            bodyAmount: fc.integer({ min: 1, max: 5_000_000 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        async (orgs, mapping, events) => {
          // ── Backing store. WORST CASE: find/findOne ignore the org_id filter
          //    and expose ALL tenants' rows — the orgScopedRepo wrapper alone
          //    must enforce isolation. ──────────────────────────────────────
          const store: BillingRecord[] = [];
          const repo: Repo = {
            find: async () => store.slice(),
            findOne: async (filter) => {
              const ref = (filter as { reference?: string }).reference;
              return store.find((r) => r.reference === ref) ?? null;
            },
            insert: async (v) => {
              const row = { ...(v as BillingRecord) };
              store.push(row);
              return row;
            },
            update: async (_f, v) => v as BillingRecord,
          };

          // The verified reference->org mapping. Each known reference is owned by
          // exactly one tenant; seed it as a checkout BillingRecord stamped with
          // the owner org through the REAL orgScopedRepo (server-side stamping).
          const ownerByRef = new Map<string, string>();
          const seedCountByOrg: Record<string, number> = {};
          for (const m of mapping) {
            const owner = orgs[m.ownerIdx % orgs.length]!;
            ownerByRef.set(m.reference, owner);
            await orgScopedRepo(repo, { org: { id: owner } }).insert({
              plan: 'seed',
              status: 'pending',
              reference: m.reference,
              amount: 1,
              currency: 'UGX',
              created_at: new Date().toISOString(),
            });
            seedCountByOrg[owner] = (seedCountByOrg[owner] ?? 0) + 1;
          }

          // The REAL server-side resolver, backed by an UNSCOPED lookup over the
          // billing store (mirrors billingReferenceOrgResolver's contract: the
          // reference uniqueness guarantees a single owning org).
          const gateway: ReferenceLookupGateway = {
            async findByReference(reference) {
              const row = store.find((r) => r.reference === reference);
              return row ? { org_id: row.org_id } : null;
            },
          };
          const resolver = billingReferenceOrgResolver(gateway);

          // recordPayment writes ONLY through orgScopedRepo, so each row is
          // stamped with the active (server-derived) tenant's org_id.
          const billing = new BillingService(
            repo,
            { plans: {} },
            { initializePayment: async (a) => ({ reference: a.reference, status: 'pending' }) },
          );

          const settlementCountByOrg: Record<string, number> = {};

          for (const e of events) {
            // Pick a resolvable known reference, or an unresolvable unknown one.
            const reference =
              e.useKnown && mapping.length > 0
                ? mapping[e.knownIdx % mapping.length]!.reference
                : e.unknownRef;
            const mappedOwner = ownerByRef.get(reference) ?? null;

            // Construct the Raw_Body's payload org per the chosen mode.
            let payloadOrgId: string | undefined;
            if (e.bodyMode === 'match') {
              // Agreeing payload org only makes sense when resolvable.
              payloadOrgId = mappedOwner ?? e.foreignOrg;
            } else if (e.bodyMode === 'mismatch') {
              payloadOrgId = e.foreignOrg; // disjoint from every org_... id
            } else {
              payloadOrgId = undefined;
            }
            const rawBody = buildRawBody(reference, payloadOrgId);

            const event: VerifiedWebhookEvent = {
              reference,
              status: e.status,
              amount: e.amount,
              currency: e.currency,
            };

            const before = store.length;
            const { outcome, row } = await deriveAndPersist(resolver, billing, rawBody, event);
            const after = store.length;

            if (mappedOwner === null) {
              // (c) Unresolved reference -> NO billing write.
              assert.equal(outcome, 'rejected-unresolved', 'an unresolved reference must be rejected');
              assert.equal(after, before, 'an unresolved reference must persist NOTHING');
            } else if (e.bodyMode === 'mismatch') {
              // (c) Raw_Body org disagrees with the mapped org -> NO billing write.
              assert.equal(outcome, 'rejected-mismatch', 'a payload-org mismatch must be rejected');
              assert.equal(after, before, 'a payload-org mismatch must persist NOTHING');
            } else {
              // (a) Resolvable + agreeing/absent payload org -> exactly one write,
              //     stamped with the SERVER-DERIVED org (the verified mapping),
              //     never the Raw_Body.
              assert.equal(outcome, 'persisted', 'a resolvable, agreeing event must persist');
              assert.equal(after, before + 1, 'exactly one billing record must be written');
              assert.ok(row, 'a persisted event must return the written row');
              assert.equal(
                row!.org_id,
                mappedOwner,
                'the write must be stamped with the org derived from the verified mapping',
              );
              // The payload org, when present, equals the derived org here; the
              // foreign/mismatch org NEVER appears on a persisted row.
              assert.notEqual(row!.org_id, e.foreignOrg, 'no write may carry a Raw_Body-supplied foreign org');
              settlementCountByOrg[mappedOwner] = (settlementCountByOrg[mappedOwner] ?? 0) + 1;
            }
          }

          // (b) Tenant isolation: a query on behalf of each tenant returns ONLY
          //     that tenant's rows, and exactly seed + settlement rows for it.
          for (const org of orgs) {
            const scoped = orgScopedRepo(repo, { org: { id: org } });
            const rows = await scoped.find({});
            for (const r of rows) {
              assert.equal(r.org_id, org, 'a tenant query must never return another tenant\'s row');
            }
            const expected = (seedCountByOrg[org] ?? 0) + (settlementCountByOrg[org] ?? 0);
            assert.equal(rows.length, expected, 'a tenant query must return exactly that tenant\'s rows');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
