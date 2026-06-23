# StreetJS — MarzPay Next.js Example

A Next.js (App Router) frontend that drives a MarzPay collection through a
StreetJS backend, using the official
[`@streetjs/plugin-marzpay`](../../packages/plugin-marzpay) plugin. It mirrors
the `street create my-app --frontend next` MarzPay overlay
(`web/app/lib/marzpay.ts` + App Router routes) and
[the Next example doc](../../docs/integrations/marzpay/next-example.md).

MarzPay credentials and the `MarzPayClient` live **only** on the server. MarzPay
is invoked **only** through the plugin — there is no inline MarzPay HTTP API call
anywhere in this example:

- The browser-facing pages call typed client helpers that hit the StreetJS
  backend (`src/main.ts`), which uses the plugin-injected `MarzPayClient`.
- The server-side webhook route (`web/app/api/webhooks/marzpay/route.ts`) uses
  the plugin's exported `MarzPayClient` directly on the Node.js runtime; it calls
  `validateWebhook` on the raw body **before** any processing and re-verifies
  server-side via `getTransaction`.

The client helpers raise an error that **includes the returned HTTP status** on a
non-success response and never return a payment result.

## Project layout

- `src/main.ts` — the StreetJS backend (runnable; env-guarded; plugin-only).
- `web/` — the Next.js App Router frontend: `app/lib/marzpay.ts`,
  `app/billing/page.tsx`, `app/billing/success/page.tsx`,
  `app/billing/cancel/page.tsx`, and `app/api/webhooks/marzpay/route.ts`.

## Required environment variables

The backend checks these at startup. If any is unset (or blank) the process
exits with a non-zero status and prints the name of the missing variable.

| Variable | Required | Description |
|----------|:--------:|-------------|
| `MARZPAY_API_KEY` | yes | MarzPay API key (Basic-auth user) — backend + webhook route |
| `MARZPAY_SECRET` | yes | MarzPay API secret (Basic-auth password) — backend + webhook route |
| `MARZPAY_ENVIRONMENT` | yes | `sandbox` or `production` — backend + webhook route |
| `NEXT_PUBLIC_API_URL` | yes | StreetJS backend base URL the Next app calls (e.g. `http://localhost:3000`) |
| `PORT` | no | Backend HTTP port (default `3000`) |

> The Next.js server-side webhook route also reads `MARZPAY_API_KEY`,
> `MARZPAY_SECRET`, and `MARZPAY_ENVIRONMENT` from its own environment.

## Run

Start the backend (it runs the verified MarzPay operations):

```bash
npm install
npm run build
MARZPAY_API_KEY=your-key \
MARZPAY_SECRET=your-secret \
MARZPAY_ENVIRONMENT=sandbox \
NEXT_PUBLIC_API_URL=http://localhost:3000 \
npm start
```

In a second terminal, start the Next.js frontend (port 3001):

```bash
cd web
npm install
MARZPAY_API_KEY=your-key \
MARZPAY_SECRET=your-secret \
MARZPAY_ENVIRONMENT=sandbox \
NEXT_PUBLIC_API_URL=http://localhost:3000 \
npm run dev
```

Then open <http://localhost:3001/billing>.

## Endpoints (backend)

- `POST /api/marzpay/initialize` — initialize a payment.
  Body: `{ "amount": 10000, "method": "card", "currency": "UGX", "country": "UG" }`
- `GET /api/marzpay/verify/:reference` — verify a payment by reference.
- `GET /api/marzpay/subscription` — active subscription (`404` => none).
- `GET /api/marzpay/invoices` — invoice history (empty by default).

```bash
curl -s -X POST http://localhost:3000/api/marzpay/initialize \
     -H 'Content-Type: application/json' \
     -d '{"amount":10000,"method":"card","currency":"UGX","country":"UG"}'

curl -s http://localhost:3000/api/marzpay/verify/<reference>
```
