<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-africastalking

Official [StreetJS](https://hassanmubiru.github.io/StreetJS/) plugin for
[Africa's Talking](https://africastalking.com): **SMS, Bulk SMS, Voice, USSD,
Airtime, and Mobile Money** — sandbox and production.

- **Zero third-party runtime dependencies** (Node native `fetch`; `streetjs` is the framework).
- TypeScript strict mode, ESM, signed Ed25519 manifest, official certification structure.
- Pure, offline-testable request builders + a secret-safe executor (timeout + bounded retry).

## Installation

```bash
npm install @streetjs/plugin-africastalking
```

## Setup

```ts
import { createAfricaTalkingPlugin } from '@streetjs/plugin-africastalking';

const at = createAfricaTalkingPlugin({
  apiKey: process.env.AT_API_KEY!,
  username: process.env.AT_USERNAME!,
  sandbox: true,        // false (or omit) for production
  // timeoutMs: 15000,  // optional
  // retries: 2,        // optional (transient 429/5xx/network)
});
```

### Sandbox

Use `username: 'sandbox'` and `sandbox: true`. Requests target the
`*.sandbox.africastalking.com` hosts; interactions appear in the AT simulator.

### Production

Use your real `username` and omit `sandbox` (or set `false`). Keep `AT_API_KEY`
in an environment variable / secret store — it is sent as a header and **is never
logged or included in any error thrown by this plugin**.

## SMS

```ts
await at.sms.send({ to: '+254700000000', message: 'Welcome to StreetJS' });

await at.sms.sendBulk({
  recipients: ['+254700000000', '+254711111111'],
  message: 'Promotion!',
});
```

## USSD

USSD is callback-driven: Africa's Talking POSTs `{ sessionId, serviceCode,
phoneNumber, text }` to your endpoint and you reply with `CON …` (more input) or
`END …` (terminate). Build a router and return its output:

```ts
const ussd = at.createUssdRouter()
  .menu('Welcome\n1. Balance\n2. Buy airtime')          // shown on first hit
  .input('1', () => 'END Your balance is KES 500')
  .input('2', (req, segs) =>
    segs.length === 1 ? 'CON Enter amount:' : `END Buying KES ${segs[1]}`)
  .end('Invalid choice.');

// In a StreetJS controller:
@Post('/ussd')
async handleUssd(ctx: StreetContext): Promise<void> {
  ctx.text(ussd.handle(ctx.body as Record<string, unknown>));
}
```

## Voice

```ts
await at.voice.call({ from: '+254700000000', to: '+254711111111' });

// In your voice callback route, validate + parse the event:
const event = at.voice.validateCallback(ctx.body, {
  expectedSecret: process.env.AT_CB_SECRET, providedSecret: ctx.query['s'],
});
```

## Airtime

```ts
await at.airtime.send({
  phoneNumber: '+254700000000',
  amount: 100,
  currencyCode: 'KES',
});
```

## Mobile Money

```ts
// C2B checkout (collect from a customer)
await at.mobileMoney.checkout({
  productName: 'MyStore', phoneNumber: '+254700000000', currencyCode: 'KES', amount: 500,
});

// B2C payout
await at.mobileMoney.b2c('MyStore', [
  { phoneNumber: '+254700000000', currencyCode: 'KES', amount: 100, reason: 'BusinessPayment' },
]);

// Transaction status
await at.mobileMoney.transactionStatus({ transactionId: 'ATXid_...' });

// Verify a payment callback (shared-secret pattern; callbacks are unsigned)
const payload = at.mobileMoney.verifyCallback(ctx.body, {
  expectedSecret: process.env.AT_CB_SECRET, providedSecret: ctx.query['s'],
});
```

## Security recommendations

- **Never log the API key.** This plugin treats it as a header and excludes it
  from all thrown errors; keep your own logging secret-safe too.
- **Serve callbacks (USSD/Voice/Payments) over HTTPS** and gate them with a shared
  secret in the URL/path — Africa's Talking callbacks are **not signed**.
- **Validate amounts and recipients server-side** before initiating airtime or
  mobile-money operations.
- Use the built-in **timeout + bounded retry**; do not retry non-transient 4xx.
- Run in **sandbox** until your flows are verified, then switch `sandbox: false`.

## Manifest & signing

This package ships a `manifest.json` and an Ed25519-signed `manifest.signed.json`
(verifiable against `manifest.pub`). Signing runs **only at publish**
(`prepublishOnly` → `sign`) and **requires** `STREET_PLUGIN_SIGNING_KEY`; a plain
`npm run build` never signs. See the StreetJS
[Plugin Author Guide](https://hassanmubiru.github.io/StreetJS/ecosystem/plugin-author-guide/).

## License

MIT
