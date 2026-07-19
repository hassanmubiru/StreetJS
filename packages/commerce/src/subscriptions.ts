// packages/commerce/src/subscriptions.ts
// Recurring subscriptions + seat management for @streetjs/commerce.
//
// This is an additive, self-contained billing layer: it has its OWN pluggable
// `SubscriptionStore` (in-memory default) so the existing `CommerceStore` and
// its Postgres implementation are untouched (backward compatible). It reuses
// the commerce `PaymentGateway` contract for charges, so the same gateway that
// powers one-off checkout also powers recurring billing.
//
// Money is integer minor units (cents). Time is epoch ms via an injectable
// clock. Proration is intentionally NOT implemented (documented below) rather
// than approximated — plan changes take effect from the next period.

import { randomUUID } from 'node:crypto';

import { PaymentError, type Cents, type PaymentGateway } from './types.js';
import { FakeGateway } from './index.js';

/** Billing cadence for a plan. */
export type BillingInterval = 'month' | 'year';

/** Lifecycle status of a subscription. */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

/** A subscribable plan. `seats: null` means unlimited seats. */
export interface Plan {
  id: string;
  name: string;
  priceCents: Cents;
  currency: string;
  interval: BillingInterval;
  /** Seat allowance; `null` = unlimited. Default from `createPlan` is `null`. */
  seats: number | null;
  /** Free trial length in days (no charge until it ends). Default 0. */
  trialDays: number;
  active: boolean;
}

/** A customer's subscription to a plan. */
export interface Subscription {
  id: string;
  planId: string;
  customerId: string;
  status: SubscriptionStatus;
  /** Seat allowance copied from the plan at subscribe time (`null` = unlimited). */
  seats: number | null;
  /** Seats currently assigned. */
  usedSeats: number;
  /** Current billing period start (epoch ms). */
  currentPeriodStart: number;
  /** Current billing period end (epoch ms) — when the next renewal is due. */
  currentPeriodEnd: number;
  /** If true, the subscription cancels at `currentPeriodEnd` instead of renewing. */
  cancelAtPeriodEnd: boolean;
  /** Last successful payment id, when charged. */
  lastPaymentId: string | null;
  createdAt: number;
  canceledAt: number | null;
}

export class SubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionError';
  }
}

export class SeatLimitError extends SubscriptionError {
  constructor(
    public readonly subscriptionId: string,
    public readonly seats: number,
  ) {
    super(`Subscription "${subscriptionId}" has no free seats (limit ${seats})`);
    this.name = 'SeatLimitError';
  }
}

// ── Store ────────────────────────────────────────────────────────────────────

export interface SubscriptionStore {
  insertPlan(plan: Plan): Promise<void>;
  getPlan(id: string): Promise<Plan | undefined>;
  listPlans(): Promise<Plan[]>;
  updatePlan(plan: Plan): Promise<void>;

  insertSubscription(sub: Subscription): Promise<void>;
  getSubscription(id: string): Promise<Subscription | undefined>;
  listSubscriptions(): Promise<Subscription[]>;
  updateSubscription(sub: Subscription): Promise<void>;
}

export class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly plans = new Map<string, Plan>();
  private readonly subs = new Map<string, Subscription>();

  async insertPlan(plan: Plan): Promise<void> {
    this.plans.set(plan.id, { ...plan });
  }
  async getPlan(id: string): Promise<Plan | undefined> {
    const p = this.plans.get(id);
    return p ? { ...p } : undefined;
  }
  async listPlans(): Promise<Plan[]> {
    return [...this.plans.values()].map((p) => ({ ...p }));
  }
  async updatePlan(plan: Plan): Promise<void> {
    this.plans.set(plan.id, { ...plan });
  }

  async insertSubscription(sub: Subscription): Promise<void> {
    this.subs.set(sub.id, { ...sub });
  }
  async getSubscription(id: string): Promise<Subscription | undefined> {
    const s = this.subs.get(id);
    return s ? { ...s } : undefined;
  }
  async listSubscriptions(): Promise<Subscription[]> {
    return [...this.subs.values()].map((s) => ({ ...s }));
  }
  async updateSubscription(sub: Subscription): Promise<void> {
    this.subs.set(sub.id, { ...sub });
  }
}

// ── Interval math (pure, calendar-aware, UTC) ──────────────────────────────────

/** Advance `epochMs` by one billing interval, preserving the calendar day. */
export function addInterval(epochMs: number, interval: BillingInterval): number {
  const d = new Date(epochMs);
  if (interval === 'month') {
    d.setUTCMonth(d.getUTCMonth() + 1);
  } else {
    d.setUTCFullYear(d.getUTCFullYear() + 1);
  }
  return d.getTime();
}

// ── Service ────────────────────────────────────────────────────────────────────

export interface SubscriptionServiceOptions {
  store?: SubscriptionStore;
  gateway?: PaymentGateway;
  now?: () => number;
  idGen?: () => string;
}

