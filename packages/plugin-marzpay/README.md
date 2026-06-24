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

## Security

- **Permissions:** `net`, `secrets`, `middleware`. Ed25519-signed manifest verified on install.
- Credentials are sent only as a Basic-auth header to MarzPay over HTTPS.
- No third-party runtime dependencies.

## License

MIT
