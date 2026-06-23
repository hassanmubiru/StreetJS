// packages/cli/src/tests/marzpay-subscription.test.ts
// Unit tests for the scaffolded SaaS MarzPay SubscriptionService lifecycle.
//
// Requirement 14.1 names the subscription lifecycle stages — creation, renewal,
// cancellation, and expiration — as part of the documented unit-test scope. The
// scaffolded SubscriptionService ships as overlay TEMPLATE content (NOT a
// top-level export of create.ts) at
// `src/modules/billing/marzpay-subscription.service.ts` under `--with-marzpay`.
//
// Like marzpay-billing-pbt.test.ts, we read the registered template strings for
// the tenant middleware and the subscription service, transpile them to JS,
// neutralize their non-resolvable imports (`streetjs` exception classes), rewire
// the relative `tenant.js` import, load them as modules, and drive the REAL
// scaffolded `SubscriptionService` against an in-memory org-scoped repository.
//
// Validates: Requirements 14.1, 6.5, 6.6, 6.8

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

// --- Minimal structural mirrors of the scaffolded contracts ----------------

interface SubscriptionRecord {
  id: string;
  org_id: string;
  plan: string;
  status: 'active' | 'canceled' | 'expired';
  current_period_end: string | null;
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

interface Repo {
  find(filter: Record<string, unknown>): Promise<SubscriptionRecord[]>;
  findOne(filter: Record<string, unknown>): Promise<SubscriptionRecord | null>;
  insert(values: Partial<SubscriptionRecord>): Promise<SubscriptionRecord>;
  update(filter: Record<string, unknown>, values: Partial<SubscriptionRecord>): Promise<SubscriptionRecord>;
}

type Ctx = { org?: { id: string } };

type SubscriptionServiceCtor = new (
  repo: Repo,
  plans: BillingConfig,
) => {
  create(ctx: Ctx, planId: string): Promise<SubscriptionRecord>;
  renew(ctx: Ctx, subscriptionId: string): Promise<SubscriptionRecord>;
  cancel(ctx: Ctx, subscriptionId: string): Promise<SubscriptionRecord>;
  expire(ctx: Ctx, subscriptionId: string): Promise<SubscriptionRecord>;
  listSubscriptions(ctx: Ctx): Promise<SubscriptionRecord[]>;
};

const TS_OPTS = {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
} as const;

/**
 * Transpile the saas overlay's tenant + subscription templates and load the REAL
 * `SubscriptionService`. Non-resolvable imports are neutralized:
 *   - `streetjs` value imports -> local Error subclasses (only the exception
 *     classes are referenced at runtime by these modules).
 *   - the billing-service import in the subscription module is type-only and is
 *     elided by transpilation.
 *   - the subscription module's relative `../../middleware/tenant.js` import is
 *     rewired to the sibling transpiled `./tenant.mjs`.
 */
async function loadSubscriptionModule(): Promise<{
  SubscriptionService: SubscriptionServiceCtor;
  cleanup: () => void;
}> {
  const tenantFile = TEMPLATES.saas.extraFiles?.find((f) => f.path === 'src/middleware/tenant.ts');
  const subFile = TEMPLATES.saas.extraFiles?.find(
    (f) => f.path === 'src/modules/billing/marzpay-subscription.service.ts',
  );
  assert.ok(tenantFile, 'saas overlay must register src/middleware/tenant.ts');
  assert.ok(subFile, 'saas overlay must register the marzpay subscription service');

  const tenantJs = ts
    .transpileModule(tenantFile!.content, TS_OPTS)
    .outputText.replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'class ForbiddenException extends Error {} class UnauthorizedException extends Error {}',
    );

