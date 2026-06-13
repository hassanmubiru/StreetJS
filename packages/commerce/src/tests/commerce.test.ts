// commerce.test.ts
// Example/edge-case unit tests for the commerce domain.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CommerceService, FakeGateway, InsufficientStockError, PaymentError } from '../index.js';

function svc(opts = {}) {
  let n = 0;
  return new CommerceService({ now: () => 1, idGen: () => `id${++n}`, ...opts });
}

describe('Products & inventory', () => {
  it('creates products and tracks availability', () => {
    const c = svc();
    const p = c.createProduct({ name: 'Widget', priceCents: 1500 });
    assert.equal(p.active, true);
    assert.deepEqual(c.availability(p.id), { onHand: 0, reserved: 0, available: 0 });
    c.restock(p.id, 10);
    assert.deepEqual(c.availability(p.id), { onHand: 10, reserved: 0, available: 10 });
  });

  it('validates money and counts', () => {
    const c = svc();
    assert.throws(() => c.createProduct({ name: '', priceCents: 1 }), /name/);
    assert.throws(() => c.createProduct({ name: 'x', priceCents: -1 }), /non-negative integer/);
    assert.throws(() => c.createProduct({ name: 'x', priceCents: 1.5 }), /non-negative integer/);
    const p = c.createProduct({ name: 'x', priceCents: 100 });
    assert.throws(() => c.restock(p.id, 0), /positive integer/);
  });
});

describe('Cart', () => {
  it('accumulates quantities and computes subtotal', () => {
    const c = svc();
    const a = c.createProduct({ name: 'A', priceCents: 1000 });
    const b = c.createProduct({ name: 'B', priceCents: 250 });
    c.addToCart('cart1', a.id, 2);
    c.addToCart('cart1', b.id, 3);
    c.addToCart('cart1', a.id, 1); // now 3 of A
    const cart = c.getCart('cart1');
    assert.equal(cart.subtotalCents, 3 * 1000 + 3 * 250);
    assert.equal(cart.lines.length, 2);
  });

  it('rejects inactive products and currency mixing', () => {
    const c = svc();
    const usd = c.createProduct({ name: 'USD', priceCents: 100, currency: 'USD' });
    const eur = c.createProduct({ name: 'EUR', priceCents: 100, currency: 'EUR' });
    c.addToCart('k', usd.id, 1);
    assert.throws(() => c.addToCart('k', eur.id, 1), /currency mismatch/i);
    const dead = c.createProduct({ name: 'Dead', priceCents: 100 });
    c.deactivateProduct(dead.id);
    assert.throws(() => c.addToCart('k2', dead.id, 1), /inactive/);
  });

  it('setQuantity removes the line at 0', () => {
    const c = svc();
    const a = c.createProduct({ name: 'A', priceCents: 100 });
    c.addToCart('k', a.id, 5);
    c.setQuantity('k', a.id, 0);
    assert.equal(c.getCart('k').lines.length, 0);
  });
});

describe('Coupons', () => {
  it('applies percent and fixed discounts with floors and caps', () => {
    const c = svc();
    c.createCoupon({ code: 'save10', kind: 'percent', value: 10 });
    c.createCoupon({ code: 'off500', kind: 'fixed', value: 500 });
    assert.deepEqual(c.applyCoupon(999, 'SAVE10'), { discountCents: 99, totalCents: 900 }); // floor(99.9)
    assert.deepEqual(c.applyCoupon(300, 'off500'), { discountCents: 300, totalCents: 0 }); // capped at subtotal
  });

  it('validates coupon definitions and minimums', () => {
    const c = svc();
    assert.throws(() => c.createCoupon({ code: 'x', kind: 'percent', value: 0 }), /\(0, 100\]/);
    c.createCoupon({ code: 'big', kind: 'fixed', value: 100, minSubtotalCents: 1000 });
    assert.throws(() => c.applyCoupon(500, 'big'), /at least 1000/);
    assert.throws(() => c.applyCoupon(100, 'nope'), /not valid/);
  });
});

describe('Checkout', () => {
  it('reserves stock, charges, commits, and clears the cart', async () => {
    const gateway = new FakeGateway();
    const c = svc({ gateway });
    const p = c.createProduct({ name: 'Widget', priceCents: 1500 });
    c.restock(p.id, 5);
    c.addToCart('cart', p.id, 2);

    const order = await c.checkout('cart');
    assert.equal(order.status, 'paid');
    assert.equal(order.totalCents, 3000);
    assert.equal(order.paymentId, gateway.charged.length ? order.paymentId : '');
    assert.deepEqual(c.availability(p.id), { onHand: 3, reserved: 0, available: 3 });
    assert.equal(c.getCart('cart').lines.length, 0); // cart cleared
    assert.equal(gateway.charged[0]!.amountCents, 3000);
  });

  it('applies a coupon at checkout', async () => {
    const c = svc();
    const p = c.createProduct({ name: 'Widget', priceCents: 1000 });
    c.restock(p.id, 5);
    c.addToCart('cart', p.id, 2);
    c.createCoupon({ code: 'half', kind: 'percent', value: 50 });
    const order = await c.checkout('cart', { couponCode: 'half' });
    assert.equal(order.subtotalCents, 2000);
    assert.equal(order.discountCents, 1000);
    assert.equal(order.totalCents, 1000);
    assert.equal(order.couponCode, 'HALF');
  });

  it('throws InsufficientStockError before charging, leaving stock intact', async () => {
    const gateway = new FakeGateway();
    const c = svc({ gateway });
    const p = c.createProduct({ name: 'Rare', priceCents: 100 });
    c.restock(p.id, 1);
    c.addToCart('cart', p.id, 2);
    await assert.rejects(() => c.checkout('cart'), InsufficientStockError);
    assert.deepEqual(c.availability(p.id), { onHand: 1, reserved: 0, available: 1 });
    assert.equal(gateway.charged.length, 0);
  });

  it('releases reservation when payment fails', async () => {
    const gateway = new FakeGateway({ declineAtOrAbove: 1 }); // decline everything
    const c = svc({ gateway });
    const p = c.createProduct({ name: 'Widget', priceCents: 1000 });
    c.restock(p.id, 5);
    c.addToCart('cart', p.id, 2);
    await assert.rejects(() => c.checkout('cart'), PaymentError);
    assert.deepEqual(c.availability(p.id), { onHand: 5, reserved: 0, available: 5 }); // reservation released
  });

  it('cancel refunds and restocks', async () => {
    const gateway = new FakeGateway();
    const c = svc({ gateway });
    const p = c.createProduct({ name: 'Widget', priceCents: 1000 });
    c.restock(p.id, 5);
    c.addToCart('cart', p.id, 2);
    const order = await c.checkout('cart');
    const cancelled = await c.cancelOrder(order.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual(gateway.refunded, [order.paymentId]);
    assert.equal(c.availability(p.id).onHand, 5); // restocked
  });
});

describe('Reviews', () => {
  it('upserts one review per user and averages ratings', () => {
    const c = svc();
    const p = c.createProduct({ name: 'Widget', priceCents: 100 });
    c.addReview({ productId: p.id, userId: 'u1', rating: 4 });
    c.addReview({ productId: p.id, userId: 'u2', rating: 2 });
    c.addReview({ productId: p.id, userId: 'u1', rating: 5 }); // updates u1
    assert.equal(c.listReviews(p.id).length, 2);
    assert.equal(c.averageRating(p.id), 3.5);
    assert.throws(() => c.addReview({ productId: p.id, userId: 'u3', rating: 6 }), /\[1, 5\]/);
  });
});
