---
layout: default
title: "MarzPay: Webhooks"
parent: Integrations
nav_exclude: true
description: "Receive MarzPay collection webhooks and trust them the documented way — server-side re-verification via getTransaction — since MarzPay publishes no webhook signature scheme."
---

# MarzPay: Webhooks

MarzPay delivers webhooks by HTTP **POST** to the `callback_url` you supply on a
collection request. Delivery and payload shape are recorded as a
`Verified_Capability` ([research artifact](../marzpay-research.md) §V4).

> **Critical: there is no documented signature scheme.** MarzPay publishes **no**
> webhook signature header, HMAC algorithm, encoding, or signing secret (§L4).
> Because we do not invent one, the documented, verifiable trust path is
> **server-side re-verification**: when a webhook arrives, re-fetch the
> transaction from MarzPay with `getTransaction` and trust the server's
> amount/status/reference rather than the raw payload.

## Delivery model

- POST to your `callback_url`, body is JSON, your receiver returns **HTTP 200**.
- Sent only for **final** statuses: `completed`, `failed`, `cancelled` — never
  for `pending`/`processing`.
- Match the order using `transaction.reference`. Idempotency is recommended
  because retries are possible.

## Payload shape (verified)

```json
{
  "event_type": "collection.completed",
  "transaction": {
    "uuid": "…",
    "reference": "c97fae8b-9b7f-4192-9f72-6f0859d33e67",
    "status": "completed",
    "amount": { "formatted": "5,000.00", "raw": 5000, "currency": "UGX" },
    "provider": "mtn",
    "phone_number": "+256712345678"
  },
  "collection": {
    "provider": "mtn",
    "amount": { "formatted": "5,000.00", "raw": 5000, "currency": "UGX" },
    "mode": "mtnuganda",
    "provider_transaction_id": "148769164724"
  }
}
```

## `validateWebhook` and the unbound scheme

The client exposes `validateWebhook(rawBody, signature)`. Because MarzPay's
signature scheme is undocumented, the scheme is left unbound, so
`validateWebhook` returns `false` for absent, empty, or malformed signature
material. That is the safe default: never trust a raw payload on its own.

```ts
import type { MarzPayClient } from '@streetjs/plugin-marzpay';

export function signatureChecks(marzpay: MarzPayClient): boolean {
  // With no documented scheme bound, signature-only validation is always negative.
  return marzpay.validateWebhook('{"event_type":"collection.completed"}', undefined);
}
```

## The documented trust path: re-verify server-side

Capture the **unmodified** raw body, extract `transaction.reference`, then
re-fetch the transaction. Persist only what the server returns.

```ts
import 'reflect-metadata';
import { Controller, Post, BadRequestException, type StreetContext } from 'streetjs';
import type { MarzPayClient, Transaction } from '@streetjs/plugin-marzpay';

/** Extract transaction.reference from the verified webhook payload shape. */
function referenceOf(rawBody: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new BadRequestException('malformed MarzPay webhook payload');
  }
  const root = (parsed ?? {}) as { transaction?: { reference?: unknown } };
  const reference = root.transaction?.reference;
  if (typeof reference !== 'string' || reference.trim() === '') {
    throw new BadRequestException('MarzPay webhook payload missing transaction.reference');
  }
  return reference.trim();
}

@Controller('/webhooks')
export class MarzPayWebhookController {
  constructor(private readonly client: MarzPayClient) {}

  @Post('/marzpay')
  async handle(ctx: StreetContext): Promise<void> {
    // A raw-body middleware on this route must capture the bytes verbatim.
    const rawBody = ctx.state['rawBody'];
    if (typeof rawBody !== 'string') {
      throw new BadRequestException('missing raw body for MarzPay webhook validation');
    }

    // Signature-only validation is negative with no documented scheme — so we
    // rely on the documented trust path: re-verify the transaction server-side.
    const reference = referenceOf(rawBody);
    const txn: Transaction = await this.client.getTransaction(reference);

    // Persist the server's verified amount/status/reference, never the raw payload.
    const settled = txn.status === 'completed' || txn.status === 'successful';
    ctx.json({ received: true, reference: txn.reference, settled }, 200);
  }
}
```

## Why re-verification, not the payload?

Without a signature, any party who learns your callback URL could POST a forged
"completed" event. Re-fetching the transaction from MarzPay over authenticated
HTTPS is the documented way to confirm an event is real before mutating billing
state. Combine it with:

- **HTTPS-only** callback endpoints.
- **Unguessable** per-tenant callback URLs.
- **Idempotency** keyed on `transaction.reference` so retries are safe.

See [Security](./security.md) for the full hardening checklist and
[SaaS Billing](./saas-billing.md) for the org-scoped webhook controller the
`--with-marzpay` starter scaffolds.
