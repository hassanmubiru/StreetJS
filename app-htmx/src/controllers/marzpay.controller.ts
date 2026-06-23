import 'reflect-metadata';
import { Controller, Get, Post } from 'streetjs';
import type { StreetContext } from 'streetjs';
import type { MarzPayClient, PaymentInitResult } from '@streetjs/plugin-marzpay';

// MarzPay HTMX controller (server-rendered fragments — no SPA, no client build).
//
// The MarzPayClient is injected by MarzPayPlugin into `ctx.state['marzpay']`.
// Each handler renders via `ctx.htmx`, which returns just the page fragment for
// HTMX (`hx-post`) requests and the full layout on direct navigation.
//
// Requirement 7.5 is the critical invariant: when `initializePayment` throws OR
// returns a non-success result, the controller returns the FAILURE fragment and
// never a redirect fragment (and sets no HX-Redirect header).

// Verified MarzPay status vocabulary (Research_Artifact): a terminal failure is
// `failed` or `cancelled`. `successful`/`completed`/`processing`/`pending`/
// `sandbox` are not failures. A non-empty redirect_url (card flow) is success.
const FAILED_STATUSES = new Set<string>(['failed', 'cancelled']);

function isSuccessfulInit(result: PaymentInitResult): boolean {
  if (typeof result.redirectUrl === 'string' && result.redirectUrl.trim() !== '') return true;
  return !FAILED_STATUSES.has((result.status ?? '').toLowerCase());
}

function clientOf(ctx: StreetContext): MarzPayClient | undefined {
  return (ctx.state as Record<string, unknown>)['marzpay'] as MarzPayClient | undefined;
}

interface CheckoutBody { amount?: string; currency?: string; country?: string; reference?: string }
interface StatusBody { reference?: string }
interface SubscriptionBody { planId?: string }

// Illustrative plan catalogue for the HTMX overlay. A real app reads plans from
// configuration (see the SaaS billing modules); these are scaffold defaults.
const PLANS: Record<string, { name: string; amount: number; currency: string }> = {
  basic: { name: 'Basic', amount: 10000, currency: 'UGX' },
  pro: { name: 'Pro', amount: 30000, currency: 'UGX' },
};

@Controller('/marzpay')
export class MarzPayViewsController {
  /** Render the payment initialization (checkout) fragment. */
  @Get('/checkout')
  async checkout(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('marzpay/checkout', {
      title: 'Checkout',
      amount: 10000,
      currency: 'UGX',
      country: 'UG',
      reference: '',
    });
  }

  /** hx-post: initialize a MarzPay payment; return the redirect/status fragment. */
  @Post('/checkout')
  async initialize(ctx: StreetContext): Promise<void> {
    const body = (ctx.body ?? {}) as CheckoutBody;
    await this.startPayment(ctx, {
      amount: Number(body.amount),
      currency: (body.currency ?? '').trim(),
      country: (body.country ?? '').trim(),
      reference: (body.reference ?? '').trim(),
    });
  }

  /** Render the subscription management fragment. */
  @Get('/subscription')
  async subscription(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('marzpay/subscription', {
      title: 'Subscription',
      planName: 'None',
      planStatus: 'inactive',
    });
  }

  /** hx-post: start a MarzPay payment for the selected plan (initializePayment). */
  @Post('/subscription')
  async subscribe(ctx: StreetContext): Promise<void> {
    const body = (ctx.body ?? {}) as SubscriptionBody;
    const planId = (body.planId ?? '').trim();
    const plan = PLANS[planId];
    if (plan === undefined) {
      // Unknown plan: a non-success outcome -> failure fragment, no redirect.
      ctx.htmx.view('marzpay/failure', {
        title: 'Subscription failed',
        message: `Unknown plan "${planId}".`,
      }, 400);
      return;
    }
    await this.startPayment(ctx, {
      amount: plan.amount,
      currency: plan.currency,
      country: 'UG',
      reference: `sub-${planId}-${Date.now()}`,
    });
  }

  /** hx-post: verify a payment by reference; return the status fragment. */
  @Post('/status')
  async status(ctx: StreetContext): Promise<void> {
    const body = (ctx.body ?? {}) as StatusBody;
    const reference = (body.reference ?? '').trim();
    const client = clientOf(ctx);
    if (client === undefined) {
      ctx.htmx.view('marzpay/failure', {
        title: 'Status unavailable',
        message: 'MarzPay is not configured on this server.',
      }, 500);
      return;
    }
    try {
      const result = await client.verifyPayment(reference);
      ctx.htmx.view('marzpay/status', { title: 'Payment status', reference: result.reference, status: result.status });
    } catch (err) {
      ctx.htmx.view('marzpay/failure', {
        title: 'Status unavailable',
        message: err instanceof Error ? err.message : 'Could not verify payment status.',
      }, 200);
    }
  }

  /**
   * Shared initialization path. On a verified success with a redirect_url it
   * returns the redirect fragment (and sets HX-Redirect); on a verified success
   * without a redirect it returns the status fragment; on an error OR a
   * non-success result it returns the failure fragment and NO redirect (R7.5).
   */
  private async startPayment(
    ctx: StreetContext,
    req: { amount: number; currency: string; country: string; reference: string },
  ): Promise<void> {
    const client = clientOf(ctx);
    if (client === undefined) {
      ctx.htmx.view('marzpay/failure', {
        title: 'Payment failed',
        message: 'MarzPay is not configured on this server.',
      }, 500);
      return;
    }
    try {
      const result = await client.initializePayment({
        amount: req.amount,
        currency: req.currency,
        country: req.country,
        reference: req.reference,
        method: 'card',
      });
      if (!isSuccessfulInit(result)) {
        ctx.htmx.view('marzpay/failure', {
          title: 'Payment failed',
          message: `Payment could not be initialized (status: ${result.status}).`,
        }, 200);
        return;
      }
      if (typeof result.redirectUrl === 'string' && result.redirectUrl.trim() !== '') {
        ctx.htmx
          .hx({ redirect: result.redirectUrl })
          .view('marzpay/redirect', { title: 'Redirecting', reference: result.reference, redirectUrl: result.redirectUrl });
        return;
      }
      ctx.htmx.view('marzpay/status', { title: 'Payment status', reference: result.reference, status: result.status });
    } catch (err) {
      ctx.htmx.view('marzpay/failure', {
        title: 'Payment failed',
        message: err instanceof Error ? err.message : 'Payment initialization failed.',
      }, 200);
    }
  }
}
