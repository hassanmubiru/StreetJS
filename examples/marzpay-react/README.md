# StreetJS — MarzPay React Example

A React (Vite) frontend that drives a MarzPay collection through a StreetJS
backend, using the official
[`@streetjs/plugin-marzpay`](../../packages/plugin-marzpay) plugin. It mirrors
the `street create my-app --frontend react` MarzPay overlay
(`web/src/lib/marzpay.ts` + billing pages) and
[the React example doc](../../docs/integrations/marzpay/react-example.md).

The browser holds **no** MarzPay credentials. MarzPay is invoked **only** through
the plugin on the backend (`src/main.ts`) — there is no inline MarzPay HTTP API
call anywhere in this example. The plugin injects a `MarzPayClient` onto
`ctx.state.marzpay`; the backend exposes a small JSON API
(`/api/marzpay/initialize`, `/api/marzpay/verify/:reference`,
`/api/marzpay/invoices`) that the React client lib calls.

The React client raises an error that **includes the returned HTTP status** on a
non-success response and never returns a payment result.

## Project layout

- `src/main.ts` — the StreetJS backend (runnable; env-guarded; plugin-only).
- `web/` — the React (Vite) frontend: `src/lib/marzpay.ts` plus `CheckoutPage`,
  `BillingPage`, `SubscriptionPage`, and `InvoicesPage`.

## Required environment variables

The backend checks these at startup. If any is unset (or blank) the process
exits with a non-zero status and prints the name of the missing variable.

| Variable | Required | Description |
|----------|:--------:|-------------|
| `MARZPAY_API_KEY` | yes | MarzPay API key (Basic-auth user) — backend only |
| `MARZPAY_SECRET` | yes | MarzPay API secret (Basic-auth password) — backend only |
| `MARZPAY_ENVIRONMENT` | yes | `sandbox` or `production` — backend only |
| `VITE_API_URL` | yes | Backend base URL the React app calls (e.g. `http://localhost:3000`) |
| `PORT` | no | Backend HTTP port (default `3000`) |

## Run

Start the backend (it runs the verified MarzPay operations):

```bash
npm install
npm run build
MARZPAY_API_KEY=your-key \
MARZPAY_SECRET=your-secret \
MARZPAY_ENVIRONMENT=sandbox \
VITE_API_URL=http://localhost:3000 \
npm start
```

In a second terminal, start the React frontend (Vite, port 5173 by default):

```bash
cd web
npm install
VITE_API_URL=http://localhost:3000 npm run dev
```

Then open the Vite dev URL printed in the terminal.

## Endpoints (backend)

- `POST /api/marzpay/initialize` — initialize a payment.
  Body: `{ "amount": 10000, "method": "card", "currency": "UGX", "country": "UG" }`
- `GET /api/marzpay/verify/:reference` — verify a payment by reference.
- `GET /api/marzpay/invoices` — invoice history (empty by default).

```bash
curl -s -X POST http://localhost:3000/api/marzpay/initialize \
     -H 'Content-Type: application/json' \
     -d '{"amount":10000,"method":"card","currency":"UGX","country":"UG"}'

curl -s http://localhost:3000/api/marzpay/verify/<reference>
```
