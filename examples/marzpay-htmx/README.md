# StreetJS — MarzPay HTMX Example

A server-rendered HTMX checkout built with StreetJS and the official
[`@streetjs/plugin-marzpay`](../../packages/plugin-marzpay) plugin. There is
**no single-page app and no client build step** — the backend returns plain HTML
fragments over HTTP that HTMX swaps into the page.

It mirrors the `street create my-app --frontend htmx` MarzPay overlay and
[the HTMX example doc](../../docs/integrations/marzpay/htmx-example.md).

MarzPay is invoked **only** through the plugin — there is no inline MarzPay HTTP
API call in this example. The plugin injects a `MarzPayClient` onto
`ctx.state.marzpay`, and the routes call `initializePayment` / `verifyPayment`
on that injected client.

Key behavior: when `initializePayment` throws **or** returns a non-success
result, the route returns a **failure fragment** and never a redirect fragment.

## Required environment variables

The app checks these at startup. If any is unset (or blank) the process exits
with a non-zero status and prints the name of the missing variable.

| Variable | Required | Description |
|----------|:--------:|-------------|
| `MARZPAY_API_KEY` | yes | MarzPay API key (Basic-auth user) |
| `MARZPAY_SECRET` | yes | MarzPay API secret (Basic-auth password) |
| `MARZPAY_ENVIRONMENT` | yes | `sandbox` or `production` |
| `PORT` | no | HTTP port (default `3003`) |

## Run

```bash
npm install
npm run build
MARZPAY_API_KEY=your-key \
MARZPAY_SECRET=your-secret \
MARZPAY_ENVIRONMENT=sandbox \
npm start
```

Then open <http://localhost:3003/> in a browser.

## Endpoints

- `GET /` — the checkout page (static HTML + the HTMX form).
- `POST /pay/checkout` — initialize a payment; returns a redirect fragment
  (card), a status fragment (mobile money), or a failure fragment.
- `GET /pay/status/:reference` — verify a payment; returns a status fragment.

```bash
# Card checkout (returns a redirect fragment on a verified init)
curl -s -X POST http://localhost:3003/pay/checkout \
     -H 'Content-Type: application/json' \
     -d '{"channel":"card"}'

# Mobile money checkout (returns a status fragment that polls /pay/status)
curl -s -X POST http://localhost:3003/pay/checkout \
     -H 'Content-Type: application/json' \
     -d '{"channel":"mobile","phone_number":"+256700000000"}'

curl -s http://localhost:3003/pay/status/<reference>
```
