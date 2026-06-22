---
layout: default
title: "MarzPay: HTMX Example"
parent: Integrations
nav_exclude: true
description: "Server-rendered HTMX checkout for MarzPay — initialize a verified collection, return a redirect fragment for card or a status fragment for mobile money, with no client build step."
---

# MarzPay: HTMX Example

This example wires a MarzPay collection behind server-rendered HTML fragments.
There is no single-page app and no client build step — the controller returns
plain HTML over HTTP, which is exactly what HTMX swaps into the page.

It uses only verified operations: `initializePayment`
(`POST /collect-money`) and `verifyPayment` (`GET /transactions/{reference}`).

## The checkout form (static HTML)

```html
<form hx-post="/pay/checkout" hx-target="#pay-result" hx-swap="innerHTML">
  <input type="hidden" name="channel" value="card" />
  <button type="submit">Pay UGX 5,000</button>
</form>
<div id="pay-result"></div>
```

## The controller: initialize and return a fragment

For a **card** collection the controller returns a redirect fragment pointing at
MarzPay's `redirect_url`. For **mobile money** it returns a status fragment. If
initialization fails, it returns a failure fragment and never a redirect.

```ts
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Controller, Post, type StreetContext } from 'streetjs';
import type { MarzPayClient, PaymentInitResult } from '@streetjs/plugin-marzpay';

/** Escape a string for safe interpolation into an HTML fragment. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@Controller('/pay')
export class HtmxPayController {
  constructor(private readonly client: MarzPayClient) {}

  @Post('/checkout')
  async checkout(ctx: StreetContext): Promise<void> {
    const body = (ctx.body ?? {}) as { channel?: unknown; phone_number?: unknown };
    const channel = body.channel === 'mobile' ? 'mobile' : 'card';

    let result: PaymentInitResult;
    try {
      if (channel === 'mobile') {
        const phone = typeof body.phone_number === 'string' ? body.phone_number.trim() : '';
        result = await this.client.initializePayment({
          amount: 5000,
          country: 'UG',
          reference: randomUUID(),
          phone_number: phone,
          description: 'HTMX checkout',
        });
      } else {
        result = await this.client.initializePayment({
          amount: 5000,
          country: 'UG',
          reference: randomUUID(),
          method: 'card',
          description: 'HTMX checkout',
        });
      }
    } catch {
      // Initialization failed: return a failure fragment, never a redirect.
      ctx.html('<p class="error">Payment initialization failed. Please try again.</p>', 400);
      return;
    }

    if (result.redirectUrl !== undefined) {
      // Card flow: hand the customer to MarzPay's exact redirect URL.
      const url = escapeHtml(result.redirectUrl);
      ctx.html(`<a class="redirect" href="${url}">Continue to payment</a>`, 200);
      return;
    }

    // Mobile money flow: show the pending status and a reference to poll.
    const reference = escapeHtml(result.reference);
    const status = escapeHtml(result.status);
    ctx.html(
      `<div class="status" data-reference="${reference}">Payment ${status}. Reference ${reference}.</div>`,
      200,
    );
  }
}
```

## Polling the status as a fragment

After a mobile money collection, poll `verifyPayment` and swap in a status
fragment.

```ts
import 'reflect-metadata';
import { Controller, Get, type StreetContext } from 'streetjs';
import type { MarzPayClient, PaymentStatus } from '@streetjs/plugin-marzpay';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

@Controller('/pay')
export class HtmxStatusController {
  constructor(private readonly client: MarzPayClient) {}

  @Get('/status/:reference')
  async status(ctx: StreetContext): Promise<void> {
    const reference = typeof ctx.params['reference'] === 'string' ? ctx.params['reference'] : '';
    const result: PaymentStatus = await this.client.verifyPayment(reference);
    const label = result.status === 'completed' || result.status === 'successful' ? 'paid' : result.status;
    ctx.html(`<div class="status">${escapeHtml(label)}</div>`, 200);
  }
}
```

The polling fragment in the page:

```html
<div hx-get="/pay/status/c97fae8b-9b7f-4192-9f72-6f0859d33e67"
     hx-trigger="every 3s"
     hx-swap="outerHTML">Checking…</div>
```

Every response is server-rendered HTML — no bundler, no client framework. For the
React and Next variants of this flow, see [React Example](./react-example.md) and
[Next Example](./next-example.md).
