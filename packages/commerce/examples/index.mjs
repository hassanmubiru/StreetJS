// Runnable example: a tiny storefront checkout flow.
//
//   npm run example -w packages/commerce
//
// Uses the deterministic FakeGateway (no API keys, no network).

import { CommerceService, FakeGateway } from '@streetjs/commerce';

const gateway = new FakeGateway();
const shop = new CommerceService({ gateway });

// Catalog + stock.
const tshirt = shop.createProduct({ name: 'T-Shirt', priceCents: 2000 });
const mug = shop.createProduct({ name: 'Mug', priceCents: 1200 });
shop.restock(tshirt.id, 5);
shop.restock(mug.id, 3);
shop.createCoupon({ code: 'WELCOME', kind: 'fixed', value: 500 });

// Build a cart.
shop.addToCart('cart-1', tshirt.id, 2);
shop.addToCart('cart-1', mug.id, 1);
const cart = shop.getCart('cart-1');
console.log('cart subtotal:', cart.subtotalCents, 'cents'); // 5200

// Checkout with a coupon.
const order = await shop.checkout('cart-1', { couponCode: 'WELCOME' });
console.log('order:', { subtotal: order.subtotalCents, discount: order.discountCents, total: order.totalCents, status: order.status });
console.log('t-shirt availability after sale:', shop.availability(tshirt.id));

// Try to oversell — fails cleanly without charging.
shop.addToCart('cart-2', mug.id, 10);
try {
  await shop.checkout('cart-2');
} catch (err) {
  console.log('\noversell prevented ->', err.name + ':', err.message);
}

// Reviews.
shop.addReview({ productId: tshirt.id, userId: 'u1', rating: 5, text: 'Great fit' });
shop.addReview({ productId: tshirt.id, userId: 'u2', rating: 4 });
console.log('\nt-shirt average rating:', shop.averageRating(tshirt.id));

// Cancel + refund + restock.
const cancelled = await shop.cancelOrder(order.id);
console.log('cancelled order status:', cancelled.status, '| refunds:', gateway.refunded.length, '| t-shirt on hand:', shop.availability(tshirt.id).onHand);
