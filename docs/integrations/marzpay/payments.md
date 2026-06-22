---
layout: default
title: "MarzPay: Payments"
parent: Integrations
nav_exclude: true
description: "Initialize mobile money and card collections, verify a payment, fetch a transaction, and list transactions with the verified MarzPay client operations."
---

# MarzPay: Payments

This page covers the verified payment operations on the injected
`MarzPayClient`. Each operation maps to a behavior recorded as a
`Verified_Capability` in the [research artifact](../marzpay-research.md):

| Operation | Verified endpoint |
|-----------|-------------------|
| `initializePayment` | `POST /collect-money` (mobile money or card) |
| `verifyPayment` | `GET /transactions/{reference}` |
| `getTransaction` | `GET /transactions/{id}` |
| `listTransactions` | `GET /transactions` |

All amounts are in **UGX** and must fall within the documented
**500–10,000,000** range; `country` is `'UG'`.

## Mobile money collection

Provide a `phone_number` in `+256xxxxxxxxx` form. MarzPay auto-detects the
provider (MTN/Airtel) from the number. The `reference` must be unique per
transaction — a UUID v4 is a good choice.

```ts
import { randomUUID } from 'node:crypto';
import type { MarzPayClient, PaymentInitResult } from '@streetjs/plugin-marzpay';

export async function collectMobileMoney(
  marzpay: MarzPayClient,
  phoneNumber: string,
  amount: number,
): Promise<PaymentInitResult> {
  return marzpay.initializePayment({
    amount,
    country: 'UG',
    reference: randomUUID(),
    phone_number: phoneNumber,
    description: 'Mobile money collection',
    callback_url: 'https://your-app.example.com/webhooks/marzpay',
  });
}
```

The returned `PaymentInitResult` carries the echoed `reference` and a
`status` (for example `processing`). Mobile money collections do not return a
redirect URL.

## Card collection

For a card collection, set `method: 'card'` and omit `phone_number`. MarzPay
returns a `redirect_url` on the result — send the customer to that exact URL to
complete the payment on the card gateway. Do not construct the URL yourself.

```ts
import { randomUUID } from 'node:crypto';
import type { MarzPayClient, PaymentInitResult } from '@streetjs/plugin-marzpay';

export async function collectCard(
  marzpay: MarzPayClient,
  amount: number,
): Promise<string> {
  const result: PaymentInitResult = await marzpay.initializePayment({
    amount,
    country: 'UG',
    reference: randomUUID(),
    method: 'card',
    description: 'Card collection',
    callback_url: 'https://your-app.example.com/webhooks/marzpay',
  });

  if (result.redirectUrl === undefined) {
    throw new Error('Card collection did not return a redirect URL');
  }
  return result.redirectUrl;
}
```

### Required fields and rejection

`initializePayment` validates required fields before any request is sent. A
missing/empty `amount`, `country`, or `reference`, or the absence of a payment
channel (neither `phone_number` nor `method: 'card'`), raises an error that names
the offending field and sends nothing.

```ts
import type { PaymentRequest } from '@streetjs/plugin-marzpay';

// A complete, valid mobile money request:
const mobileMoneyRequest: PaymentRequest = {
  amount: 5000,
  country: 'UG',
  reference: 'c97fae8b-9b7f-4192-9f72-6f0859d33e67',
  phone_number: '+256781230949',
};

// A complete, valid card request:
const cardRequest: PaymentRequest = {
  amount: 5000,
  country: 'UG',
  reference: 'b1f8b3a2-4c9d-4e7a-9f1b-2d3e4f5a6b7c',
  method: 'card',
};
```

## Verify a payment

Collections settle asynchronously. Read the final status with `verifyPayment`,
which accepts either a client `reference` or a MarzPay `uuid`.

```ts
import type { MarzPayClient, PaymentStatus } from '@streetjs/plugin-marzpay';

export async function isSettled(marzpay: MarzPayClient, reference: string): Promise<boolean> {
  const status: PaymentStatus = await marzpay.verifyPayment(reference);
  // Transaction-detail responses report 'completed' for a settled collection.
  return status.status === 'completed' || status.status === 'successful';
}
```

> **Status vocabulary.** Documented statuses are `pending`, `processing`,
> `successful`/`completed`, `failed`, and `cancelled`. List responses use
> `successful` while transaction-detail responses use `completed`. Treat both as
> success rather than assuming a single token.

## Fetch a single transaction

`getTransaction` returns the parsed `Transaction` record for a `uuid` or
`reference`.

```ts
import type { MarzPayClient, Transaction } from '@streetjs/plugin-marzpay';

export async function loadTransaction(marzpay: MarzPayClient, id: string): Promise<Transaction> {
  const txn: Transaction = await marzpay.getTransaction(id);
  // txn: { id, reference, amount, currency, status }
  return txn;
}
```

## List transactions

`listTransactions` calls `GET /transactions` with the documented filters. All
filters are optional; only the ones you provide are appended to the query.

```ts
import type { MarzPayClient, TransactionList } from '@streetjs/plugin-marzpay';

export async function recentCollections(marzpay: MarzPayClient): Promise<TransactionList> {
  return marzpay.listTransactions({
    type: 'collection',
    status: 'successful',
    page: 1,
    per_page: 50,
  });
}
```

The result is a `TransactionList` with parsed `items` and an optional
pagination `cursor` when MarzPay reports a next page.

## Error handling

Every operation raises an error that includes the HTTP status on a non-2xx
response, and a timeout/unavailability error on timeout or socket failure — in
both cases no partial result is returned.

```ts
import { PluginError } from 'streetjs';
import type { MarzPayClient, PaymentStatus } from '@streetjs/plugin-marzpay';

export async function safeVerify(
  marzpay: MarzPayClient,
  reference: string,
): Promise<PaymentStatus | null> {
  try {
    return await marzpay.verifyPayment(reference);
  } catch (error) {
    if (error instanceof PluginError) {
      // The message includes the HTTP status for a non-success response.
      return null;
    }
    throw error;
  }
}
```

## A note on refunds

MarzPay does **not** document a refund creation endpoint. The `refund` operation
exists on the client for interface completeness, but it rejects with a clear
"refunds are not supported by MarzPay" error and sends nothing. Do not build a
user flow that assumes refunds; handle reversals out of band until MarzPay
publishes a refund API.
