---
layout: default
title: "MarzPay: Subscriptions"
parent: Integrations
nav_exclude: true
description: "Compose recurring billing from MarzPay's verified one-shot collection primitive — operator-triggered POST /collect-money per cycle — with no invented native subscription API."
---

# MarzPay: Subscriptions

> **Verify-don't-invent.** MarzPay documents **no** native customer-subscription
> API and **no** recurring/scheduled charge mechanism. Both are recorded as
> limitations in the [research artifact](../marzpay-research.md) (§L6, §L7). This
> page therefore describes subscriptions **composed from verified primitives** —
> it does not present recurring billing as a MarzPay capability.

## What MarzPay verifies

The only verified collection primitive is a **one-shot**
`POST /collect-money` (`initializePayment`) with a **unique per-transaction
`reference`**. There is no documented schedule, mandate, tokenized re-charge, or
"charge again" capability. There is also no documented refund endpoint.

So a subscription in a StreetJS app is modelled as:

1. **Plan definitions** stored in your own configuration.
2. **Subscription records** persisted in your own datastore.
3. **One explicit, operator-triggered `initializePayment` per billing cycle.**
4. **Verification** of each cycle's collection via `verifyPayment` /
   `getTransaction`.

## Plan definitions (your config, not MarzPay)

```ts
/** A subscription plan, defined in your application configuration. */
export interface PlanDefinition {
  id: string;
  name: string;
  amount: number; // UGX, within 500–10,000,000
  currency: string; // 'UGX'
  interval: 'week' | 'month' | 'year';
}

export const PLANS: Record<string, PlanDefinition> = {
  starter: { id: 'starter', name: 'Starter', amount: 5000, currency: 'UGX', interval: 'month' },
  pro: { id: 'pro', name: 'Pro', amount: 20000, currency: 'UGX', interval: 'month' },
};
```

## Charging one billing cycle

Each cycle is a single verified card collection with a fresh `reference`. MarzPay
returns a `redirect_url` for the card flow; send the customer there to authorize
the cycle's payment.

```ts
import { randomUUID } from 'node:crypto';
import type { MarzPayClient, PaymentInitResult } from '@streetjs/plugin-marzpay';
import { PLANS, type PlanDefinition } from './plans.js';

/** Result of starting one subscription cycle's collection. */
export interface CycleCheckout {
  reference: string;
  redirectUrl: string;
}

/**
 * Start the collection for a single billing cycle. This is operator-triggered
 * (called by your scheduler or an explicit renewal action) — MarzPay does not
 * charge on its own.
 */
export async function chargeCycle(marzpay: MarzPayClient, planId: string): Promise<CycleCheckout> {
  const plan: PlanDefinition | undefined = PLANS[planId];
  if (plan === undefined) {
    throw new Error(`unknown plan: ${planId}`);
  }

  const result: PaymentInitResult = await marzpay.initializePayment({
    amount: plan.amount,
    currency: plan.currency,
    country: 'UG',
    reference: randomUUID(),
    method: 'card',
    description: `${plan.name} subscription`,
  });

  if (result.redirectUrl === undefined) {
    throw new Error('Subscription cycle did not return a redirect URL');
  }
  return { reference: result.reference, redirectUrl: result.redirectUrl };
}
```

## Advancing the period after a settled cycle

Track the period yourself. After a cycle's collection is verified as settled,
advance the subscription's period end. Nothing about this schedule comes from
MarzPay — it is your own bookkeeping.

```ts
import type { PlanDefinition } from './plans.js';

/** Compute the next period end from the plan interval. */
export function nextPeriodEnd(plan: PlanDefinition, from: Date = new Date()): string {
  const day = 24 * 60 * 60 * 1000;
  const span = plan.interval === 'year' ? 365 * day : plan.interval === 'week' ? 7 * day : 30 * day;
  return new Date(from.getTime() + span).toISOString();
}
```

## Confirming a cycle settled

Because MarzPay charges only when you call `initializePayment`, confirm each
cycle with `verifyPayment` before advancing the period or granting access.

```ts
import type { MarzPayClient, PaymentStatus } from '@streetjs/plugin-marzpay';

export async function cycleSettled(marzpay: MarzPayClient, reference: string): Promise<boolean> {
  const status: PaymentStatus = await marzpay.verifyPayment(reference);
  return status.status === 'completed' || status.status === 'successful';
}
```

## Limitations to design around

- **No native recurring billing.** You must trigger every cycle's collection
  explicitly (scheduler, cron, or a manual renewal action).
- **No refunds.** MarzPay documents no refund endpoint; handle reversals out of
  band. Calling the client's `refund` operation rejects with an
  "unsupported" error and sends nothing.
- **Re-authorization.** Card collections produce a fresh `redirect_url` each
  cycle; there is no documented stored-card or mandate flow, so the customer
  authorizes each cycle.

For an end-to-end starter that wires these primitives into org-scoped billing
and subscription records, see [SaaS Billing](./saas-billing.md).
