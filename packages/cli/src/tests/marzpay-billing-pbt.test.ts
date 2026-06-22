// packages/cli/src/tests/marzpay-billing-pbt.test.ts
// Property-based tests for the scaffolded SaaS MarzPay billing modules (Task 12.2).
//
//   Property 10 (Unknown plans are rejected without persistence): for every
//   checkout request whose referenced planId is absent from the configured
//   plans, BillingService.startCheckout throws an "unknown plan" error and
//   persists NOTHING (the backing repo receives no insert and MarzPay is never
//   called). When the planId IS configured, the plan used equals the configured
//   definition.
//   **Validates: Requirements 6.5, 6.6**
//
//   Property 8 (Tenant isolation of billing records): for every sequence of
//   org-scoped billing writes performed across two or more tenants, a query made
//   on behalf of one tenant returns ONLY records whose org_id equals that
//   tenant's and never another tenant's record.
//   **Validates: Requirements 6.8, 10.2**
//
// Like saas-tenant-isolation.pbt.test.ts, the billing logic ships as overlay
// template content scaffolded into a generated project's
// `src/modules/billing/marzpay-billing.service.ts` and `src/middleware/tenant.ts`
// (they are NOT top-level exports of create.ts). To exercise the REAL scaffolded
// behavior we read the registered template strings, transpile them to JS,
// neutralize their non-resolvable imports (`streetjs`, `@streetjs/plugin-marzpay`),
// rewire the relative `tenant.js` import, load them as modules, and run
// fast-check against the exported `BillingService` and `orgScopedRepo`.

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

type Ctx = { org?: { id: string } };

/** Constructor type for the scaffolded BillingService. */
type BillingServiceCtor = new (
  repo: Repo,
  plans: BillingConfig,
  client: FakeMarzPayClient,
) => {
  resolvePlan(planId: string): PlanDefinition | null;
  startCheckout(ctx: Ctx, planId: string): Promise<InitResult>;
  recordPayment(ctx: Ctx, event: { reference: string; status: string; amount: number; currency: string; plan?: string }): Promise<BillingRecord>;
};

type OrgScopedRepoFn = (repo: Repo, ctx: Ctx) => Repo;

const TS_OPTS = {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
} as const;

/**
 * Transpile the saas overlay's tenant + billing templates and load the real
 * `orgScopedRepo` and `BillingService`. Non-resolvable imports are neutralized:
 *   - `streetjs` value imports -> local Error subclasses (only the exception
 *     classes are referenced at runtime by these two modules).
 *   - `@streetjs/plugin-marzpay` is a type-only import and is elided by transpile.
 *   - the billing module's relative `../../middleware/tenant.js` import is
 *     rewired to the sibling transpiled `./tenant.mjs`.
 */
