// examples/marzpay-htmx/src/main.ts
// Server-rendered HTMX MarzPay example built on StreetJS.
//
// This is the HTMX frontend example: there is NO single-page app and NO client
// build step. The backend renders plain HTML fragments over HTTP that HTMX swaps
// into the page (`hx-post` / `hx-get`). It mirrors the `--frontend htmx` MarzPay
// overlay (scaffoldHtmxMarzPay) and docs/integrations/marzpay/htmx-example.md.
//
// MarzPay is invoked ONLY through @streetjs/plugin-marzpay (Requirement 13.3):
// the plugin injects a MarzPayClient onto `ctx.state.marzpay` and every
// operation (initializePayment / verifyPayment) goes through that injected
// client. There is NO inline MarzPay HTTP API call anywhere in this example.
//
//   GET  /                       -> the checkout page (static HTML + the HTMX form)
//   POST /pay/checkout           -> initializePayment -> redirect | status | failure fragment
//   GET  /pay/status/:reference  -> verifyPayment -> status fragment
//
// Requirement 7.5 invariant: when initializePayment throws OR returns a
// non-success result, the controller returns the FAILURE fragment and NEVER a
// redirect fragment.

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { streetApp, type StreetContext, type SandboxedApp } from 'streetjs';
import { MarzPayPlugin, type MarzPayClient, type PaymentInitResult } from '@streetjs/plugin-marzpay';

// ── Startup env-var guard (Requirement 13.5) ───────────────────────────────────
// A required env var that is unset (or blank) terminates the process with a
// non-zero status and an error naming the missing variable. See README for the
// complete required env-var list.

const REQUIRED_ENV_VARS = ['MARZPAY_API_KEY', 'MARZPAY_SECRET', 'MARZPAY_ENVIRONMENT'] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    console.error(`[marzpay-htmx] Missing required environment variable: ${name}`);
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
    `[marzpay-htmx] Invalid MARZPAY_ENVIRONMENT="${environmentRaw}" (expected "sandbox" or "production")`,
  );
  process.exit(1);
}
const environment = environmentRaw;
const port = parseInt(process.env['PORT'] ?? '3003', 10);

// ── HTML helpers ────────────────────────────────────────────────────────────────

/** Escape a string for safe interpolation into an HTML fragment. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Verified MarzPay status vocabulary (Research_Artifact): a terminal failure is
// `failed` or `cancelled`. A non-empty redirect_url (card flow) is a success.
const FAILED_STATUSES = new Set<string>(['failed', 'cancelled']);

function isSuccessfulInit(result: PaymentInitResult): boolean {
  if (typeof result.redirectUrl === 'string' && result.redirectUrl.trim() !== '') return true;
  return !FAILED_STATUSES.has((result.status ?? '').toLowerCase());
}

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MarzPay — HTMX checkout</title>
    <script src="https://unpkg.com/htmx.org@1.9.12" crossorigin="anonymous"></script>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 16px; }
      label { display: block; margin: 8px 0; }
      .error { color: #b00020; }
    </style>
  </head>
  <body>
    <h1>Pay with MarzPay (HTMX)</h1>
    <form hx-post="/pay/checkout" hx-target="#pay-result" hx-swap="innerHTML">
      <label>Channel
        <select name="channel">
          <option value="card">Card</option>
          <option value="mobile">Mobile money</option>
        </select>
      </label>
      <label>Phone number (mobile money)
        <input name="phone_number" placeholder="+256700000000" />
      </label>
      <button type="submit">Pay UGX 5,000</button>
    </form>
    <div id="pay-result"></div>
  </body>
</html>
`;

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

function client(ctx: StreetContext): MarzPayClient {
  return ctx.state['marzpay'] as MarzPayClient;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET / — serve the checkout page (static HTML + the HTMX form).
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/') {
    ctx.html(PAGE, 200);
    return;
  }
  await next();
});

// POST /pay/checkout — initialize a payment via the injected client and return a
// server-rendered fragment. Card -> redirect fragment; mobile money -> status
// fragment; error OR non-success -> failure fragment (and NEVER a redirect).
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/pay/checkout') {
    const body = (ctx.body ?? {}) as { channel?: unknown; phone_number?: unknown };
    const channel = body.channel === 'mobile' ? 'mobile' : 'card';

    let result: PaymentInitResult;
    try {
      if (channel === 'mobile') {
        const phone = typeof body.phone_number === 'string' ? body.phone_number.trim() : '';
        result = await client(ctx).initializePayment({
          amount: 5000,
          country: 'UG',
          reference: randomUUID(),
          phone_number: phone,
          description: 'HTMX checkout',
        });
      } else {
        result = await client(ctx).initializePayment({
          amount: 5000,
          country: 'UG',
          reference: randomUUID(),
          method: 'card',
          description: 'HTMX checkout',
        });
      }
    } catch {
      // Initialization failed: return a failure fragment, never a redirect.
      ctx.html('<p class="error">Payment initialization failed. Please try again.</p>', 200);
      return;
    }

    if (!isSuccessfulInit(result)) {
      // Non-success result: return a failure fragment, never a redirect.
      ctx.html(
        `<p class="error">Payment could not be initialized (status: ${escapeHtml(result.status)}).</p>`,
        200,
      );
      return;
    }

    if (typeof result.redirectUrl === 'string' && result.redirectUrl.trim() !== '') {
      // Card flow: hand the customer to MarzPay's exact redirect URL.
      const url = escapeHtml(result.redirectUrl);
      ctx.html(`<a class="redirect" href="${url}">Continue to payment</a>`, 200);
      return;
    }

    // Mobile money flow: show the pending status and a reference to poll.
    const reference = escapeHtml(result.reference);
    const status = escapeHtml(result.status);
    ctx.html(
      `<div class="status" data-reference="${reference}" hx-get="/pay/status/${reference}" hx-trigger="every 3s" hx-swap="outerHTML">Payment ${status}. Reference ${reference}.</div>`,
      200,
    );
    return;
  }
  await next();
});

// GET /pay/status/:reference — verify a payment and return a status fragment.
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path.startsWith('/pay/status/')) {
    const reference = decodeURIComponent(ctx.path.slice('/pay/status/'.length));
    if (reference === '') {
      ctx.html('<div class="status error">Missing reference.</div>', 200);
      return;
    }
    try {
      const result = await client(ctx).verifyPayment(reference);
      const label =
        result.status === 'completed' || result.status === 'successful' ? 'paid' : result.status;
      ctx.html(`<div class="status">${escapeHtml(label)}</div>`, 200);
    } catch {
      ctx.html('<div class="status error">Status unavailable.</div>', 200);
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
  console.log(`🧩 MarzPay HTMX example running on http://localhost:${port} (env: ${environment})`);
  console.log(`   Open http://localhost:${port}/ in a browser to try the checkout.`);
}

bootstrap().catch((err) => {
  console.error('[marzpay-htmx] failed to start:', (err as Error).message);
  process.exit(1);
});
