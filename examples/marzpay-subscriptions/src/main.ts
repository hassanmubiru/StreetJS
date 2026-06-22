// examples/marzpay-subscriptions/src/main.ts
// MarzPay subscription-style billing example built on StreetJS.
//
// VERIFY-DON'T-INVENT (docs/integrations/marzpay-research.md): MarzPay exposes
// NO native recurring-billing / subscription API. This example therefore does
// NOT call an invented subscription endpoint. Instead it COMPOSES a
// subscription from the one verified primitive — an operator-triggered
// "collect money" per billing cycle — through the plugin's
// `MarzPayClient.initializePayment`. Cycle scheduling/charging is performed by
// this application's `SubscriptionService`, while every MarzPay call goes
// through @streetjs/plugin-marzpay (no inline MarzPay HTTP call — Req 13.3).
//
//   POST /subscriptions              -> create + charge first cycle (initializePayment)
//   POST /subscriptions/:id/charge   -> operator-triggered cycle charge (initializePayment)
//   GET  /subscriptions/:id          -> subscription record
//   GET  /subscriptions/:id/verify   -> verify the latest cycle (verifyPayment)

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { streetApp, type StreetContext } from 'streetjs';
import { MarzPayPlugin, type MarzPayClient } from '@streetjs/plugin-marzpay';

// ── Startup env-var guard (Requirement 13.5) ───────────────────────────────────

const REQUIRED_ENV_VARS = ['MARZPAY_API_KEY', 'MARZPAY_SECRET', 'MARZPAY_ENVIRONMENT'] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    console.error(`[marzpay-subscriptions] Missing required environment variable: ${name}`);
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
    `[marzpay-subscriptions] Invalid MARZPAY_ENVIRONMENT="${environmentRaw}" (expected "sandbox" or "production")`,
  );
  process.exit(1);
}
const environment = environmentRaw;
const port = parseInt(process.env['PORT'] ?? '3001', 10);

// ── Plan configuration (read from config, never hardcoded in the logic) ─────────

interface PlanDefinition {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: 'week' | 'month' | 'year';
}

interface BillingConfig {
  plans: Record<string, PlanDefinition>;
}

const billingConfig: BillingConfig = {
  plans: {
    basic: { id: 'basic', name: 'Basic', amount: 5000, currency: 'UGX', interval: 'month' },
    pro: { id: 'pro', name: 'Pro', amount: 25000, currency: 'UGX', interval: 'month' },
  },
};

// ── SubscriptionService — composes cycles from the verified collect-money primitive

interface SubscriptionRecord {
  id: string;
  plan: string;
  phoneNumber: string;
  status: 'active' | 'canceled';
  cycles: number;
  lastReference: string | null;
  nextChargeAt: string;
}

class SubscriptionService {
  private readonly store = new Map<string, SubscriptionRecord>();

  constructor(
    private readonly client: MarzPayClient,
    private readonly config: BillingConfig,
  ) {}

  resolvePlan(planId: string): PlanDefinition | null {
    return this.config.plans[planId] ?? null;
  }

  /** Create a subscription and charge the first cycle through the plugin. */
  async create(planId: string, phoneNumber: string): Promise<SubscriptionRecord> {
    const plan = this.resolvePlan(planId);
    if (!plan) {
      throw new Error(`unknown plan: ${planId}`);
    }
    const record: SubscriptionRecord = {
      id: randomUUID(),
      plan: plan.id,
      phoneNumber,
      status: 'active',
      cycles: 0,
      lastReference: null,
      nextChargeAt: new Date().toISOString(),
    };
    this.store.set(record.id, record);
    await this.chargeCycle(record.id);
    return this.get(record.id)!;
  }

  /**
   * Operator-triggered cycle charge: the verified `collect-money` primitive via
   * the plugin. This is what an external scheduler would invoke each interval.
   */
  async chargeCycle(subscriptionId: string): Promise<{ reference: string; status: string }> {
    const record = this.store.get(subscriptionId);
    if (!record) {
      throw new Error(`unknown subscription: ${subscriptionId}`);
    }
    if (record.status !== 'active') {
      throw new Error(`subscription is not active: ${subscriptionId}`);
    }
    const plan = this.resolvePlan(record.plan);
    if (!plan) {
      throw new Error(`unknown plan: ${record.plan}`);
    }

    const init = await this.client.initializePayment({
      amount: plan.amount,
      currency: plan.currency,
      country: 'UG',
      reference: randomUUID(),
      phone_number: record.phoneNumber,
      description: `${plan.name} subscription cycle ${record.cycles + 1}`,
    });

    record.cycles += 1;
    record.lastReference = init.reference;
    record.nextChargeAt = this.nextPeriodEnd(plan);
    this.store.set(record.id, record);
    return { reference: init.reference, status: init.status };
  }

