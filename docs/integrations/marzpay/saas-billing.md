---
layout: default
title: "MarzPay: SaaS Billing"
parent: Integrations
nav_exclude: true
description: "Org-scoped SaaS billing with the --with-marzpay starter: plans from config, one verified collection per checkout, tenant-isolated billing records, and re-verified webhooks."
---

# MarzPay: SaaS Billing

The SaaS starter adds MarzPay billing modules when you scaffold with
`--with-marzpay`:

```bash
street create my-saas --starter saas --with-marzpay
```

This is install-on-demand: the flag adds `@streetjs/plugin-marzpay` and emits the
billing overlay under `src/modules/billing/`. A plain `--starter saas` scaffold
emits none of these files and adds no MarzPay dependency.

Everything here is composed from **verified primitives only** — plans live in
your configuration, each checkout is one verified `POST /collect-money`, and
webhooks are trusted by server-side re-verification. MarzPay documents no native
subscriptions, recurring billing, or refunds (see
[Subscriptions](./subscriptions.md)).

## Plans come from configuration

Plans are read from a `BillingConfig` value — never hardcoded in the service. An
unknown plan id is rejected and nothing is persisted.

```ts
/** A subscription plan definition, read from BillingConfig (never hardcoded). */
export interface PlanDefinition {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
}

/** Billing configuration: the set of plans a tenant may subscribe to. */
export interface BillingConfig {
  plans: Record<string, PlanDefinition>;
}

export const billingConfig: BillingConfig = {
  plans: {
    starter: { id: 'starter', name: 'Starter', amount: 5000, currency: 'UGX', interval: 'month' },
    pro: { id: 'pro', name: 'Pro', amount: 20000, currency: 'UGX', interval: 'month' },
  },
};
```

## The billing service (org-scoped)

`startCheckout` resolves the plan from config, runs one verified card collection
(`initializePayment`), and persists exactly one `BillingRecord` through the
org-scoped repository so the row is stamped with the active tenant's `org_id`.

```ts
import { randomUUID } from 'node:crypto';
import { BadRequestException, type StreetContext } from 'streetjs';
import { orgScopedRepo, type ScopedRepository } from '../../middleware/tenant.js';
import type { MarzPayClient } from '@streetjs/plugin-marzpay';
import type { BillingConfig, PlanDefinition } from './plans.js';

/** An org-scoped billing record (tenant discriminator: org_id). */
export interface BillingRecord {
  id: string;
  org_id: string;
  plan: string;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  created_at: string;
}

/** Result of starting a checkout against MarzPay. */
export interface CheckoutResult {
  reference: string;
  redirectUrl?: string;
  status: string;
}

export class BillingService {
  constructor(
    private readonly repo: ScopedRepository<BillingRecord>,
    private readonly plans: BillingConfig,
    private readonly client: MarzPayClient,
  ) {}

  resolvePlan(planId: string): PlanDefinition | null {
    return this.plans.plans[planId] ?? null;
  }

  async startCheckout(ctx: StreetContext, planId: string): Promise<CheckoutResult> {
    const plan = this.resolvePlan(planId);
    if (!plan) {
      // Reject before any side effect: nothing is sent and nothing is persisted.
      throw new BadRequestException('unknown plan: ' + planId);
    }

    // Verified card collection: no phone number; MarzPay returns redirect_url.
    const init = await this.client.initializePayment({
      amount: plan.amount,
      currency: plan.currency,
      country: 'UG',
      reference: randomUUID(),
      method: 'card',
      description: plan.name,
    });

    // Persist ONLY through the org-scoped repo: org_id is stamped to the active
    // tenant and cannot be overridden by the payload (tenant isolation).
    await orgScopedRepo(this.repo, ctx).insert({
      plan: planId,
      status: init.status,
      reference: init.reference,
      amount: plan.amount,
      currency: plan.currency,
      created_at: new Date().toISOString(),
    });

    return { reference: init.reference, redirectUrl: init.redirectUrl, status: init.status };
  }
}
```

