// packages/cli/src/tests/marzpay-property-9-unknown-plan.pbt.test.ts
// Property-based test for the scaffolded SaaS MarzPay billing module (Task 11.9).
//
//   Feature: marzpay-scope-alignment, Property 9: Unknown plans are rejected
//   without persistence or network.
//
//   For any planId absent from the configured plans, BillingService.startCheckout
//   throws an unknown-plan error, the backing repository receives NO insert, and
//   the MarzPayClient is NEVER invoked. For any configured planId, the plan used
//   equals the configured definition (amount/currency/name).
//
//   **Validates: Requirements 9.4**
//
// Like marzpay-billing-pbt.test.ts, the billing logic ships as overlay template
// content scaffolded into a generated project's
// `src/modules/billing/marzpay-billing.service.ts` (it is NOT a top-level export
// of create.ts). To exercise the REAL scaffolded behavior we read the registered
// template strings, transpile them to JS, neutralize their non-resolvable imports
// (`streetjs`, `@streetjs/plugin-marzpay`), rewire the relative `tenant.js`
// import, load them as modules, and run fast-check against the exported
// `BillingService` (backed by an in-memory org-scoped repo) and a spy
// MarzPayClient that counts `initializePayment` calls.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { transpileModule, ModuleKind, ScriptTarget } from './ts-transpile-helper.js';
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
};

type OrgScopedRepoFn = (repo: Repo, ctx: Ctx) => Repo;

const TS_OPTS = {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
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

  const dir = mkdtempSync(join(tmpdir(), 'street-prop9-pbt-'));
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

describe('MarzPay billing PBT — Property 9', () => {
  let BillingService: BillingServiceCtor;
  let cleanup: () => void = () => {};

  before(async () => {
    const loaded = await loadBillingModules();
    BillingService = loaded.BillingService;
    cleanup = loaded.cleanup;
    assert.equal(typeof BillingService, 'function', 'BillingService must be importable from the overlay');
  });

  after(() => cleanup());

  // Feature: marzpay-scope-alignment, Property 9: Unknown plans are rejected without persistence or network
  it('Property 9: unknown planId rejects with no insert and no MarzPay call; known planId resolves to its configured definition — Validates: Requirements 9.4', async () => {
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
          // Unknown plan: must throw an "unknown plan" error, persist nothing,
          // and never invoke MarzPay.
          await assert.rejects(
            () => svc.startCheckout(ctx, requestedPlanId),
            (err: Error) => /unknown plan/i.test(err.message),
            'an unknown planId must throw an "unknown plan" error',
          );
          assert.equal(insertCount, 0, 'no billing record may be persisted for an unknown plan');
          assert.equal(initCalls.length, 0, 'MarzPay must not be invoked for an unknown plan');
          // resolvePlan must also agree the plan is unknown.
          assert.equal(svc.resolvePlan(requestedPlanId), null, 'resolvePlan must return null for an unknown plan');
        } else {
          // Known plan: the plan used must equal the configured definition.
          const plan = config.plans[requestedPlanId]!;
          const resolved = svc.resolvePlan(requestedPlanId);
          assert.deepEqual(resolved, plan, 'resolvePlan must return the configured plan definition');

          await svc.startCheckout(ctx, requestedPlanId);
          assert.equal(initCalls.length, 1, 'a known plan must initialize payment exactly once');
          assert.equal(insertCount, 1, 'a known plan must persist exactly one billing record');
          const captured = initCalls[0]!;
          assert.equal(captured.amount, plan.amount, 'the amount used must equal the configured plan amount');
          assert.equal(captured.currency, plan.currency, 'the currency used must equal the configured plan currency');
          assert.equal(captured.description, plan.name, 'the description used must equal the configured plan name');
        }
      }),
      { numRuns: 200 },
    );
  });
});
