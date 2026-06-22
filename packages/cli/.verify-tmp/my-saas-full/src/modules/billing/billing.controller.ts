// src/modules/billing/billing.controller.ts
// Stripe webhook controller for the SaaS starter (overlay code — NOT framework code).
// Requires `--with-billing` (composes @streetjs/plugin-stripe; install-on-demand).
//
//   POST /webhooks/stripe
//
// SECURITY (Requirements 4.2, 4.3, 4.7): this route is intentionally exempt from
// CSRF validation and tenant scoping — it is authenticated SOLELY by Stripe
// signature verification against STRIPE_WEBHOOK_SECRET. Register it OUTSIDE the
// csrfMiddleware / tenantResolver chain and behind a RAW-BODY parser that leaves
// the request body unmodified (do NOT parse-then-reserialize), exposing it as
// `ctx.state.rawBody`. Signature verification is delegated to the official
// @streetjs/plugin-stripe StripeClient.verify with a 300-second tolerance — it
// is NOT reimplemented here.
//
//   bad / expired (>300s) signature  -> 400, no state change, id not recorded
//   verified, handled event          -> 200 (upsert applied or idempotent skip)
//   verified, other event type       -> 200 (no-op)
//   persist failure                  -> 500 (rolled back; Stripe retries)

import { StripeClient, validateStripeConfig } from '@streetjs/plugin-stripe';
import { BadRequestException, type StreetContext } from 'streetjs';
import type { BillingService, StripeEvent } from './billing.service.js';

/** The 300-second timestamp tolerance mandated for Stripe signatures. */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Signature verifier contract. The official StripeClient from
 * @streetjs/plugin-stripe satisfies this: verify(rawBody, signature, secret,
 * opts) returns the typed event or throws on a bad/expired signature. Injecting
 * it as an interface keeps the controller composable and testable without
 * reimplementing any cryptography.
 */
export interface StripeWebhookVerifier {
  verify(
    rawBody: string,
    signature: string,
    secret: string,
    opts?: { tolerance?: number },
  ): StripeEvent | Promise<StripeEvent>;
}

/**
 * rawBodyOf — return the UNMODIFIED request body for signature verification.
 *
 * A raw-body middleware on the webhook route must capture the bytes verbatim
 * into ctx.state.rawBody before any JSON parsing. We never use the parsed
 * ctx.body here, because re-serialising it would change the bytes and break the
 * signature check.
 */
function rawBodyOf(ctx: StreetContext): string {
  const captured = ctx.state['rawBody'];
  if (typeof captured === 'string') return captured;
  if (captured instanceof Buffer) return captured.toString('utf8');
  throw new BadRequestException('missing raw body for Stripe signature verification');
}

/**
 * defaultVerifier — build a StripeWebhookVerifier from the official plugin's
 * StripeClient using validated config. Composed by default; tests may inject a
 * stub verifier instead.
 */
export function defaultVerifier(): StripeWebhookVerifier {
  const config = validateStripeConfig({ apiKey: process.env['STRIPE_SECRET_KEY'] ?? '' });
  return new StripeClient(config) as unknown as StripeWebhookVerifier;
}

export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly deps: {
      verifier?: StripeWebhookVerifier;
      webhookSecret?: string;
    } = {},
  ) {}

  /**
   * webhook — handle POST /webhooks/stripe.
   *
   * Verifies the signature against STRIPE_WEBHOOK_SECRET on the unmodified raw
   * body with a 300s tolerance (400 on failure, no state change), then applies
   * the event via BillingService.handleEvent (200 on success/idempotent skip/
   * unhandled type). A persist failure inside handleEvent propagates and is
   * mapped to 500 so Stripe retries.
   */
  async webhook(ctx: StreetContext): Promise<void> {
    const secret = this.deps.webhookSecret ?? process.env['STRIPE_WEBHOOK_SECRET'] ?? '';
    const verifier = this.deps.verifier ?? defaultVerifier();
    const signature = ctx.headers['stripe-signature'] ?? '';

    // ── Signature verification (delegated; 400 on any failure) ──────────────
    let event: StripeEvent;
    try {
      const rawBody = rawBodyOf(ctx);
      event = await verifier.verify(rawBody, signature, secret, {
        tolerance: STRIPE_SIGNATURE_TOLERANCE_SECONDS,
      });
    } catch {
      // Bad signature, expired timestamp (>300s), or missing raw body. No
      // subscriptions row is touched and no event id is recorded.
      ctx.json({ error: 'invalid signature' }, 400);
      return;
    }

    // ── Apply the verified event (500 on persist failure -> Stripe retries) ──
    try {
      await this.billing.handleEvent(event);
      ctx.json({ received: true }, 200);
    } catch {
      ctx.json({ error: 'processing failed' }, 500);
    }
  }
}
