// packages/commerce/src/tests/subscriptions.test.ts
// Recurring subscriptions + seats. Offline: FakeGateway, injected clock.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SubscriptionService,
  SubscriptionError,
  SeatLimitError,
  addInterval,
  FakeGateway,
  PaymentError,
  type PaymentGateway,
} from '../index.js';

const T0 = Date.UTC(2026, 0, 15, 12, 0, 0); // 2026-01-15T12:00:00Z

function svc(overrides: { gateway?: PaymentGateway; now?: () => number } = {}): SubscriptionService {
  let n = 0;
  return new SubscriptionService({
    gateway: overrides.gateway,
    now: overrides.now ?? (() => T0),
    idGen: () => `id_${++n}`,
  });
}

describe('addInterval', () => {
  it('advances one month and one year in UTC', () => {
    assert.equal(addInterval(Date.UTC(2026, 0, 15), 'month'), Date.UTC(2026, 1, 15));
    assert.equal(addInterval(Date.UTC(2026, 0, 15), 'year'), Date.UTC(2027, 0, 15));
    // Month rollover across year boundary.
    assert.equal(addInterval(Date.UTC(2026, 11, 10), 'month'), Date.UTC(2027, 0, 10));
  });
});

describe('createPlan', () => {
  it('creates a plan with defaults (unlimited seats, no trial)', async () => {
    const s = svc();
    const plan = await s.createPlan({ name: 'Pro', priceCents: 1500, currency: 'USD', interval: 'month' });
    assert.equal(plan.seats, null);
    assert.equal(plan.trialDays, 0);
    assert.equal(plan.active, true);
  });

  it('validates inputs', async () => {
    const s = svc();
    await assert.rejects(() => s.createPlan({ name: '', priceCents: 1, currency: 'USD', interval: 'month' }), SubscriptionError);
    await assert.rejects(() => s.createPlan({ name: 'x', priceCents: -1, currency: 'USD', interval: 'month' }), /priceCents/);
    await assert.rejects(() => s.createPlan({ name: 'x', priceCents: 1, currency: '', interval: 'month' }), /currency/);
    await assert.rejects(() => s.createPlan({ name: 'x', priceCents: 1, currency: 'USD', interval: 'week' as never }), /interval/);
    await assert.rejects(() => s.createPlan({ name: 'x', priceCents: 1, currency: 'USD', interval: 'month', seats: 0 }), /seats/);
    await assert.rejects(() => s.createPlan({ name: 'x', priceCents: 1, currency: 'USD', interval: 'month', trialDays: -1 }), /trialDays/);
  });
});

describe('subscribe', () => {
  it('charges immediately for a no-trial plan and sets an active monthly period', async () => {
    const gateway = new FakeGateway();
    const s = svc({ gateway });
    const plan = await s.createPlan({ name: 'Pro', priceCents: 1500, currency: 'USD', interval: 'month' });
    const sub = await s.subscribe({ customerId: 'cust_1', planId: plan.id });

    assert.equal(sub.status, 'active');
    assert.equal(sub.currentPeriodStart, T0);
    assert.equal(sub.currentPeriodEnd, addInterval(T0, 'month'));
    assert.equal(gateway.charged.length, 1);
    assert.equal(gateway.charged[0]!.amountCents, 1500);
    assert.equal(sub.lastPaymentId !== null, true);
  });

  it('defers the charge during a trial', async () => {
    const gateway = new FakeGateway();
    const s = svc({ gateway });
    const plan = await s.createPlan({ name: 'Pro', priceCents: 1500, currency: 'USD', interval: 'month', trialDays: 14 });
    const sub = await s.subscribe({ customerId: 'cust_1', planId: plan.id });

    assert.equal(sub.status, 'trialing');
    assert.equal(sub.currentPeriodEnd, T0 + 14 * 24 * 60 * 60 * 1000);
    assert.equal(gateway.charged.length, 0);
    assert.equal(sub.lastPaymentId, null);
  });

  it('propagates a declined charge and creates no subscription', async () => {
    const gateway = new FakeGateway({ declineAtOrAbove: 1000 });
    const s = svc({ gateway });
    const plan = await s.createPlan({ name: 'Pro', priceCents: 1500, currency: 'USD', interval: 'month' });
    await assert.rejects(() => s.subscribe({ customerId: 'c', planId: plan.id }), PaymentError);
    assert.deepEqual(await s.listSubscriptions(), []);
  });

  it('rejects unknown/inactive plans', async () => {
    const s = svc();
    await assert.rejects(() => s.subscribe({ customerId: 'c', planId: 'nope' }), /not found/);
  });
});

