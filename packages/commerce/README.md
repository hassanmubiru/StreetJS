<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/commerce

Official StreetJS Framework commerce module: products, inventory (with a strict
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

const shop = new CommerceService(); // in-memory store + FakeGateway by default

const widget = await shop.createProduct({ name: 'Widget', priceCents: 1500 });
await shop.restock(widget.id, 10);

await shop.addToCart('cart-1', widget.id, 2);
await shop.createCoupon({ code: 'SAVE10', kind: 'percent', value: 10 });

const order = await shop.checkout('cart-1', { couponCode: 'SAVE10' });
// order.subtotalCents 3000, discountCents 300, totalCents 2700, status 'paid'
await shop.availability(widget.id); // { onHand: 8, reserved: 0, available: 8 }
```

All methods are async. Persistence is a pluggable async `CommerceStore`.

## Postgres (atomic, concurrency-safe)

```ts
import { PgPool } from 'streetjs';
import { CommerceService, PgCommerceStore, COMMERCE_MIGRATION_SQL } from '@streetjs/commerce';

const pool = new PgPool({ /* … */ });
await pool.query(COMMERCE_MIGRATION_SQL);
const shop = new CommerceService({ store: new PgCommerceStore(pool) });
```

`PgCommerceStore.reserveStock` is a single atomic conditional `UPDATE`
(`SET reserved = reserved + n WHERE on_hand - reserved >= n`), so **concurrent
checkouts cannot oversell** — verified by a live-Postgres test that fires 12
simultaneous checkouts at 3 units of stock and asserts exactly 3 succeed.

## No-oversell guarantee

`checkout` reserves every line **all-or-nothing** before charging. If any line
lacks stock, `InsufficientStockError` is thrown *before* the gateway is touched.
If payment fails, the reservation is released. A property test (200 runs) plus
the live-PG concurrency test enforce: availability never negative, reservations
settle to zero, units sold never exceed units restocked.

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

State lives behind a pluggable async `CommerceStore`: `InMemoryCommerceStore`
(default) or `PgCommerceStore` (Postgres, via `COMMERCE_MIGRATION_SQL`). Carts
are transient/in-process; products, stock, coupons, orders, and reviews persist
through the store. The no-oversell guarantee depends on the store's atomic
`reserveStock`, not on cart storage.

## Testing

```bash
npm run test -w packages/commerce   # unit + property tests, fully offline
```

## License

MIT
