# @streetjs/plugin-paypal

Official StreetJS plugin: **PayPal** Orders v2.

Dependency-free — request construction (OAuth2 client-credentials token + JSON
order creation) is pure and offline-verifiable; the network send uses
`node:https`. Mirrors the official Stripe plugin's design.

## Install

```bash
npm install @streetjs/plugin-paypal
# or: street add paypal
```

## Configuration

```ts
import { PayPalPlugin } from '@streetjs/plugin-paypal';

const plugin = new PayPalPlugin({
  clientId: process.env.PAYPAL_CLIENT_ID,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET,
  environment: 'sandbox',  // or 'live' (default 'sandbox')
  stateKey: 'paypal',
});
```

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| `clientId` / `clientSecret` | string | yes | REST app credentials |
| `environment` | `'sandbox'` \| `'live'` | no | default `sandbox` |
| `stateKey` | string | no | request-state key (default `paypal`) |

## Usage

```ts
import type { StreetContext } from 'streetjs';
import type { PayPalClient } from '@streetjs/plugin-paypal';

// inside a handler:
const paypal = ctx.state['paypal'] as PayPalClient;
const order = await paypal.createOrder({ amount: '20.00', currency: 'USD' });
```

The request builders (`buildTokenRequest`, `buildCreateOrderRequest`) are exported
as testable seams — amount and ISO-4217 currency are validated before the wire.

## Security

- **Permissions:** `net`, `secrets`, `middleware`. Ed25519-signed manifest verified on install.
- Credentials are sent only as a Basic-auth header to PayPal's OAuth2 endpoint.
- No third-party runtime dependencies.

## License

MIT