describe('renew', () => {
  it('advances the period and charges again', async () => {
    const gateway = new FakeGateway();
    const s = svc({ gateway });
    const plan = await s.createPlan({ name: 'Pro', priceCents: 1500, currency: 'USD', interval: 'month' });
    const sub = await s.subscribe({ customerId: 'c', planId: plan.id });
    const renewed = await s.renew(sub.id);

    assert.equal(renewed.status, 'active');
    assert.equal(renewed.currentPeriodStart, addInterval(T0, 'month'));
    assert.equal(renewed.currentPeriodEnd, addInterval(addInterval(T0, 'month'), 'month'));
    assert.equal(gateway.charged.length, 2);
  });

  it('marks past_due on a declined renewal without advancing the period', async () => {
    // First charge succeeds, later ones decline: use a gateway that declines the 2nd charge.
    let calls = 0;
    const gateway: PaymentGateway = {
      name: 'flaky',
      async charge() {
        calls += 1;
        if (calls >= 2) throw new PaymentError('declined');
        return { id: `pay_${calls}`, status: 'succeeded' };
      },
      async refund() {},
    };
    const s = svc({ gateway });
    const plan = await s.createPlan({ name: 'Pro', priceCents: 1500, currency: 'USD', interval: 'month' });
    const sub = await s.subscribe({ customerId: 'c', planId: plan.id });
    const renewed = await s.renew(sub.id);

    assert.equal(renewed.status, 'past_due');
    assert.equal(renewed.currentPeriodEnd, sub.currentPeriodEnd); // unchanged
  });

  it('cancels at period end instead of renewing when flagged', async () => {
    const s = svc();
    const plan = await s.createPlan({ name: 'Pro', priceCents: 100, currency: 'USD', interval: 'month' });
    const sub = await s.subscribe({ customerId: 'c', planId: plan.id });
    await s.cancel(sub.id); // at period end
    const renewed = await s.renew(sub.id);
    assert.equal(renewed.status, 'canceled');
    assert.equal(renewed.canceledAt !== null, true);
  });
});

describe('cancel', () => {
  it('cancels at period end by default and immediately when asked', async () => {
    const s = svc();
    const plan = await s.createPlan({ name: 'Pro', priceCents: 100, currency: 'USD', interval: 'month' });

    const a = await s.subscribe({ customerId: 'a', planId: plan.id });
    const atEnd = await s.cancel(a.id);
    assert.equal(atEnd.status, 'active');
    assert.equal(atEnd.cancelAtPeriodEnd, true);

    const b = await s.subscribe({ customerId: 'b', planId: plan.id });
    const now = await s.cancel(b.id, { immediately: true });
    assert.equal(now.status, 'canceled');
    // Idempotent.
    assert.equal((await s.cancel(b.id)).status, 'canceled');
  });
});

describe('seats', () => {
  it('assigns up to the limit then throws SeatLimitError', async () => {
    const s = svc();
    const plan = await s.createPlan({ name: 'Team', priceCents: 5000, currency: 'USD', interval: 'month', seats: 2 });
    const sub = await s.subscribe({ customerId: 'org', planId: plan.id });

    await s.assignSeat(sub.id);
    const two = await s.assignSeat(sub.id);
    assert.equal(two.usedSeats, 2);
    assert.equal(await s.seatsAvailable(sub.id), 0);
    await assert.rejects(() => s.assignSeat(sub.id), SeatLimitError);

    const released = await s.releaseSeat(sub.id);
    assert.equal(released.usedSeats, 1);
    assert.equal(await s.seatsAvailable(sub.id), 1);
  });

  it('treats null seats as unlimited', async () => {
    const s = svc();
    const plan = await s.createPlan({ name: 'Solo', priceCents: 0, currency: 'USD', interval: 'month' }); // seats: null
    const sub = await s.subscribe({ customerId: 'u', planId: plan.id });
    for (let i = 0; i < 50; i += 1) await s.assignSeat(sub.id);
    assert.equal((await s.getSubscription(sub.id))!.usedSeats, 50);
    assert.equal(await s.seatsAvailable(sub.id), Number.POSITIVE_INFINITY);
  });

  it('refuses seat assignment on canceled/past_due subscriptions', async () => {
    const s = svc();
    const plan = await s.createPlan({ name: 'X', priceCents: 100, currency: 'USD', interval: 'month' });
    const sub = await s.subscribe({ customerId: 'u', planId: plan.id });
    await s.cancel(sub.id, { immediately: true });
    await assert.rejects(() => s.assignSeat(sub.id), /canceled/);
  });

  it('releaseSeat floors at zero', async () => {
    const s = svc();
    const plan = await s.createPlan({ name: 'X', priceCents: 0, currency: 'USD', interval: 'month' });
    const sub = await s.subscribe({ customerId: 'u', planId: plan.id });
    const r = await s.releaseSeat(sub.id);
    assert.equal(r.usedSeats, 0);
  });
});

describe('changePlan', () => {
  it('swaps the plan and updates the seat allowance', async () => {
    const s = svc();
    const small = await s.createPlan({ name: 'S', priceCents: 100, currency: 'USD', interval: 'month', seats: 2 });
    const big = await s.createPlan({ name: 'B', priceCents: 500, currency: 'USD', interval: 'month', seats: 10 });
    const sub = await s.subscribe({ customerId: 'org', planId: small.id });
    await s.assignSeat(sub.id);
    const changed = await s.changePlan(sub.id, big.id);
    assert.equal(changed.planId, big.id);
    assert.equal(changed.seats, 10);
  });

  it('rejects a downgrade that would strand assigned seats', async () => {
    const s = svc();
    const big = await s.createPlan({ name: 'B', priceCents: 500, currency: 'USD', interval: 'month', seats: 10 });
    const small = await s.createPlan({ name: 'S', priceCents: 100, currency: 'USD', interval: 'month', seats: 1 });
    const sub = await s.subscribe({ customerId: 'org', planId: big.id });
    await s.assignSeat(sub.id);
    await s.assignSeat(sub.id); // used 2 > small.seats(1)
    await assert.rejects(() => s.changePlan(sub.id, small.id), SeatLimitError);
  });
});