export class SubscriptionService {
  private readonly store: SubscriptionStore;
  private readonly gateway: PaymentGateway;
  private readonly now: () => number;
  private readonly idGen: () => string;

  constructor(options: SubscriptionServiceOptions = {}) {
    this.store = options.store ?? new InMemorySubscriptionStore();
    this.gateway = options.gateway ?? new FakeGateway();
    this.now = options.now ?? (() => Date.now());
    this.idGen = options.idGen ?? (() => randomUUID());
  }

  // ── Plans ────────────────────────────────────────────────────────────────────

  async createPlan(input: {
    name: string;
    priceCents: Cents;
    currency: string;
    interval: BillingInterval;
    seats?: number | null;
    trialDays?: number;
    id?: string;
  }): Promise<Plan> {
    if (typeof input?.name !== 'string' || input.name.length === 0) {
      throw new SubscriptionError('createPlan: name must be a non-empty string');
    }
    if (!Number.isInteger(input?.priceCents) || input.priceCents < 0) {
      throw new SubscriptionError('createPlan: priceCents must be a non-negative integer');
    }
    if (typeof input?.currency !== 'string' || input.currency.length === 0) {
      throw new SubscriptionError('createPlan: currency must be a non-empty string');
    }
    if (input?.interval !== 'month' && input?.interval !== 'year') {
      throw new SubscriptionError('createPlan: interval must be "month" or "year"');
    }
    const seats = input.seats === undefined ? null : input.seats;
    if (seats !== null && (!Number.isInteger(seats) || seats <= 0)) {
      throw new SubscriptionError('createPlan: seats must be a positive integer or null (unlimited)');
    }
    const trialDays = input.trialDays ?? 0;
    if (!Number.isInteger(trialDays) || trialDays < 0) {
      throw new SubscriptionError('createPlan: trialDays must be a non-negative integer');
    }
    const plan: Plan = {
      id: input.id ?? this.idGen(),
      name: input.name,
      priceCents: input.priceCents,
      currency: input.currency,
      interval: input.interval,
      seats,
      trialDays,
      active: true,
    };
    await this.store.insertPlan(plan);
    return plan;
  }

  async getPlan(id: string): Promise<Plan | undefined> {
    return this.store.getPlan(id);
  }

  async listPlans(options: { activeOnly?: boolean } = {}): Promise<Plan[]> {
    const all = await this.store.listPlans();
    return options.activeOnly ? all.filter((p) => p.active) : all;
  }

  // ── Subscribe / renew / cancel ─────────────────────────────────────────────────

  /**
   * Start a subscription for a customer. If the plan has a trial the first
   * charge is deferred until the trial ends (status `trialing`); otherwise the
   * customer is charged immediately (status `active`). A declined charge throws
   * `PaymentError` and no subscription is created.
   */
  async subscribe(input: {
    customerId: string;
    planId: string;
    gateway?: PaymentGateway;
    seats?: number | null;
  }): Promise<Subscription> {
    const customerId = requireId(input?.customerId, 'customerId');
    const plan = await this.store.getPlan(requireId(input?.planId, 'planId'));
    if (!plan) throw new SubscriptionError(`Plan "${input.planId}" not found`);
    if (!plan.active) throw new SubscriptionError(`Plan "${plan.id}" is not active`);

    const seats = input.seats === undefined ? plan.seats : input.seats;
    if (seats !== null && (!Number.isInteger(seats) || seats <= 0)) {
      throw new SubscriptionError('subscribe: seats must be a positive integer or null (unlimited)');
    }

    const start = this.now();
    const trialing = plan.trialDays > 0;
    const id = this.idGen();
    let lastPaymentId: string | null = null;
    let periodEnd: number;

    if (trialing) {
      periodEnd = start + plan.trialDays * DAY_MS;
    } else {
      lastPaymentId = await this.charge(input.gateway, plan, id);
      periodEnd = addInterval(start, plan.interval);
    }

    const sub: Subscription = {
      id,
      planId: plan.id,
      customerId,
      status: trialing ? 'trialing' : 'active',
      seats,
      usedSeats: 0,
      currentPeriodStart: start,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      lastPaymentId,
      createdAt: start,
      canceledAt: null,
    };
    await this.store.insertSubscription(sub);
    return sub;
  }

