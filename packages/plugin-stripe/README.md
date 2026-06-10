# @streetjs/plugin-stripe

Official [Street Framework](https://hassanmubiru.github.io/street/) plugin for **Stripe payments**.

It ships a `PluginModule` subclass that injects a Stripe client into each request
via middleware. Request building (bearer auth + form-encoded body) is pure and
offline-verifiable; the network send uses `node:https`. No third-party runtime
dependencies.

## Install

```bash
npm install @streetjs/plugin-stripe
```

## Usage

```ts
import { PluginHost, signManifest } from 'streetjs';
import { generateKeyPairSync } from 'node:crypto';
import StripePlugin, { stripePluginManifest } from '@streetjs/plugin-stripe';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new StripePlugin({ apiKey: process.env.STRIPE_API_KEY });

// Signature verification is enforced when the host has a public key.
host.register(plugin, signManifest(stripePluginManifest(), privateKey));
await host.enable(plugin.name);

// Inside a handler, the client is available on ctx.state.stripe:
//   await ctx.state.stripe.post('payment_intents', { amount: 1999, currency: 'usd' });
```

## Manifest

- `manifest.json` — the unsigned plugin manifest (name, version, capabilities, permissions).
- `manifest.signed.json` — **produced by the build** (`npm run build`) via `signManifest()`
  (SHA-256 checksum + Ed25519 signature). Provide a stable signing key through the
  `STREET_PLUGIN_SIGNING_KEY` environment variable (PEM PKCS#8). Without it, the build
  generates an ephemeral dev keypair and writes the verifying public key to `manifest.pub`.

## Configuration

| Key        | Required | Description                                         |
| ---------- | -------- | --------------------------------------------------- |
| `apiKey`   | yes      | Stripe secret API key.                              |
| `stateKey` | no       | `ctx.state` key for the client (default `stripe`).  |

## Example

A runnable example lives in [`example/`](./example).

## License

MIT
