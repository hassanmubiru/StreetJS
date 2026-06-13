# @streetjs/commerce

Official Street Framework commerce module: products, inventory (with a strict
**no-oversell** guarantee), carts, coupons, orders, reviews, and a
payment-gateway abstraction. All money is in integer minor units (cents).

- Products + pricing + activation
- Inventory with atomic, all-or-nothing reservation (never oversells)
- Carts (single-currency, subtotal computation)
- Coupons (percent / fixed, minimums, floors & caps)
- Checkout → reserve → charge → commit, with automatic release on failure
- Orders (paid / cancelled with refund + restock)
- Reviews (one per user/product, average rating)
- `PaymentGateway` abstraction: `FakeGateway` (offline), `StripeGateway`, `PaypalGateway`

## Install

```bash
npm install @streetjs/commerce
```

## Quick start

```ts
import { CommerceService } from '@streetjs/commerce';

const shop = new CommerceService(); // uses a FakeGateway by default

const widget = shop.createProduct({ name: 'Widget', priceCents: 1500 });
shop.restock(widget.id, 10);

shop.addToCart('cart-1', widget.id, 2);
shop.createCoupon({ code: 'SAVE10', kind: 'percent', value: 10 });

const order = await shop.checkout('cart-1', { couponCode: 'SAVE10' });
// order.subtotalCents 3000, discountCents 300, totalCents 2700, status 'paid'
shop.availability(widget.id); // { onHand: 8, reserved: 0, available: 8 }
```

## No-oversell guarantee

`checkout` reserves every line **all-or-nothing** before charging. If any line
lacks stock, `InsufficientStockError` is thrown *before* the gateway is touched.
If payment fails, the reservation is released. A property test
(`commerce-pbt.test.ts`, 200 runs) asserts that across random interleavings of
restocks and checkouts: availability is never negative, reservations settle to
zero, and units sold never exceed units restocked.

## Payments

```ts
import { StripeGateway, PaypalGateway, FakeGateway } from '@streetjs/commerce';

const shop = new CommerceService({ gateway: new StripeGateway({ apiKey: process.env.STRIPE_SECRET_KEY }) });
// or per-checkout:
await shop.checkout('cart', { gateway: new PaypalGateway({ accessToken }) });
```

Implement your own by satisfying `PaymentGateway` (`charge` + `refund`). The
Stripe/PayPal adapters accept an injectable `fetch`, so they are unit-tested
without network access.

## API (selected)

- Products: `createProduct`, `getProduct`, `listProducts`, `setPrice`, `deactivateProduct`
- Inventory: `restock`, `availability`
- Cart: `addToCart`, `setQuantity`, `removeFromCart`, `getCart`, `clearCart`
- Coupons: `createCoupon`, `applyCoupon`
- Orders: `checkout`, `getOrder`, `listOrders`, `cancelOrder`
- Reviews: `addReview`, `listReviews`, `averageRating`
- Gateways: `FakeGateway`, `StripeGateway`, `PaypalGateway`

## Note on persistence

State is in-memory for a single instance (the service is the seam for a
persistent adapter; sibling `@streetjs/*` packages show the store-interface +
Postgres pattern). A Postgres-backed adapter is a tracked follow-up.

## Testing

```bash
npm run test -w packages/commerce   # unit + property tests, fully offline
```

## License

MIT
