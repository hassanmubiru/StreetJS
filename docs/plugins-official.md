---
layout: default
title: "Official Plugins"
nav_exclude: true
description: "Official StreetJS plugins — S3, SendGrid, Stripe, Twilio, Auth0, R2 and NATS integrations with signed, verified manifests."
---

# Official Plugins

StreetJS ships a set of official reference plugins built on the
[plugin system](./plugins.md). Each declares a signed manifest, a config schema,
capability metadata, a permission set, and lifecycle hooks, and exposes a client
whose **request building is deterministic and verified offline**. The actual
network call to the vendor API is a thin wrapper (exercised in CI / with real
credentials).

<table class="st-responsive">
  <thead>
    <tr><th>Plugin</th><th>Package symbol</th><th>Capability</th><th>Deterministic offline logic</th></tr>
  </thead>
  <tbody>
    <tr><td data-label="Plugin">S3</td><td data-label="Package symbol"><code>S3Plugin</code></td><td data-label="Capability">object-storage</td><td data-label="Offline logic">AWS SigV4 signing</td></tr>
    <tr><td data-label="Plugin">SendGrid</td><td data-label="Package symbol"><code>SendGridPlugin</code></td><td data-label="Capability">email</td><td data-label="Offline logic">v3 mail/send request (bearer + JSON)</td></tr>
    <tr><td data-label="Plugin">Stripe</td><td data-label="Package symbol"><code>StripePlugin</code></td><td data-label="Capability">payments</td><td data-label="Offline logic">form-encoded request (bearer)</td></tr>
    <tr><td data-label="Plugin">Twilio</td><td data-label="Package symbol"><code>TwilioPlugin</code></td><td data-label="Capability">sms</td><td data-label="Offline logic">Basic-auth + form-encoded request</td></tr>
    <tr><td data-label="Plugin">Auth0</td><td data-label="Package symbol"><code>Auth0Plugin</code></td><td data-label="Capability">auth</td><td data-label="Offline logic">client-credentials token request (JSON)</td></tr>
    <tr><td data-label="Plugin">R2</td><td data-label="Package symbol"><code>R2Plugin</code></td><td data-label="Capability">object-storage</td><td data-label="Offline logic">S3-compatible SigV4 (<code>region=auto</code>)</td></tr>
    <tr><td data-label="Plugin">NATS</td><td data-label="Package symbol"><code>NatsPlugin</code></td><td data-label="Capability">messaging / pubsub</td><td data-label="Offline logic">dependency-free NATS text protocol (PUB/SUB/MSG codec)</td></tr>
    <tr><td data-label="Plugin">Kafka</td><td data-label="Package symbol"><code>KafkaPlugin</code></td><td data-label="Capability">messaging / streaming</td><td data-label="Offline logic">wraps the dependency-free core Kafka protocol client</td></tr>
    <tr><td data-label="Plugin">RabbitMQ</td><td data-label="Package symbol"><code>RabbitMqPlugin</code></td><td data-label="Capability">messaging / queue</td><td data-label="Offline logic">wraps the dependency-free core AMQP 0-9-1 transport</td></tr>
  </tbody>
</table>

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
