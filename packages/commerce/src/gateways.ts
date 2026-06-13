// packages/commerce/src/gateways.ts
// Real payment-gateway adapters for Stripe and PayPal. Each takes an injectable
// `fetch`, so request shaping and response parsing are unit-testable without
// network access. Both implement the PaymentGateway contract from ./index.

import type { PaymentGateway, ChargeRequest, ChargeResult } from './index.js';
import { PaymentError } from './index.js';

export type FetchLike = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

function resolveFetch(f: FetchLike | undefined): FetchLike {
  if (f) return f;
  const g = (globalThis as { fetch?: unknown }).fetch;
  if (typeof g !== 'function') throw new Error('No fetch available; pass options.fetch');
  return g as FetchLike;
}

// ── Stripe ──────────────────────────────────────────────────────────────────────

export interface StripeGatewayOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

/**
 * Stripe PaymentIntents adapter. Creates a confirmed PaymentIntent for the
 * charge; refunds it on `refund`. Uses form-encoding as Stripe's API expects.
 */
export class StripeGateway implements PaymentGateway {
  readonly name = 'stripe';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;

  constructor(options: StripeGatewayOptions = {}) {
    this.apiKey = options.apiKey ?? process.env['STRIPE_SECRET_KEY'] ?? '';
    this.baseUrl = (options.baseUrl ?? 'https://api.stripe.com/v1').replace(/\/$/, '');
    this.fetch = resolveFetch(options.fetch);
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const form = new URLSearchParams({
      amount: String(request.amountCents),
      currency: request.currency.toLowerCase(),
      confirm: 'true',
      'metadata[reference]': request.reference,
    }).toString();

    const res = await this.fetch(`${this.baseUrl}/payment_intents`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    const json = await this.readJson(res);
    const status = String(json['status'] ?? '');
    if (status !== 'succeeded') {
      throw new PaymentError(`stripe: payment not succeeded (status=${status || 'unknown'})`);
    }
    return { id: String(json['id']), status: 'succeeded' };
  }

  async refund(paymentId: string): Promise<void> {
    const res = await this.fetch(`${this.baseUrl}/refunds`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Bearer ${this.apiKey}` },
      body: new URLSearchParams({ payment_intent: paymentId }).toString(),
    });
    await this.readJson(res);
  }

  private async readJson(res: { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }): Promise<Record<string, unknown>> {
    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch { /* ignore */ }
      throw new PaymentError(`stripe API error ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}

// ── PayPal ────────────────────────────────────────────────────────────────────

export interface PaypalGatewayOptions {
  /** A pre-fetched OAuth access token (token acquisition is app-specific). */
  accessToken: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

/**
 * PayPal Orders v2 adapter. Captures an order for the charge; refunds the
 * capture on `refund`. Amounts are formatted as major units (e.g. dollars).
 */
export class PaypalGateway implements PaymentGateway {
  readonly name = 'paypal';
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetch: FetchLike;

  constructor(options: PaypalGatewayOptions) {
    if (!options?.accessToken) throw new Error('PaypalGateway: accessToken is required');
    this.token = options.accessToken;
    this.baseUrl = (options.baseUrl ?? 'https://api-m.paypal.com').replace(/\/$/, '');
    this.fetch = resolveFetch(options.fetch);
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const value = (request.amountCents / 100).toFixed(2);
    const res = await this.fetch(`${this.baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: request.currency.toUpperCase(), value }, custom_id: request.reference }],
      }),
    });
    const json = await this.readJson(res);
    const status = String(json['status'] ?? '');
    if (status !== 'COMPLETED' && status !== 'APPROVED') {
      throw new PaymentError(`paypal: order not completed (status=${status || 'unknown'})`);
    }
    return { id: String(json['id']), status: 'succeeded' };
  }

  async refund(paymentId: string): Promise<void> {
    const res = await this.fetch(`${this.baseUrl}/v2/payments/captures/${paymentId}/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: '{}',
    });
    await this.readJson(res);
  }

  private async readJson(res: { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }): Promise<Record<string, unknown>> {
    if (!res.ok) {
      let body = '';
      try { body = await res.text(); } catch { /* ignore */ }
      throw new PaymentError(`paypal API error ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }
}
