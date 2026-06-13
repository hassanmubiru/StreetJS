// End-to-end smoke test for the Ecommerce reference app.
//   node examples/reference-apps/ecommerce/smoke-test.mjs

import assert from 'node:assert/strict';
import { createStore } from './server.mjs';
import { InsufficientStockError } from '@streetjs/commerce';

const app = createStore();
const { shop } = app;
let failures = 0;
const check = async (n, fn) => { try { await fn(); console.log('  ok  ' + n); } catch (e) { failures++; console.log('  FAIL ' + n + ': ' + e.message); } };

const widget = await shop.createProduct({ name: 'Widget', priceCents: 1500 });
await shop.restock(widget.id, 3);
await shop.createCoupon({ code: 'SAVE10', kind: 'percent', value: 10 });

await check('checkout charges, applies coupon, commits stock', async () => {
  await shop.addToCart('c1', widget.id, 2);
  const order = await shop.checkout('c1', { couponCode: 'SAVE10' });
  assert.equal(order.subtotalCents, 3000);
  assert.equal(order.totalCents, 2700);
  assert.equal(order.status, 'paid');
  assert.equal((await shop.availability(widget.id)).onHand, 1);
});

await check('no oversell — checkout beyond stock is rejected before charge', async () => {
  await shop.addToCart('c2', widget.id, 5);
  await assert.rejects(() => shop.checkout('c2'), InsufficientStockError);
  assert.equal((await shop.availability(widget.id)).available, 1);
});

await check('cancel refunds and restocks', async () => {
  const orders = await shop.listOrders();
  const cancelled = await shop.cancelOrder(orders[0].id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(app.gateway.refunded.length, 1);
  assert.equal((await shop.availability(widget.id)).onHand, 3);
});

await app.close();
console.log(failures === 0 ? '\n✅ ecommerce reference app: all checks passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
