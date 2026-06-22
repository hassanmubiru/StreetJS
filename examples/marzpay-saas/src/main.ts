// examples/marzpay-saas/src/main.ts
// SaaS billing example built on StreetJS and @streetjs/plugin-marzpay.
//
// Mirrors the `--starter saas --with-marzpay` scaffold pattern: a config-driven,
// org-scoped BillingService plus a CheckoutController and a WebhookController.
// MarzPay is invoked ONLY through the plugin (initializePayment / getTransaction
// / validateWebhook) — there is NO inline MarzPay HTTP API call (Req 13.3).
//
//   POST /billing/checkout   (header x-org-id) -> BillingService.startCheckout
//   GET  /billing/records    (header x-org-id) -> tenant-scoped billing records
//   POST /webhooks/marzpay                      -> validate-before-persist
//
// Tenant isolation: every billing record is scoped to the active org via an
// org-scoped repository, so a record created for one tenant is never returned in
// a query made on behalf of another (Requirement 6.8 pattern).
//
// Webhook security (Requirement 6.3/6.4 pattern): the WebhookController calls
// client.validateWebhook on the raw body BEFORE any persistence; a negative
// result rejects with "webhook validation failed" and writes nothing. Because
// MarzPay documents no webhook signature scheme (research §L4), validateWebhook
// returns false for absent/unverifiable material — the documented trust path is
// server-side re-verification via getTransaction.

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { streetApp, type StreetContext, type SandboxedApp } from 'streetjs';
import { MarzPayPlugin, type MarzPayClient } from '@streetjs/plugin-marzpay';

// ── Startup env-var guard (Requirement 13.5) ───────────────────────────────────