  const subJs = ts
    .transpileModule(subFile!.content, TS_OPTS)
    .outputText.replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'class BadRequestException extends Error {}',
    )
    .replace(/['"]\.\.\/\.\.\/middleware\/tenant\.js['"]/, "'./tenant.mjs'");

  const dir = mkdtempSync(join(tmpdir(), 'street-subscription-test-'));
  writeFileSync(join(dir, 'tenant.mjs'), tenantJs, 'utf8');
  writeFileSync(join(dir, 'subscription.mjs'), subJs, 'utf8');

  const subMod = await import(pathToFileURL(join(dir, 'subscription.mjs')).href);

  return {
    SubscriptionService: subMod.SubscriptionService as SubscriptionServiceCtor,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// --- In-memory org-scoped backing repository --------------------------------

function rowMatches(row: SubscriptionRecord, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v);
}

/** A faithful in-memory store honoring find/findOne/insert/update by filter. */
function makeRepo(): Repo & { rows: SubscriptionRecord[] } {
  const rows: SubscriptionRecord[] = [];
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
      const row = { ...(values as SubscriptionRecord), id: (values as { id?: string }).id ?? `sub_${++seq}` };
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

const PLANS: BillingConfig = {
  plans: {
    pro: { id: 'pro', name: 'Pro', amount: 50000, currency: 'UGX', interval: 'month' },
    annual: { id: 'annual', name: 'Annual', amount: 500000, currency: 'UGX', interval: 'year' },
  },
};

// ---------------------------------------------------------------------------

describe('MarzPay SubscriptionService lifecycle (unit) — Validates: Requirement 14.1', () => {
  let SubscriptionService: SubscriptionServiceCtor;
  let cleanup: () => void = () => {};

  before(async () => {
    const loaded = await loadSubscriptionModule();
    SubscriptionService = loaded.SubscriptionService;
    cleanup = loaded.cleanup;
    assert.equal(typeof SubscriptionService, 'function', 'SubscriptionService must be importable from the overlay');
  });

  after(() => cleanup());

  // ── create ────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('creates exactly one active, org-scoped subscription for a configured plan', async () => {
      const repo = makeRepo();
      const svc = new SubscriptionService(repo, PLANS);
      const ctx: Ctx = { org: { id: 'org_a' } };

      const sub = await svc.create(ctx, 'pro');

      assert.equal(repo.rows.length, 1, 'exactly one record is persisted');
      assert.equal(sub.plan, 'pro');
      assert.equal(sub.status, 'active', 'a new subscription is active');
      assert.equal(sub.org_id, 'org_a', 'org_id is stamped from the active tenant');
      assert.ok(sub.current_period_end, 'a period end is set on creation');
      assert.ok(!Number.isNaN(Date.parse(sub.current_period_end!)), 'period end is an ISO timestamp');
    });

    it('rejects an unknown plan and persists NOTHING', async () => {
      const repo = makeRepo();
      const svc = new SubscriptionService(repo, PLANS);
      const ctx: Ctx = { org: { id: 'org_a' } };

      await assert.rejects(
        () => svc.create(ctx, 'does_not_exist'),
        (err: Error) => /unknown plan/i.test(err.message),
        'an unknown plan must throw an "unknown plan" error',
      );
      assert.equal(repo.rows.length, 0, 'no subscription may be persisted for an unknown plan');
    });
  });

  // ── renew ───────────────────────────────────────────────────────────────
  describe('renew', () => {
    it('renews an existing subscription: stays active and advances the period end', async () => {
      const repo = makeRepo();
      const svc = new SubscriptionService(repo, PLANS);
      const ctx: Ctx = { org: { id: 'org_a' } };

      const created = await svc.create(ctx, 'pro');
      // Force an already-elapsed period end so renewal must advance it.
      repo.rows[0]!.current_period_end = new Date(Date.now() - 1000).toISOString();
      const elapsed = repo.rows[0]!.current_period_end!;

      const renewed = await svc.renew(ctx, created.id);

      assert.equal(renewed.id, created.id, 'the same subscription is renewed');
      assert.equal(renewed.status, 'active', 'a renewed subscription is active');
      assert.ok(
        Date.parse(renewed.current_period_end!) > Date.parse(elapsed),
        'renewal advances current_period_end into the future',
      );
      assert.equal(repo.rows.length, 1, 'renewal updates in place (no new row)');
    });

    it('rejects renewing an unknown subscription id', async () => {
      const repo = makeRepo();
      const svc = new SubscriptionService(repo, PLANS);
      const ctx: Ctx = { org: { id: 'org_a' } };

      await assert.rejects(
        () => svc.renew(ctx, 'sub_missing'),
        (err: Error) => /unknown subscription/i.test(err.message),
        'renewing an absent subscription must throw an "unknown subscription" error',
      );
    });

    it('rejects renewal when the subscription plan is no longer configured', async () => {
      const repo = makeRepo();
      const svc = new SubscriptionService(repo, PLANS);
      const ctx: Ctx = { org: { id: 'org_a' } };
      const created = await svc.create(ctx, 'pro');

      // Plan removed from configuration after the subscription was created.
      repo.rows[0]!.plan = 'retired_plan';

      await assert.rejects(
        () => svc.renew(ctx, created.id),
        (err: Error) => /unknown plan/i.test(err.message),
        'renewal of a now-unconfigured plan must throw an "unknown plan" error',
      );
    });
  });

  // ── cancel ──────────────────────────────────────────────────────────────
  describe('cancel', () => {
    it('marks an existing subscription canceled in place', async () => {
      const repo = makeRepo();
      const svc = new SubscriptionService(repo, PLANS);
      const ctx: Ctx = { org: { id: 'org_a' } };
      const created = await svc.create(ctx, 'pro');

      const canceled = await svc.cancel(ctx, created.id);

      assert.equal(canceled.id, created.id);
      assert.equal(canceled.status, 'canceled', 'cancellation sets status to canceled');
      assert.equal(repo.rows.length, 1, 'cancellation updates in place');
      assert.equal(repo.rows[0]!.status, 'canceled');
    });
  });

  // ── expire ──────────────────────────────────────────────────────────────
  describe('expire', () => {
    it('marks an existing subscription expired in place', async () => {
      const repo = makeRepo();
      const svc = new SubscriptionService(repo, PLANS);
      const ctx: Ctx = { org: { id: 'org_a' } };
      const created = await svc.create(ctx, 'annual');

      const expired = await svc.expire(ctx, created.id);

      assert.equal(expired.id, created.id);
      assert.equal(expired.status, 'expired', 'expiration sets status to expired');
      assert.equal(repo.rows[0]!.status, 'expired');
    });
  });

  // ── tenant isolation across the lifecycle ─────────────────────────────────
  describe('tenant isolation', () => {
    it('a subscription created by one tenant cannot be canceled by another tenant', async () => {
      const repo = makeRepo();
      const svc = new SubscriptionService(repo, PLANS);
      const owner: Ctx = { org: { id: 'org_a' } };
      const other: Ctx = { org: { id: 'org_b' } };

      const created = await svc.create(owner, 'pro');

      await assert.rejects(
        () => svc.cancel(other, created.id),
        (err: Error) => /cross-tenant|not found/i.test(err.message),
        'another tenant must not be able to cancel a foreign subscription',
      );
      // The original record is untouched and still belongs to org_a.
      assert.equal(repo.rows[0]!.status, 'active');
      assert.equal(repo.rows[0]!.org_id, 'org_a');

      // The owner still sees only its own subscription.
      const ownerList = await svc.listSubscriptions(owner);
      assert.equal(ownerList.length, 1);
      const otherList = await svc.listSubscriptions(other);
      assert.equal(otherList.length, 0, 'another tenant sees none of org_a\'s subscriptions');
    });
  });
});