## The checkout controller

```ts
import 'reflect-metadata';
import { Controller, Post, BadRequestException, type StreetContext } from 'streetjs';
import type { BillingService } from './billing.service.js';

@Controller('/billing')
export class CheckoutController {
  constructor(private readonly billing: BillingService) {}

  @Post('/checkout')
  async checkout(ctx: StreetContext): Promise<void> {
    const body = (ctx.body ?? {}) as { planId?: unknown };
    const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
    if (!planId) {
      throw new BadRequestException('planId is required');
    }
    const result = await this.billing.startCheckout(ctx, planId);
    ctx.json(result, 200);
  }
}
```

## The webhook controller (validate, then re-verify, then persist)

The webhook controller validates on the unmodified raw body before any
persistence. Because MarzPay documents no signature scheme, `validateWebhook`
returns `false` for absent/malformed material, so the controller uses the
documented trust path: re-fetch the transaction with `getTransaction` and
persist the verified amount/status/reference.

```ts
import 'reflect-metadata';
import { Controller, Post, BadRequestException, type StreetContext } from 'streetjs';
import type { MarzPayClient } from '@streetjs/plugin-marzpay';
import type { BillingService } from './billing.service.js';

/** A verified webhook event, after re-verification via getTransaction. */
export interface VerifiedWebhookEvent {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  plan?: string;
}

const MARZPAY_SIGNATURE_HEADER = 'x-marzpay-signature';

function rawBodyOf(ctx: StreetContext): string {
  const captured = ctx.state['rawBody'];
  if (typeof captured === 'string') return captured;
  if (captured instanceof Buffer) return captured.toString('utf8');
  throw new BadRequestException('missing raw body for MarzPay webhook validation');
}

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
export class WebhookController {
  constructor(
    private readonly client: MarzPayClient,
    private readonly billing: BillingService,
  ) {}

  @Post('/marzpay')
  async handle(ctx: StreetContext): Promise<void> {
    const rawBody = rawBodyOf(ctx);
    const signature = ctx.headers[MARZPAY_SIGNATURE_HEADER];

    // Validate BEFORE any persistence. Negative result -> reject, write nothing.
    if (!this.client.validateWebhook(rawBody, signature)) {
      // Documented trust path: re-verify the transaction server-side instead.
      const event = await this.verifiedEvent(rawBody);
      await this.persist(ctx, event);
      ctx.json({ received: true }, 200);
      return;
    }

    const event = await this.verifiedEvent(rawBody);
    await this.persist(ctx, event);
    ctx.json({ received: true }, 200);
  }

  private async verifiedEvent(rawBody: string): Promise<VerifiedWebhookEvent> {
    const reference = referenceOf(rawBody);
    const txn = await this.client.getTransaction(reference);
    return { reference: txn.reference, status: txn.status, amount: txn.amount, currency: txn.currency };
  }

  private async persist(ctx: StreetContext, event: VerifiedWebhookEvent): Promise<void> {
    // Delegate to BillingService.recordPayment, which writes only through the
    // org-scoped repository so the record is tenant-scoped by org_id.
    await this.billing.recordPayment(ctx, event);
  }
}
```

## Tenant isolation

Every read and write goes through `orgScopedRepo(repo, ctx)`, which stamps and
filters by the active tenant's `org_id`. A record created for one tenant is never
returned for another, and a payload cannot override the `org_id`. This applies to
billing records, subscription records, invoices, and usage measurements.

## What this starter does not do

- **No automatic recurring charges.** Renewals are operator-triggered — call
  `startCheckout` (or your scheduler) per cycle. See
  [Subscriptions](./subscriptions.md).
- **No refunds.** MarzPay documents none; the client's `refund` rejects with an
  "unsupported" error and sends nothing.

See [Deployment](./deployment.md) for environment and rollout guidance and
[Security](./security.md) for the hardening checklist.
