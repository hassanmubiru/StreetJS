<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-marzpay

> MarzPay for StreetJS applications — payments, billing, webhooks, and verification, without the complexity of a full payment SDK.

Official StreetJS plugin: **MarzPay** payments.

Dependency-free — request construction is pure and offline-verifiable; the
network send uses `node:https`. Mirrors the official PayPal/Stripe plugins'
design.

Every implemented behavior traces to a `Verified_Capability` recorded in the
[MarzPay research artifact](../../docs/integrations/marzpay-research.md)
(verify-don't-invent). Undocumented MarzPay topics (refunds, customer
subscriptions, recurring billing, webhook signature scheme) are recorded there
as limitations and are not implemented from assumption.

## Install

```bash
npm install @streetjs/plugin-marzpay
# or: street add marzpay
```

## Configuration

```ts
import { MarzPayPlugin } from '@streetjs/plugin-marzpay';

const plugin = MarzPayPlugin({
  apiKey: process.env.MARZPAY_API_KEY,
  secretKey: process.env.MARZPAY_SECRET,
  environment: 'sandbox', // or 'production' (default 'sandbox')
  stateKey: 'marzpay',
});
```

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| `apiKey` / `secretKey` | string | yes | MarzPay API credentials (Basic auth) |
| `environment` | `'sandbox'` \| `'production'` | no | default `sandbox` |
| `stateKey` | string | no | request-state key (default `marzpay`) |
| `timeoutMs` | number | no | request timeout, default `30000` |

> **Status:** package skeleton. Configuration, the request builders, the
> `MarzPayClient`, and the `MarzPayPlugin` lifecycle are implemented in
> subsequent spec tasks.

## Capability namespaces

The client injected into application state (default `ctx.state.marzpay`) exposes
six capability-oriented namespaces. Each implemented operation traces to a
`Verified_Capability` in the research artifact; operations whose MarzPay endpoint
is not yet documented surface an explicit unsupported-operation error and issue
**no** network request (verify-don't-invent).

| Namespace | Operations | Status |
|-----------|------------|--------|
| `collections` | `collectMoney(request)`, `getStatus(reference)` | Verified — `POST /collect-money`, `GET /transactions/{reference}` |
| `disbursements` | `sendMoney(request)`, `getStatus(reference)` | `getStatus` verified (`GET /transactions/{reference}`); `sendMoney` unverified |
| `transactions` | `get(reference)` | Verified — `GET /transactions/{id}` |
| `accounts` | `getBalance()` | Unverified |
| `phoneVerification` | `verify(request)`, `isVerified(request)`, `getUserInfo(request)` | Unverified |
| `utils` | `formatPhoneNumber(value)`, `isValidPhoneNumber(value)` | Local (no network) |

### `collections`

```ts
const result = await marzpay.collections.collectMoney({
  amount: 5000,
  country: 'UG',
  reference: 'order-123',
  phone_number: '+256700000000', // or method: 'card'
});
// → { reference, status, redirectUrl? }  (redirectUrl for card flows)

const status = await marzpay.collections.getStatus('order-123');
// → { reference, status }
```

Argument guards run before any send: a missing/empty `amount`, `country`,
`reference`, or payment channel throws a `PluginError` naming the offending field
and issues no network request. A `reference` that is empty, whitespace-only, or
longer than 256 characters (after trimming) is rejected the same way. Non-2xx
responses throw an error that includes the returned HTTP status.

### `transactions`

```ts
const tx = await marzpay.transactions.get('order-123');
// → { id, reference, amount, currency, status }
```

Backed by the verified `GET /transactions/{id}` endpoint with the same reference
guard and non-2xx-includes-status mapping as `collections`.

### `disbursements`

```ts
const status = await marzpay.disbursements.getStatus('payout-7'); // verified
await marzpay.disbursements.sendMoney({ /* ... */ });             // unsupported (see below)
```

`getStatus(reference)` is fully functional — it reads the verified transactions
endpoint. `sendMoney(request)` validates its required fields first, then surfaces
an `UnsupportedOperationError`: no send-money endpoint is recorded as a
`Verified_Capability` in the research artifact, so the seam stays unbound and no
network request is issued.

### `accounts`

```ts
await marzpay.accounts.getBalance(); // throws UnsupportedOperationError
```

`getBalance()` surfaces an `UnsupportedOperationError` and issues no network
request. The research artifact mentions a Balance API only incidentally and
records no concrete balance endpoint, so the seam is left unbound.

### `phoneVerification`

```ts
await marzpay.phoneVerification.verify({ phone_number: '+256700000000' });     // unsupported
await marzpay.phoneVerification.isVerified({ phone_number: '+256700000000' }); // unsupported
await marzpay.phoneVerification.getUserInfo({ phone_number: '+256700000000' });// unsupported
```

Each operation validates its required fields first, then surfaces an
`UnsupportedOperationError`. No phone-verification endpoint is recorded as a
`Verified_Capability`, so all three seams stay unbound and issue no network
request.

> **Note on unverified operations** (`disbursements.sendMoney`,
> `accounts.getBalance`, `phoneVerification.*`): these are intentionally
> unbound until MarzPay documents the corresponding endpoints. Binding them
> requires first recording an audited `Verified_Capability` entry (with a
> citation) in the [research artifact](../../docs/integrations/marzpay-research.md).
> Until then they fail fast with `UnsupportedOperationError` and never touch the
> network.

### `utils`

```ts
marzpay.utils.isValidPhoneNumber('0700000000'); // → true / false
marzpay.utils.formatPhoneNumber('0700000000');  // → '+256700000000' (throws PluginError when invalid)
```

`utils` exposes only these two helpers. Both delegate to the same single internal
normalizer, so `formatPhoneNumber` output is always accepted by
`isValidPhoneNumber` (round-trip consistency). These are local, offline helpers —
they issue no network request.

### Flat compatibility methods

For backward compatibility, the flat `MarzPayClient` methods are retained as thin
aliases over the same code paths used by the namespaces, with no behavioral
change:

- `initializePayment(request)` ≡ `collections.collectMoney(request)`
- `verifyPayment(reference)` ≡ `collections.getStatus(reference)`
- `getTransaction(id)` ≡ `transactions.get(id)`
- `listTransactions(...)` — retained as a flat method
- `refund(...)` — unsupported (refunds are a recorded limitation; no endpoint is documented)
- `validateWebhook(rawBody, signature)` — unchanged

## Security

- **Permissions:** `net`, `secrets`, `middleware`. Ed25519-signed manifest verified on install.
- Credentials are sent only as a Basic-auth header to MarzPay over HTTPS.
- No third-party runtime dependencies.

## License

MIT
