---
layout: default
title: "MarzPay: React Example"
parent: Integrations
nav_exclude: true
description: "A React checkout that calls a StreetJS MarzPay endpoint, then redirects to the verified card redirect URL or polls the verified payment status."
---

# MarzPay: React Example

This example shows a React front end driving a MarzPay collection through a
StreetJS backend. The browser never holds MarzPay credentials — it calls your
server, which runs the verified `initializePayment` and `verifyPayment`
operations and returns only the data the UI needs.

## The backend endpoint (StreetJS)

The React app talks to a small JSON endpoint that starts a card collection and
returns the verified `redirect_url` plus the reference.

```ts
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Controller, Post, BadRequestException, type StreetContext } from 'streetjs';
import type { MarzPayClient, PaymentInitResult } from '@streetjs/plugin-marzpay';

@Controller('/api/pay')
export class ReactPayController {
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
      description: 'React checkout',
    });

    if (result.redirectUrl === undefined) {
      throw new BadRequestException('card collection did not return a redirect URL');
    }
    ctx.json({ reference: result.reference, redirectUrl: result.redirectUrl }, 200);
  }
}
```

## The React checkout component

```tsx
import { useState } from 'react';

interface CheckoutResponse {
  reference: string;
  redirectUrl: string;
}

async function startCheckout(amount: number): Promise<CheckoutResponse> {
  const response = await fetch('/api/pay/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  if (!response.ok) {
    throw new Error(`Checkout failed with status ${response.status}`);
  }
  const data = (await response.json()) as CheckoutResponse;
  return data;
}

export function CheckoutButton(): JSX.Element {
  const [pending, setPending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const result = await startCheckout(5000);
      // Card flow: send the customer to MarzPay's exact redirect URL.
      window.location.assign(result.redirectUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Checkout failed');
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" disabled={pending} onClick={onClick}>
        {pending ? 'Starting…' : 'Pay UGX 5,000'}
      </button>
      {error !== null ? <p role="alert">{error}</p> : null}
    </div>
  );
}
```

## Showing the verified status

After the customer returns from MarzPay, confirm the outcome through a status
endpoint backed by `verifyPayment`.

```ts
import 'reflect-metadata';
import { Controller, Get, type StreetContext } from 'streetjs';
import type { MarzPayClient, PaymentStatus } from '@streetjs/plugin-marzpay';

@Controller('/api/pay')
export class ReactStatusController {
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
import { useEffect, useState } from 'react';

interface StatusResponse {
  reference: string;
  status: string;
  paid: boolean;
}

export function PaymentStatusView(props: { reference: string }): JSX.Element {
  const [status, setStatus] = useState<string>('checking');

  useEffect(() => {
    let active = true;
    async function poll(): Promise<void> {
      const response = await fetch(`/api/pay/status/${encodeURIComponent(props.reference)}`);
      if (!response.ok) return;
      const data = (await response.json()) as StatusResponse;
      if (active) {
        setStatus(data.paid ? 'paid' : data.status);
      }
    }
    void poll();
    return () => {
      active = false;
    };
  }, [props.reference]);

  return <p>Payment status: {status}</p>;
}
```

The flow uses only verified operations — card initialization returns the
`redirect_url` you must use as-is, and verification reads the documented status.
For the server-rendered variant see [HTMX Example](./htmx-example.md); for the
App Router variant see [Next Example](./next-example.md).
