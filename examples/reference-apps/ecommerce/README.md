# Ecommerce — StreetJS reference application

A storefront backend built on `@streetjs/commerce`:

- `CommerceService` — catalog, inventory with **no oversell**, carts, coupons
- Checkout through a pluggable gateway (`FakeGateway` by default; swap for a real
  payment plugin such as `@streetjs/plugin-stripe` or `@streetjs/plugin-marzpay`)
- Cancel/refund/restock flow + HTTP health endpoints

This is a *reference app*: a runnable, tested starting point you adapt — not an
npm package.

## Run

```bash
# from the repo root (resolves the local `streetjs` build)
npm run build -w packages/core
node examples/reference-apps/ecommerce/server.mjs        # starts on :3000
```

HTTP endpoints:

- `GET /health/live`, `GET /health/ready` — liveness/readiness
- `GET /products` — active catalog
- `POST /checkout` — body `{ "cartId": "...", "couponCode": "..." }` → order

The exported `createStore({ gateway })` factory returns `{ shop, gateway, http,
listen, close }`, so you can drive the full domain (reserve → charge → commit,
coupons, refunds) directly in code/tests.

## Verification (executed)

```bash
node examples/reference-apps/ecommerce/smoke-test.mjs    # checks pass, exit non-zero on failure
```

Smoke covers checkout + coupon, **no-oversell** under concurrent reservation, and
cancel/refund/restock. Covered by CI in `.github/workflows/reference-apps.yml`;
checkout throughput is MEASURED in `scripts/benchmark-reference-apps.mjs`
(relative, in-memory single-instance).

## Security configuration

- Known domain errors map to safe, fixed client messages (`insufficient stock`,
  `payment failed`); raw exception text/stack is logged server-side only.
- Use a real gateway (Stripe/MarzPay plugin) and verify webhooks server-side
  before treating an order as paid.
- In production set `ALLOWED_ORIGINS`, `JWT_SECRET`, `SESSION_KEY`, `KEK`, `PG_*`.

## Deployment

Reuses the repo's deployment artifacts (`deploy/`): Docker image, Kubernetes
(`deploy/helm/street`), or Cloud Run (`deploy/cloud-run/service.yaml`). Probes hit
`/health/live` and `/health/ready`. Validate with `scripts/deploy/smoke-test.sh`.

## Scaling notes

Persist catalog/inventory/orders in PostgreSQL (repository pattern) and run
inventory reservation inside a transaction so the no-oversell guarantee holds
across instances. Front with the core `RateLimiter`.
