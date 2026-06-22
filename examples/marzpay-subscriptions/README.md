# StreetJS — MarzPay Subscriptions Example

A subscription-style billing app built with StreetJS and the official
[`@streetjs/plugin-marzpay`](../../packages/plugin-marzpay) plugin.

> **Verify-don't-invent:** MarzPay exposes **no** native recurring-billing or
> subscription API ([research artifact](../../docs/integrations/marzpay-research.md)).
> This example does not call an invented subscription endpoint. It **composes**
> a subscription from the one verified primitive — an operator-triggered
> "collect money" per billing cycle — through the plugin's `initializePayment`.
> Cycle scheduling lives in this app's `SubscriptionService`; every MarzPay call
> goes through the plugin (no inline MarzPay HTTP call).

Subscription plans are read from configuration (`billingConfig`), never
hardcoded into the request logic; an unknown plan id is rejected without
charging.

## Required environment variables

The app checks these at startup. If any is unset (or blank) the process exits
with a non-zero status and prints the name of the missing variable.

| Variable | Required | Description |
|----------|:--------:|-------------|
| `MARZPAY_API_KEY` | yes | MarzPay API key (Basic-auth user) |
| `MARZPAY_SECRET` | yes | MarzPay API secret (Basic-auth password) |
| `MARZPAY_ENVIRONMENT` | yes | `sandbox` or `production` |
| `PORT` | no | HTTP port (default `3001`) |

## Run

```bash
npm install
npm run build
MARZPAY_API_KEY=your-key \
MARZPAY_SECRET=your-secret \
MARZPAY_ENVIRONMENT=sandbox \
npm start
```

## Endpoints

- `POST /subscriptions` — create a subscription and charge the first cycle.
  Body: `{ "planId": "basic", "phoneNumber": "+256700000000" }`
- `POST /subscriptions/:id/charge` — operator-triggered cycle charge (what a
  scheduler invokes each interval).
- `GET /subscriptions/:id` — fetch a subscription record.
- `GET /subscriptions/:id/verify` — verify the latest cycle's payment.
- `DELETE /subscriptions/:id` — cancel a subscription.

```bash
curl -s -X POST http://localhost:3001/subscriptions \
     -H 'Content-Type: application/json' \
     -d '{"planId":"basic","phoneNumber":"+256700000000"}'
```

Configured plans: `basic`, `pro`.