  /**
   * Renew a subscription that has reached the end of its period. Charges for the
   * next period and advances the window. If `cancelAtPeriodEnd` is set, the
   * subscription transitions to `canceled` instead of renewing. A declined
   * charge marks the subscription `past_due` (and does not advance the period).
   */
  async renew(subscriptionId: string, options: { gateway?: PaymentGateway } = {}): Promise<Subscription> {
    const sub = await this.requireSubscription(subscriptionId);
    if (sub.status === 'canceled') throw new SubscriptionError(`Subscription "${sub.id}" is canceled`);
    const plan = await this.store.getPlan(sub.planId);
    if (!plan) throw new SubscriptionError(`Plan "${sub.planId}" not found`);

    if (sub.cancelAtPeriodEnd) {
      sub.status = 'canceled';
      sub.canceledAt = this.now();
      await this.store.updateSubscription(sub);
      return sub;
    }

    try {
      sub.lastPaymentId = await this.charge(options.gateway, plan, sub.id);
    } catch (err) {
      if (err instanceof PaymentError) {
        sub.status = 'past_due';
        await this.store.updateSubscription(sub);
        return sub;
      }
      throw err;
    }

    sub.currentPeriodStart = sub.currentPeriodEnd;
    sub.currentPeriodEnd = addInterval(sub.currentPeriodEnd, plan.interval);
    sub.status = 'active';
    await this.store.updateSubscription(sub);
    return sub;
  }

  /**
   * Cancel a subscription. By default cancellation is at period end (the
   * subscription keeps working until `currentPeriodEnd`); pass
   * `{ immediately: true }` to cancel now.
   */
  async cancel(subscriptionId: string, options: { immediately?: boolean } = {}): Promise<Subscription> {
    const sub = await this.requireSubscription(subscriptionId);
    if (sub.status === 'canceled') return sub;
    if (options.immediately) {
      sub.status = 'canceled';
      sub.canceledAt = this.now();
    } else {
      sub.cancelAtPeriodEnd = true;
    }
    await this.store.updateSubscription(sub);
    return sub;
  }

  /**
   * Change the plan on a subscription. The new plan applies from the NEXT
   * renewal — no mid-period proration is computed (documented limitation).
   * Seat allowance is updated to the new plan's, but only if the currently used
   * seats still fit; otherwise a `SeatLimitError` is thrown.
   */
  async changePlan(subscriptionId: string, newPlanId: string): Promise<Subscription> {
    const sub = await this.requireSubscription(subscriptionId);
    if (sub.status === 'canceled') throw new SubscriptionError(`Subscription "${sub.id}" is canceled`);
    const plan = await this.store.getPlan(requireId(newPlanId, 'newPlanId'));
    if (!plan) throw new SubscriptionError(`Plan "${newPlanId}" not found`);
    if (!plan.active) throw new SubscriptionError(`Plan "${plan.id}" is not active`);

    if (plan.seats !== null && sub.usedSeats > plan.seats) {
      throw new SeatLimitError(sub.id, plan.seats);
    }
    sub.planId = plan.id;
    sub.seats = plan.seats;
    await this.store.updateSubscription(sub);
    return sub;
  }

  // ── Seats ──────────────────────────────────────────────────────────────────

  /** Assign one seat; throws `SeatLimitError` when the allowance is exhausted. */
  async assignSeat(subscriptionId: string): Promise<Subscription> {
    const sub = await this.requireActive(subscriptionId);
    if (sub.seats !== null && sub.usedSeats >= sub.seats) {
      throw new SeatLimitError(sub.id, sub.seats);
    }
    sub.usedSeats += 1;
    await this.store.updateSubscription(sub);
    return sub;
  }

  /** Release one seat (floored at 0). */
  async releaseSeat(subscriptionId: string): Promise<Subscription> {
    const sub = await this.requireSubscription(subscriptionId);
    sub.usedSeats = Math.max(0, sub.usedSeats - 1);
    await this.store.updateSubscription(sub);
    return sub;
  }

  /** Seats still available (`Infinity` for unlimited plans). */
  async seatsAvailable(subscriptionId: string): Promise<number> {
    const sub = await this.requireSubscription(subscriptionId);
    return sub.seats === null ? Number.POSITIVE_INFINITY : Math.max(0, sub.seats - sub.usedSeats);
  }

  async getSubscription(id: string): Promise<Subscription | undefined> {
    return this.store.getSubscription(id);
  }

  async listSubscriptions(): Promise<Subscription[]> {
    return this.store.listSubscriptions();
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private async charge(gateway: PaymentGateway | undefined, plan: Plan, reference: string): Promise<string> {
    const g = gateway ?? this.gateway;
    const res = await g.charge({ amountCents: plan.priceCents, currency: plan.currency, reference });
    return res.id;
  }

  private async requireSubscription(id: string): Promise<Subscription> {
    const sub = await this.store.getSubscription(requireId(id, 'subscriptionId'));
    if (!sub) throw new SubscriptionError(`Subscription "${id}" not found`);
    return sub;
  }

  private async requireActive(id: string): Promise<Subscription> {
    const sub = await this.requireSubscription(id);
    if (sub.status === 'canceled' || sub.status === 'past_due') {
      throw new SubscriptionError(`Subscription "${sub.id}" is ${sub.status}; cannot assign seats`);
    }
    return sub;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function requireId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SubscriptionError(`SubscriptionService: ${field} must be a non-empty string`);
  }
  return value;
}
