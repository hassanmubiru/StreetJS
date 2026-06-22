# StreetJS — MarzPay Checkout Example

A minimal one-off payment (checkout) app built with StreetJS and the official
[`@streetjs/plugin-marzpay`](../../packages/plugin-marzpay) plugin.

MarzPay is invoked **only** through the plugin — there is no inline MarzPay HTTP
API call in this example. The plugin injects a `MarzPayClient` onto
`ctx.state.marzpay`, and the routes call `initializePayment` / `verifyPayment`
on that client.

## Required environment variables

The app checks these at startup. If any is unset (or blank) the process exits
with a non-zero status and prints the name of the missing variable.

| Variable | Required | Description |
|----------|:--------:|-------------|
| `MARZPAY_API_KEY` | yes | MarzPay API key (Basic-auth user) |
| `MARZPAY_SECRET` | yes | MarzPay API secret (Basic-auth password) |
| `MARZPAY_ENVIRONMENT` | yes | `sandbox` or `production` |
| `PORT` | no | HTTP port (default `3000`) |

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

- `POST /checkout` — initialize a payment.
  Body: `{ "amount": 5000, "phoneNumber": "+256700000000" }` (mobile money) or
  `{ "amount": 5000, "method": "card" }` (card → returns a redirect URL).
- `GET /checkout/:reference` — verify a payment by its reference.

```bash
curl -s -X POST http://localhost:3000/checkout \
     -H 'Content-Type: application/json' \
     -d '{"amount":5000,"phoneNumber":"+256700000000"}'

curl -s http://localhost:3000/checkout/<reference>
```
