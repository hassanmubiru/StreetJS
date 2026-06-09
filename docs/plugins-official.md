# Official Plugins

Street ships a set of official reference plugins built on the
[plugin system](./plugins.md). Each declares a signed manifest, a config schema,
capability metadata, a permission set, and lifecycle hooks, and exposes a client
whose **request building is deterministic and verified offline**. The actual
network call to the vendor API is a thin wrapper (exercised in CI / with real
credentials).

| Plugin | Package symbol | Capability | Deterministic offline logic |
| --- | --- | --- | --- |
| S3 | `S3Plugin` | object-storage | AWS SigV4 signing |
| SendGrid | `SendGridPlugin` | email | v3 mail/send request (bearer + JSON) |
| Stripe | `StripePlugin` | payments | form-encoded request (bearer) |
| Twilio | `TwilioPlugin` | sms | Basic-auth + form-encoded request |
| Auth0 | `Auth0Plugin` | auth | client-credentials token request (JSON) |
| R2 | `R2Plugin` | object-storage | S3-compatible SigV4 (`region=auto`) |

All require permissions `['net','secrets','middleware']` and inject their client
into `ctx.state` on load.

## Examples

```ts
import { StripeClient } from 'streetjs';
new StripeClient({ apiKey: 'sk_live_…' }).buildCreatePaymentIntent(2000, 'usd');
// POST https://api.stripe.com/v1/payment_intents  body: amount=2000&currency=usd

import { TwilioClient } from 'streetjs';
new TwilioClient({ accountSid: 'AC…', authToken: '…', defaultFrom: '+1555…' })
  .buildSendSmsRequest({ to: '+1555…', body: 'hi' });
// POST .../Accounts/AC…/Messages.json  Authorization: Basic base64(sid:token)

import { Auth0Client } from 'streetjs';
new Auth0Client({ domain: 'acme.auth0.com', clientId: 'c', clientSecret: 's', audience: 'https://api/' })
  .buildTokenRequest();
// POST https://acme.auth0.com/oauth/token  grant_type=client_credentials

import { R2Client } from 'streetjs';
new R2Client({ accountId: 'a', bucket: 'media', accessKeyId: 'AK', secretAccessKey: 'SK' })
  .signedObjectHeaders('GET', 'file.bin');
// SigV4 against a.r2.cloudflarestorage.com (service s3, region auto)
```

Install any of them through a signed `PluginHost` exactly like
[S3](./plugins-s3.md) / [SendGrid](./plugins-sendgrid.md).

## Verification

- `packages/core/src/tests/plugins-official.test.ts` (17 tests): per-plugin config
  schema, deterministic request building / SigV4 signing, signed install + enable
  through the host, capability discovery, and permission gating for all four.
- S3 and SendGrid have their own suites (`plugin-s3.test.ts`, `plugin-sendgrid.test.ts`).

```bash
cd packages/core && npx tsc && node --test dist/src/tests/plugins-official.test.js
```
