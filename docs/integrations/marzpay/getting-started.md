---
layout: default
title: "MarzPay: Getting Started"
parent: Integrations
nav_exclude: true
description: "Install and wire the official @streetjs/plugin-marzpay payments plugin, then run your first verified MarzPay collection in sandbox."
---

# MarzPay: Getting Started

`@streetjs/plugin-marzpay` is the official StreetJS plugin for
[MarzPay](https://wallet.wearemarz.com/) payments. It is dependency-free:
request construction is pure and offline-verifiable, and the network send uses
`node:https` only.

Every behavior the plugin exposes traces to a `Verified_Capability` recorded in
the [MarzPay research artifact](../marzpay-research.md). Topics MarzPay does not
document — refunds, customer subscriptions, recurring billing, and a webhook
signature scheme — are recorded there as limitations and are not implemented
from assumption. This documentation describes only verified behavior.

## Scope

MarzPay is **Uganda-only** today and settles in **UGX**. Collection amounts are
bounded to the documented range of **500–10,000,000 UGX**. Plan your amounts and
currency accordingly.

## Install

```bash
npm install @streetjs/plugin-marzpay
# or, inside a StreetJS project:
street add marzpay
```

## Get your credentials

Generate an API key and secret in the MarzPay dashboard (API Keys section). The
key is shown once — store it in environment variables, never in source control.

```bash
# .env (never commit this file)
MARZPAY_API_KEY=your_dashboard_api_key
MARZPAY_SECRET=your_dashboard_api_secret
```

## Register the plugin

The plugin is consumed through the `MarzPayPlugin(config)` factory, mirroring the
documented MarzPay convention. It injects a single `MarzPayClient` into
`ctx.state` under the configured `stateKey` (default `'marzpay'`).

```ts
import { App } from 'streetjs';
import { MarzPayPlugin } from '@streetjs/plugin-marzpay';

/** Read a required environment variable or fail fast at startup. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const app = new App();

app.use(
  MarzPayPlugin({
    apiKey: requireEnv('MARZPAY_API_KEY'),
    secretKey: requireEnv('MARZPAY_SECRET'),
    environment: 'sandbox', // 'sandbox' (default) or 'production'
    stateKey: 'marzpay',
  }),
);
```

> **Environment model.** MarzPay exposes a **single base URL** for both sandbox
> and production. The active mode is determined by your account/API key, not by a
> different host. The `environment` option is validated and accepted, but it does
> not switch the base address — sandbox is auto-detected from your account
> configuration. See [Deployment](./deployment.md).

## Configuration reference

| Field | Type | Required | Default | Notes |
|-------|------|:--------:|---------|-------|
| `apiKey` | `string` | yes | — | MarzPay API key (Basic-auth user) |
| `secretKey` | `string` | yes | — | MarzPay API secret (Basic-auth password) |
| `environment` | `'sandbox' \| 'production'` | no | `'sandbox'` | Accepted/validated; mode is account-driven |
| `stateKey` | `string` | no | `'marzpay'` | `ctx.state` key for the injected client |
| `timeoutMs` | `number` | no | `30000` | Per-request timeout in milliseconds |

A missing/empty `apiKey` or `secretKey`, or an `environment` that is neither
`'sandbox'` nor `'production'`, raises a configuration error during install that
names the offending field — and no client is injected.

## Your first collection (mobile money)

`initializePayment` calls the verified `POST /collect-money` endpoint. For a
mobile money collection, provide a `phone_number` in `+256xxxxxxxxx` format. The
provider (MTN/Airtel) is auto-detected from the number.

```ts
import { randomUUID } from 'node:crypto';
import { Controller, Post, type StreetContext } from 'streetjs';
import type { MarzPayClient, PaymentInitResult } from '@streetjs/plugin-marzpay';

@Controller('/pay')
export class PayController {
  @Post('/mobile-money')
  async start(ctx: StreetContext): Promise<void> {
    const marzpay = ctx.state['marzpay'] as MarzPayClient;

    const result: PaymentInitResult = await marzpay.initializePayment({
      amount: 5000,
      country: 'UG',
      reference: randomUUID(),
      phone_number: '+256781230949',
      description: 'Order #1024',
    });

    // result.reference: client reference echoed by MarzPay
    // result.status: e.g. 'processing'
    ctx.json({ reference: result.reference, status: result.status }, 200);
  }
}
```

## Verify a payment

Payments settle asynchronously. Confirm the final status with `verifyPayment`,
which calls the verified `GET /transactions/{reference}` endpoint.

```ts
import { Get, type StreetContext } from 'streetjs';
import type { MarzPayClient, PaymentStatus } from '@streetjs/plugin-marzpay';

export async function checkStatus(ctx: StreetContext): Promise<void> {
  const marzpay = ctx.state['marzpay'] as MarzPayClient;
  const reference = typeof ctx.params['reference'] === 'string' ? ctx.params['reference'] : '';

  const status: PaymentStatus = await marzpay.verifyPayment(reference);
  ctx.json({ reference: status.reference, status: status.status }, 200);
}
```

## Where to next

- [Payments](./payments.md) — mobile money, card collections, verification, and listing.
- [Webhooks](./webhooks.md) — delivery, payload, and the documented trust path.
- [Subscriptions](./subscriptions.md) — recurring billing composed from verified primitives.
- [SaaS Billing](./saas-billing.md) — the `--with-marzpay` starter modules.
- [Deployment](./deployment.md) and [Security](./security.md).
