---
layout: default
title: "MarzPay: Next Example"
parent: Integrations
nav_exclude: true
description: "A Next.js App Router checkout that calls a StreetJS MarzPay endpoint server-side, returns the verified card redirect URL, and confirms status with verifyPayment."
---

# MarzPay: Next Example

This example integrates MarzPay with a Next.js App Router front end. MarzPay
credentials and the `MarzPayClient` live only on the StreetJS backend; the Next
app calls that backend. Every call maps to a verified operation —
`initializePayment` (`POST /collect-money`, card) and `verifyPayment`
(`GET /transactions/{reference}`).

## The backend endpoint (StreetJS)

```ts
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Controller, Post, BadRequestException, type StreetContext } from 'streetjs';
import type { MarzPayClient, PaymentInitResult } from '@streetjs/plugin-marzpay';

@Controller('/api/pay')
export class NextPayController {
  constructor(private readonly client: MarzPayClient) {}

  @Post('/checkout')
  async checkout(ctx: StreetContext): Promise<void> {
    const body = (ctx.body ?? {}) as { amount?: unknown };
    const amount = typeof body.amount === 'number' && Number.isFinite(body.amount) ? body.amount : 0;
    if (amount <= 0) {
      throw new BadRequestException('amount must be a positive number');
    }

    const result: PaymentInitResult = await this.client.initializePayment({
      amount,
      country: 'UG',
      reference: randomUUID(),
      method: 'card',
      description: 'Next.js checkout',
    });

    if (result.redirectUrl === undefined) {
      throw new BadRequestException('card collection did not return a redirect URL');
    }
    ctx.json({ reference: result.reference, redirectUrl: result.redirectUrl }, 200);
  }
}
```

## A typed client helper

```ts
// app/lib/marzpay.ts
export interface CheckoutResponse {
  reference: string;
  redirectUrl: string;
}

/** The StreetJS backend base URL, configured per environment. */
function backendBaseUrl(): string {
  const value = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (value === undefined || value.trim() === '') {
    throw new Error('Missing required environment variable: NEXT_PUBLIC_BACKEND_URL');
  }
  return value;
}

export async function startCheckout(amount: number): Promise<CheckoutResponse> {
  const response = await fetch(`${backendBaseUrl()}/api/pay/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  if (!response.ok) {
    throw new Error(`Checkout failed with status ${response.status}`);
  }
  return (await response.json()) as CheckoutResponse;
}
```

## The checkout page (client component)

```tsx
// app/checkout/page.tsx
'use client';

import { useState } from 'react';
import { startCheckout } from '../lib/marzpay';

export default function CheckoutPage(): JSX.Element {
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function onPay(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const result = await startCheckout(5000);
      // Card flow: hand the customer to MarzPay's exact redirect URL.
      window.location.assign(result.redirectUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Checkout failed');
      setPending(false);
    }
  }

  return (
    <main>
      <h1>Checkout</h1>
      <button type="button" disabled={pending} onClick={onPay}>
        {pending ? 'Starting…' : 'Pay UGX 5,000'}
      </button>
      {error !== null ? <p role="alert">{error}</p> : null}
    </main>
  );
}
```

## Confirming the result (server component)

After MarzPay redirects the customer back with the reference, confirm the
outcome on the server using a status endpoint backed by `verifyPayment`.

```ts
import 'reflect-metadata';
import { Controller, Get, type StreetContext } from 'streetjs';
import type { MarzPayClient, PaymentStatus } from '@streetjs/plugin-marzpay';

@Controller('/api/pay')
export class NextStatusController {
  constructor(private readonly client: MarzPayClient) {}

  @Get('/status/:reference')
  async status(ctx: StreetContext): Promise<void> {
    const reference = typeof ctx.params['reference'] === 'string' ? ctx.params['reference'] : '';
    const result: PaymentStatus = await this.client.verifyPayment(reference);
    const paid = result.status === 'completed' || result.status === 'successful';
    ctx.json({ reference: result.reference, status: result.status, paid }, 200);
  }
}
```

```tsx
// app/result/[reference]/page.tsx

interface StatusResponse {
  reference: string;
  status: string;
  paid: boolean;
}

async function loadStatus(reference: string): Promise<StatusResponse> {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (base === undefined || base.trim() === '') {
    throw new Error('Missing required environment variable: NEXT_PUBLIC_BACKEND_URL');
  }
  const response = await fetch(`${base}/api/pay/status/${encodeURIComponent(reference)}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Status lookup failed with status ${response.status}`);
  }
  return (await response.json()) as StatusResponse;
}

export default async function ResultPage(props: {
  params: { reference: string };
}): Promise<JSX.Element> {
  const status = await loadStatus(props.params.reference);
  return (
    <main>
      <h1>Payment {status.paid ? 'complete' : status.status}</h1>
      <p>Reference: {status.reference}</p>
    </main>
  );
}
```

This mirrors the [React Example](./react-example.md) on the App Router, and the
[HTMX Example](./htmx-example.md) shows the same flow with server-rendered
fragments. All three use only verified MarzPay operations.