const REQUIRED_ENV_VARS = ['MARZPAY_API_KEY', 'MARZPAY_SECRET', 'MARZPAY_ENVIRONMENT'] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    console.error(`[marzpay-saas] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value.trim();
}

for (const name of REQUIRED_ENV_VARS) {
  requireEnv(name);
}

const apiKey = requireEnv('MARZPAY_API_KEY');
const secretKey = requireEnv('MARZPAY_SECRET');
const environmentRaw = requireEnv('MARZPAY_ENVIRONMENT');
if (environmentRaw !== 'sandbox' && environmentRaw !== 'production') {
  console.error(
    `[marzpay-saas] Invalid MARZPAY_ENVIRONMENT="${environmentRaw}" (expected "sandbox" or "production")`,
  );
  process.exit(1);
}
const environment = environmentRaw;
const port = parseInt(process.env['PORT'] ?? '3002', 10);

// ── Plan configuration (read from config, never hardcoded in the logic) ─────────

interface PlanDefinition {
  id: string;
  name: string;
  amount: number;
  currency: string;
}

interface BillingConfig {
  plans: Record<string, PlanDefinition>;
}

const billingConfig: BillingConfig = {
  plans: {
    starter: { id: 'starter', name: 'Starter', amount: 10000, currency: 'UGX' },
    team: { id: 'team', name: 'Team', amount: 50000, currency: 'UGX' },
  },
};

// ── Org-scoped repository (tenant discriminator: org_id) ────────────────────────

interface BillingRecord {
  id: string;
  org_id: string;
  plan: string;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  created_at: string;
}

/**
 * Minimal in-memory org-scoped repo. Writes stamp the active org_id (the payload
 * cannot override it) and reads filter by it, so tenants are isolated.
 */
class OrgScopedBillingRepo {
  private readonly rows: BillingRecord[] = [];

  insert(orgId: string, row: Omit<BillingRecord, 'id' | 'org_id'>): BillingRecord {
    const record: BillingRecord = { id: randomUUID(), org_id: orgId, ...row };
    this.rows.push(record);
    return record;
  }

  find(orgId: string): BillingRecord[] {
    return this.rows.filter((r) => r.org_id === orgId);
  }
}

// ── BillingService — config-driven plan resolution + org-scoped persistence ─────

interface VerifiedWebhookEvent {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  plan?: string;
}

class BillingService {
  constructor(
    private readonly repo: OrgScopedBillingRepo,
    private readonly config: BillingConfig,
    private readonly client: MarzPayClient,
  ) {}

  resolvePlan(planId: string): PlanDefinition | null {
    return this.config.plans[planId] ?? null;
  }

  /** Start a checkout for a configured plan; unknown plan -> throw, persist nothing. */
  async startCheckout(orgId: string, planId: string): Promise<BillingRecord> {
    const plan = this.resolvePlan(planId);
    if (!plan) {
      throw new Error(`unknown plan: ${planId}`);
    }
    const init = await this.client.initializePayment({
      amount: plan.amount,
      currency: plan.currency,
      country: 'UG',
      reference: randomUUID(),
      method: 'card',
      description: plan.name,
    });
    return this.repo.insert(orgId, {
      plan: planId,
      status: init.status,
      reference: init.reference,
      amount: plan.amount,
      currency: plan.currency,
      created_at: new Date().toISOString(),
    });
  }

  /** Record a settled payment from a verified webhook event (org-scoped). */
  recordPayment(orgId: string, event: VerifiedWebhookEvent): BillingRecord {
    return this.repo.insert(orgId, {
      plan: event.plan ?? '',
      status: event.status,
      reference: event.reference,
      amount: event.amount,
      currency: event.currency,
      created_at: new Date().toISOString(),
    });
  }

  list(orgId: string): BillingRecord[] {
    return this.repo.find(orgId);
  }
}

// ── App + plugin wiring ─────────────────────────────────────────────────────────

const app = streetApp({ port });
const marzpay = MarzPayPlugin({ apiKey, secretKey, environment, stateKey: 'marzpay' });

// The plugin's `onLoad` expects a SandboxedApp (exposing `use` + `on`).
function sandboxFor(application: typeof app): SandboxedApp {
  return {
    use: (middleware) => application.use(middleware),
    on: () => {},
  };
}

const repo = new OrgScopedBillingRepo();
let billing: BillingService | null = null;
function service(ctx: StreetContext): BillingService {
  if (billing === null) {
    billing = new BillingService(repo, billingConfig, ctx.state['marzpay'] as MarzPayClient);
  }
  return billing;
}

function activeOrg(ctx: StreetContext): string | null {
  const org = ctx.headers['x-org-id'];
  return typeof org === 'string' && org.trim() !== '' ? org.trim() : null;
}

const MARZPAY_SIGNATURE_HEADER = 'x-marzpay-signature';

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /billing/checkout — start a MarzPay checkout for a configured plan.
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/billing/checkout') {
    const orgId = activeOrg(ctx);
    if (!orgId) {
      ctx.json({ error: 'x-org-id header is required (active tenant)' }, 401);
      return;
    }
    const body = (ctx.body ?? {}) as { planId?: unknown };
    const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
    if (!planId) {
      ctx.json({ error: 'planId is required' }, 400);
      return;
    }
    try {
      const record = await service(ctx).startCheckout(orgId, planId);
      ctx.json(record, 200);
    } catch (err) {
      const message = (err as Error).message;
      ctx.json({ error: message }, message.startsWith('unknown plan') ? 400 : 502);
    }
    return;
  }
  await next();
});

// GET /billing/records — list the active tenant's billing records.
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/billing/records') {
    const orgId = activeOrg(ctx);
    if (!orgId) {
      ctx.json({ error: 'x-org-id header is required (active tenant)' }, 401);
      return;
    }
    ctx.json({ data: service(ctx).list(orgId) }, 200);
    return;
  }
  await next();
});

// POST /webhooks/marzpay — validate BEFORE persisting.
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/webhooks/marzpay') {
    const client = ctx.state['marzpay'] as MarzPayClient;

    // NOTE: a production app must capture the VERBATIM raw body via a raw-body
    // middleware before JSON parsing. Re-serializing the parsed body (below) is
    // a demonstration shim; it does not affect the outcome here because MarzPay
    // documents no signature scheme, so validateWebhook returns false and the
    // conservative negative path is taken until a scheme is published.
    const rawBody = typeof ctx.body === 'string' ? ctx.body : JSON.stringify(ctx.body ?? {});
    const signature = ctx.headers[MARZPAY_SIGNATURE_HEADER];

    // Validate BEFORE any persistence.
    if (!client.validateWebhook(rawBody, signature)) {
      ctx.json({ error: 'webhook validation failed' }, 400);
      return;
    }

    // Positive result: re-verify server-side (documented trust path) then persist.
    const orgId = activeOrg(ctx);
    if (!orgId) {
      ctx.json({ error: 'x-org-id header is required (active tenant)' }, 401);
      return;
    }
    const parsed = (ctx.body ?? {}) as { transaction?: { reference?: unknown } };
    const reference =
      typeof parsed.transaction?.reference === 'string' ? parsed.transaction.reference.trim() : '';
    if (!reference) {
      ctx.json({ error: 'webhook payload missing transaction.reference' }, 400);
      return;
    }
    try {
      const txn = await client.getTransaction(reference);
      service(ctx).recordPayment(orgId, {
        reference: txn.reference,
        status: txn.status,
        amount: txn.amount,
        currency: txn.currency,
      });
      ctx.json({ received: true }, 200);
    } catch (err) {
      ctx.json({ error: 'webhook processing failed', detail: (err as Error).message }, 502);
    }
    return;
  }
  await next();
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  await marzpay.onInstall();
  await marzpay.onLoad(sandboxFor(app));
  await app.listen(port, '0.0.0.0');
  console.log(`🏢 MarzPay SaaS billing example running on http://localhost:${port} (env: ${environment})`);
  console.log(`   Configured plans: ${Object.keys(billingConfig.plans).join(', ')}`);
  console.log('\nTry:');
  console.log(`  curl -s -X POST http://localhost:${port}/billing/checkout \\`);
  console.log(`       -H 'Content-Type: application/json' -H 'x-org-id: org-123' \\`);
  console.log(`       -d '{"planId":"starter"}'`);
}

bootstrap().catch((err) => {
  console.error('[marzpay-saas] failed to start:', (err as Error).message);
  process.exit(1);
});