async function loadBillingModules(): Promise<{
  BillingService: BillingServiceCtor;
  orgScopedRepo: OrgScopedRepoFn;
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

  const dir = mkdtempSync(join(tmpdir(), 'street-billing-pbt-'));
  writeFileSync(join(dir, 'tenant.mjs'), tenantJs, 'utf8');
  writeFileSync(join(dir, 'billing.mjs'), billingJs, 'utf8');

  const tenantMod = await import(pathToFileURL(join(dir, 'tenant.mjs')).href);
  const billingMod = await import(pathToFileURL(join(dir, 'billing.mjs')).href);

  return {
    BillingService: billingMod.BillingService as BillingServiceCtor,
    orgScopedRepo: tenantMod.orgScopedRepo as OrgScopedRepoFn,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// --- Generators -------------------------------------------------------------

const orgIdArb = fc.stringMatching(/^org_[a-z0-9]{1,6}$/);
const planIdArb = fc.stringMatching(/^plan_[a-z0-9]{1,8}$/);
const currencyArb = fc.constantFrom('UGX', 'USD', 'KES', 'EUR');
const intervalArb = fc.constantFrom('month', 'year', 'week');

/** A set of configured plans with unique ids. */
const plansArb = fc.uniqueArray(
  fc.record({
    id: planIdArb,
    name: fc.stringMatching(/^[A-Za-z ]{1,12}$/),
    amount: fc.integer({ min: 1, max: 5_000_000 }),
    currency: currencyArb,
    interval: intervalArb,
  }),
  { selector: (p) => p.id, minLength: 0, maxLength: 6 },
);

function toConfig(plans: PlanDefinition[]): BillingConfig {
  const map: Record<string, PlanDefinition> = {};
  for (const p of plans) map[p.id] = p;
  return { plans: map };
}

// ---------------------------------------------------------------------------

describe('MarzPay billing PBT', () => {
  let BillingService: BillingServiceCtor;
  let orgScopedRepo: OrgScopedRepoFn;
  let cleanup: () => void = () => {};

  before(async () => {
    const loaded = await loadBillingModules();
    BillingService = loaded.BillingService;
    orgScopedRepo = loaded.orgScopedRepo;
    cleanup = loaded.cleanup;
    assert.equal(typeof BillingService, 'function', 'BillingService must be importable from the overlay');
    assert.equal(typeof orgScopedRepo, 'function', 'orgScopedRepo must be importable from the overlay');
  });

  after(() => cleanup());

  // Feature: marzpay-integration, Property 10: Unknown plans are rejected without persistence
  it('Property 10: unknown planId rejects without persistence; known planId uses the configured definition — Validates: Requirements 6.5, 6.6', async () => {
    await fc.assert(
      fc.asyncProperty(plansArb, planIdArb, orgIdArb, async (plans, requestedPlanId, orgId) => {
        const config = toConfig(plans);
        const known = Object.prototype.hasOwnProperty.call(config.plans, requestedPlanId);

        let insertCount = 0;
        const initCalls: InitArgs[] = [];

        const repo: Repo = {
          find: async () => [],
          findOne: async () => null,
          insert: async (v) => {
            insertCount += 1;
            return { ...(v as BillingRecord) };
          },
          update: async (_f, v) => v as BillingRecord,
        };

        const client: FakeMarzPayClient = {
          initializePayment: async (args) => {
            initCalls.push(args);
            return { reference: args.reference, redirectUrl: 'https://pay.example/r', status: 'pending' };
          },
        };

        const svc = new BillingService(repo, config, client);
        const ctx: Ctx = { org: { id: orgId } };

        if (!known) {
          // Unknown plan: must throw and persist nothing; MarzPay never called.
          await assert.rejects(
            () => svc.startCheckout(ctx, requestedPlanId),
            (err: Error) => /unknown plan/i.test(err.message),
            'unknown planId must throw an "unknown plan" error',
          );
          assert.equal(insertCount, 0, 'no billing record may be persisted for an unknown plan');
          assert.equal(initCalls.length, 0, 'MarzPay must not be invoked for an unknown plan');
        } else {
          // Known plan: succeeds, uses the configured definition, persists exactly one record.
          const plan = config.plans[requestedPlanId]!;
          const result = await svc.startCheckout(ctx, requestedPlanId);
          assert.equal(initCalls.length, 1, 'a known plan must initialize payment exactly once');
          assert.equal(insertCount, 1, 'a known plan must persist exactly one billing record');
          const captured = initCalls[0]!;
          assert.equal(captured.amount, plan.amount, 'the amount must equal the configured plan amount');
          assert.equal(captured.currency, plan.currency, 'the currency must equal the configured plan currency');
          assert.equal(captured.description, plan.name, 'the description must equal the configured plan name');
          assert.equal(result.status, 'pending', 'the checkout result reflects the MarzPay status');
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: marzpay-integration, Property 8: Tenant isolation of billing records
  it('Property 8: a tenant query returns only its own billing records, never another tenant\'s — Validates: Requirements 6.8, 10.2', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(orgIdArb, { minLength: 2, maxLength: 4 }),
        fc.array(
          fc.record({
            orgIdx: fc.nat(),
            reference: fc.stringMatching(/^ref_[a-z0-9]{1,8}$/),
            status: fc.constantFrom('completed', 'failed', 'pending'),
            amount: fc.integer({ min: 1, max: 5_000_000 }),
            currency: currencyArb,
          }),
          { minLength: 1, maxLength: 40 },
        ),
        async (orgs, writes) => {
          // A faithful in-memory store. WORST CASE: find/findOne ignore the
          // org_id filter and expose ALL tenants' rows — the orgScopedRepo
          // wrapper alone must enforce isolation.
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

          // BillingService.recordPayment writes ONLY through orgScopedRepo, so
          // each row is stamped with the active tenant's org_id.
          const svc = new BillingService(repo, { plans: {} }, {
            initializePayment: async (a) => ({ reference: a.reference, status: 'pending' }),
          });

          const expectedByOrg: Record<string, number> = {};
          for (const w of writes) {
            const org = orgs[w.orgIdx % orgs.length]!;
            const ctx: Ctx = { org: { id: org } };
            await svc.recordPayment(ctx, {
              reference: w.reference,
              status: w.status,
              amount: w.amount,
              currency: w.currency,
            });
            expectedByOrg[org] = (expectedByOrg[org] ?? 0) + 1;
          }

          // A query on behalf of each tenant must return ONLY that tenant's rows.
          for (const org of orgs) {
            const scoped = orgScopedRepo(repo, { org: { id: org } });
            const rows = await scoped.find({});
            for (const r of rows) {
              assert.equal(r.org_id, org, 'a tenant query must never return another tenant\'s record');
            }
            assert.equal(
              rows.length,
              expectedByOrg[org] ?? 0,
              'a tenant query must return exactly that tenant\'s billing records',
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
