// examples/marzpay-checkout/src/main.ts
// Minimal MarzPay checkout example built on StreetJS.
//
// Demonstrates a one-off payment flow:
//   POST /checkout           -> MarzPayClient.initializePayment (POST /collect-money)
//   GET  /checkout/:reference -> MarzPayClient.verifyPayment  (GET /transactions/{ref})
//
// MarzPay is invoked ONLY through @streetjs/plugin-marzpay. There is NO inline
// MarzPay HTTP API call anywhere in this example (Requirement 13.3): the plugin
// injects a MarzPayClient onto `ctx.state.marzpay` and every operation goes
// through that client.

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { streetApp, type StreetContext, type SandboxedApp } from 'streetjs';
import { MarzPayPlugin, type MarzPayClient } from '@streetjs/plugin-marzpay';

// ── Startup env-var guard (Requirement 13.5) ───────────────────────────────────
// A required env var that is unset (or blank) terminates the process with a
// non-zero status and an error message naming the missing variable. See README
// for the complete required env-var list.

const REQUIRED_ENV_VARS = ['MARZPAY_API_KEY', 'MARZPAY_SECRET', 'MARZPAY_ENVIRONMENT'] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    console.error(`[marzpay-checkout] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value.trim();
}

// Check every required variable up front so the operator sees the first missing
// name and the process exits before any server is started.
for (const name of REQUIRED_ENV_VARS) {
  requireEnv(name);
}

const apiKey = requireEnv('MARZPAY_API_KEY');
const secretKey = requireEnv('MARZPAY_SECRET');
const environmentRaw = requireEnv('MARZPAY_ENVIRONMENT');
if (environmentRaw !== 'sandbox' && environmentRaw !== 'production') {
  console.error(
    `[marzpay-checkout] Invalid MARZPAY_ENVIRONMENT="${environmentRaw}" (expected "sandbox" or "production")`,
  );
  process.exit(1);
}
const environment = environmentRaw;
const port = parseInt(process.env['PORT'] ?? '3000', 10);

// ── App + plugin wiring ─────────────────────────────────────────────────────────

const app = streetApp({ port });

// The plugin's `onLoad` expects a SandboxedApp (a restricted view exposing
// `use` + `on`). StreetApp provides `use`; this example registers no framework
// lifecycle listeners, so `on` is a no-op here.
function sandboxFor(application: typeof app): SandboxedApp {
  return {
    use: (middleware) => application.use(middleware),
    on: () => {},
  };
}

// Register the MarzPay plugin. Its lifecycle injects exactly one MarzPayClient
// onto `ctx.state[stateKey]` (default "marzpay"). We drive the documented plugin
// lifecycle (onInstall validates config; onLoad registers the injection
// middleware) so the example talks to MarzPay only through the plugin.
const marzpay = MarzPayPlugin({ apiKey, secretKey, environment, stateKey: 'marzpay' });

function client(ctx: StreetContext): MarzPayClient {
  return ctx.state['marzpay'] as MarzPayClient;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /checkout — initialize a payment via the plugin.
// Body: { amount: number, phoneNumber?: string, method?: "card", description?: string }
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/checkout') {
    const body = (ctx.body ?? {}) as {
      amount?: unknown;
      phoneNumber?: unknown;
      method?: unknown;
      description?: unknown;
    };
    const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      ctx.json({ error: 'amount is required and must be a positive number' }, 400);
      return;
    }
    const isCard = body.method === 'card';
    const phoneNumber = typeof body.phoneNumber === 'string' ? body.phoneNumber : undefined;
    if (!isCard && (phoneNumber === undefined || phoneNumber.trim() === '')) {
      ctx.json({ error: 'provide "phoneNumber" (mobile money) or set "method" to "card"' }, 400);
      return;
    }

    try {
      const result = await client(ctx).initializePayment({
        amount,
        country: 'UG',
        reference: randomUUID(),
        ...(isCard ? { method: 'card' as const } : { phone_number: phoneNumber }),
        ...(typeof body.description === 'string' ? { description: body.description } : {}),
      });
      ctx.json(result, 200);
    } catch (err) {
      ctx.json({ error: 'payment initialization failed', detail: (err as Error).message }, 502);
    }
    return;
  }
  await next();
});

// GET /checkout/:reference — verify a payment via the plugin.
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path.startsWith('/checkout/')) {
    const reference = decodeURIComponent(ctx.path.slice('/checkout/'.length));
    if (reference === '') {
      ctx.json({ error: 'reference is required' }, 400);
      return;
    }
    try {
      const status = await client(ctx).verifyPayment(reference);
      ctx.json(status, 200);
    } catch (err) {
      ctx.json({ error: 'payment verification failed', detail: (err as Error).message }, 502);
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
  console.log(`💳 MarzPay checkout example running on http://localhost:${port} (env: ${environment})`);
  console.log('\nTry:');
  console.log(`  curl -s -X POST http://localhost:${port}/checkout \\`);
  console.log(`       -H 'Content-Type: application/json' \\`);
  console.log(`       -d '{"amount":5000,"phoneNumber":"+256700000000"}'`);
  console.log(`\n  curl -s http://localhost:${port}/checkout/<reference>`);
}

bootstrap().catch((err) => {
  console.error('[marzpay-checkout] failed to start:', (err as Error).message);
  process.exit(1);
});
