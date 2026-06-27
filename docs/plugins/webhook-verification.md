---
layout:      default
title:       "Webhook Verification"
permalink:   /plugins/webhook-verification/
nav_order:   8
description:  "Verify inbound Stripe and Twilio webhooks in StreetJS with the constant-time verifiers exported from streetjs — no vendor SDK required."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Plugins</span>
<h1>Webhook verification</h1>
<p>Verify that an inbound webhook genuinely came from the provider before acting
on it. StreetJS exports constant-time verifiers so you don't need a vendor SDK.</p>
</div>

> **Always verify before you trust.** An unverified webhook endpoint lets anyone
> POST forged events (fake payments, fake delivery receipts). Both verifiers below
> use a constant-time comparison and are pure functions — no network call.

> **Use the RAW request body.** Signatures are computed over the exact bytes the
> provider sent. If your framework parses/re-serializes JSON first, the bytes
> change and verification fails. Capture the raw body for the webhook route.

---

## Stripe (`Stripe-Signature`)

`verifyStripeWebhook(rawBody, signatureHeader, signingSecret, toleranceSec?)`
returns `true` only when the HMAC-SHA256 over `${timestamp}.${rawBody}` matches a
`v1` signature **and** the timestamp is within tolerance (default 300s, replay
protection).

Stripe signs the **exact bytes** it sent, so verify against the raw body — not a
re-serialized object. StreetJS parses `ctx.body`, so read the raw bytes from the
underlying request (`ctx.req`) in the webhook handler:

```typescript
import { verifyStripeWebhook } from 'streetjs';
import type { StreetContext } from 'streetjs';
import type { IncomingMessage } from 'node:http';

// Endpoint signing secret from the Stripe dashboard (whsec_…). Keep it in env.
const STRIPE_WEBHOOK_SECRET = process.env['STRIPE_WEBHOOK_SECRET']!;

/** Collect the raw request bytes (Stripe verification needs the exact body). */
function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function stripeWebhook(ctx: StreetContext): Promise<void> {
  const raw = await readRawBody(ctx.req);
  const sig = ctx.headers['stripe-signature'] ?? '';

  if (!verifyStripeWebhook(raw, sig, STRIPE_WEBHOOK_SECRET)) {
    ctx.json({ error: 'invalid signature' }, 400);   // reject forged / stale events
    return;
  }

  const event = JSON.parse(raw.toString('utf8'));
  // …handle event.type (payment_intent.succeeded, etc.) — now trusted.
  ctx.send(200);
}
```

Tune the replay window with the 4th argument, e.g. `verifyStripeWebhook(raw, sig,
secret, 600)`. Pass `0` to disable the timestamp check (not recommended).

---

## Twilio (`X-Twilio-Signature`)

`verifyTwilioSignature(authToken, url, params, signature)` returns `true` only
when the HMAC-SHA1 over the **full request URL followed by the POST params in
lexicographic key order** matches the header.

```typescript
import { verifyTwilioSignature } from 'streetjs';
import type { StreetContext } from 'streetjs';

const TWILIO_AUTH_TOKEN = process.env['TWILIO_AUTH_TOKEN']!;

async function twilioWebhook(ctx: StreetContext): Promise<void> {
  // The URL must be EXACTLY what you configured in the Twilio console
  // (scheme + host + path), including any proxy-rewritten host.
  const url = `https://${ctx.headers['host']}${ctx.path}`;
  const params = ctx.body as Record<string, string>;   // parsed form fields
  const sig = ctx.headers['x-twilio-signature'] ?? '';

  if (!verifyTwilioSignature(TWILIO_AUTH_TOKEN, url, params, sig)) {
    ctx.send(403);                                       // reject forged requests
    return;
  }
  // …trusted Twilio callback (SMS status, inbound message, etc.)
  ctx.send(200);
}
```

> If you terminate TLS at a proxy/load balancer, reconstruct the **original**
> public URL Twilio called (honor `X-Forwarded-Proto` / `X-Forwarded-Host`),
> not the internal one — the signature is computed over the URL Twilio used.

---

## SendGrid Event Webhook (ECDSA)

`verifySendGridWebhook(publicKey, rawBody, signature, timestamp)` verifies the
ECDSA-P256 signature over `${timestamp}${rawBody}`. `publicKey` is the Base64
verification key from SendGrid Mail Settings (or a full PEM); the signature and
timestamp come from the `X-Twilio-Email-Event-Webhook-Signature` /
`-Timestamp` headers. Exported from `streetjs`.

```typescript
import { verifySendGridWebhook } from 'streetjs';

const ok = verifySendGridWebhook(
  process.env['SENDGRID_WEBHOOK_PUBLIC_KEY']!,
  rawBody,                                              // exact bytes (see above)
  ctx.headers['x-twilio-email-event-webhook-signature'] ?? '',
  ctx.headers['x-twilio-email-event-webhook-timestamp'] ?? '',
);
if (!ok) { ctx.send(403); return; }
```

---

## PayPal (local cert verification)

`verifyPayPalWebhook(certPem, headers, rawBody)` checks the RSA-SHA256 signature
over `transmissionId|transmissionTime|webhookId|crc32(rawBody)`. Exported from
`@streetjs/plugin-paypal`. You fetch + chain-validate the cert at
`Paypal-Cert-Url` (an `https://*.paypal.com` URL — cache it); the verifier does
the offline signature check.

```typescript
import { verifyPayPalWebhook } from '@streetjs/plugin-paypal';

const ok = verifyPayPalWebhook(certPem, {
  transmissionId:   ctx.headers['paypal-transmission-id'] ?? '',
  transmissionTime: ctx.headers['paypal-transmission-time'] ?? '',
  webhookId:        process.env['PAYPAL_WEBHOOK_ID']!,     // from the PayPal dashboard
  signature:        ctx.headers['paypal-transmission-sig'] ?? '',
}, rawBody);
if (!ok) { ctx.send(403); return; }
```

---

## Outbound timeouts

Every official `node:https` plugin (stripe, twilio, sendgrid, auth0, paypal,
openai, clerk, firebase, supabase) accepts an optional `timeoutMs` (default
30000) so a hung upstream fails fast instead of leaking a socket:

```typescript
new StripePlugin({ apiKey: process.env['STRIPE_API_KEY']!, timeoutMs: 10_000 });
```

---

## Status & roadmap

Verifiers ship for **Stripe** and **Twilio** today. PayPal (transmission
cert-chain) and SendGrid (ECDSA event webhook) verifiers are tracked in
[plans/OUTSTANDING-ACTIONS.md](https://github.com/hassanmubiru/StreetJS/blob/main/plans/OUTSTANDING-ACTIONS.md)
(#9). See the [Plugin Maturity Matrix](https://github.com/hassanmubiru/StreetJS/blob/main/audits/PLUGIN-MATURITY-MATRIX.md)
for per-plugin status.