  /** Verify the latest cycle's payment status through the plugin. */
  async verifyLatest(subscriptionId: string): Promise<{ reference: string; status: string }> {
    const record = this.store.get(subscriptionId);
    if (!record || record.lastReference === null) {
      throw new Error(`no charge to verify for subscription: ${subscriptionId}`);
    }
    return this.client.verifyPayment(record.lastReference);
  }

  cancel(subscriptionId: string): SubscriptionRecord {
    const record = this.store.get(subscriptionId);
    if (!record) {
      throw new Error(`unknown subscription: ${subscriptionId}`);
    }
    record.status = 'canceled';
    this.store.set(record.id, record);
    return record;
  }

  get(subscriptionId: string): SubscriptionRecord | null {
    return this.store.get(subscriptionId) ?? null;
  }

  private nextPeriodEnd(plan: PlanDefinition): string {
    const day = 24 * 60 * 60 * 1000;
    const span = plan.interval === 'year' ? 365 * day : plan.interval === 'week' ? 7 * day : 30 * day;
    return new Date(Date.now() + span).toISOString();
  }
}

// ── App + plugin wiring ─────────────────────────────────────────────────────────

const app = streetApp({ port });
const marzpay = MarzPayPlugin({ apiKey, secretKey, environment, stateKey: 'marzpay' });

// One SubscriptionService, lazily bound to the client injected by the plugin.
let subscriptions: SubscriptionService | null = null;
function service(ctx: StreetContext): SubscriptionService {
  if (subscriptions === null) {
    subscriptions = new SubscriptionService(ctx.state['marzpay'] as MarzPayClient, billingConfig);
  }
  return subscriptions;
}

function badRequest(ctx: StreetContext, message: string): void {
  ctx.json({ error: message }, 400);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /subscriptions — create a subscription and charge the first cycle.
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/subscriptions') {
    const body = (ctx.body ?? {}) as { planId?: unknown; phoneNumber?: unknown };
    const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
    const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber.trim() : '';
    if (!planId) return badRequest(ctx, 'planId is required');
    if (!phoneNumber) return badRequest(ctx, 'phoneNumber is required');
    try {
      const record = await service(ctx).create(planId, phoneNumber);
      ctx.json(record, 201);
    } catch (err) {
      const message = (err as Error).message;
      ctx.json({ error: message }, message.startsWith('unknown plan') ? 400 : 502);
    }
    return;
  }
  await next();
});

// POST /subscriptions/:id/charge — operator-triggered cycle charge.
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && /^\/subscriptions\/[^/]+\/charge$/.test(ctx.path)) {
    const id = decodeURIComponent(ctx.path.split('/')[2] ?? '');
    try {
      const result = await service(ctx).chargeCycle(id);
      ctx.json(result, 200);
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 400);
    }
    return;
  }
  await next();
});

// GET /subscriptions/:id/verify — verify the latest cycle.
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && /^\/subscriptions\/[^/]+\/verify$/.test(ctx.path)) {
    const id = decodeURIComponent(ctx.path.split('/')[2] ?? '');
    try {
      const result = await service(ctx).verifyLatest(id);
      ctx.json(result, 200);
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 400);
    }
    return;
  }
  await next();
});

// GET /subscriptions/:id — fetch a subscription record.
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && /^\/subscriptions\/[^/]+$/.test(ctx.path)) {
    const id = decodeURIComponent(ctx.path.split('/')[2] ?? '');
    const record = service(ctx).get(id);
    if (!record) {
      ctx.json({ error: 'subscription not found' }, 404);
      return;
    }
    ctx.json(record, 200);
    return;
  }
  await next();
});

// DELETE /subscriptions/:id — cancel a subscription.
app.use(async (ctx, next) => {
  if (ctx.method === 'DELETE' && /^\/subscriptions\/[^/]+$/.test(ctx.path)) {
    const id = decodeURIComponent(ctx.path.split('/')[2] ?? '');
    try {
      ctx.json(service(ctx).cancel(id), 200);
    } catch (err) {
      ctx.json({ error: (err as Error).message }, 404);
    }
    return;
  }
  await next();
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  await marzpay.onInstall();
  await marzpay.onLoad(app);
  await app.listen(port, '0.0.0.0');
  console.log(`🔁 MarzPay subscriptions example running on http://localhost:${port} (env: ${environment})`);
  console.log(`   Configured plans: ${Object.keys(billingConfig.plans).join(', ')}`);
  console.log('\nTry:');
  console.log(`  curl -s -X POST http://localhost:${port}/subscriptions \\`);
  console.log(`       -H 'Content-Type: application/json' \\`);
  console.log(`       -d '{"planId":"basic","phoneNumber":"+256700000000"}'`);
}

bootstrap().catch((err) => {
  console.error('[marzpay-subscriptions] failed to start:', (err as Error).message);
  process.exit(1);
});
