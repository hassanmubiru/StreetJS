<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-sendgrid

Official [StreetJS Framework](https://hassanmubiru.github.io/StreetJS/) plugin for **SendGrid email**.

It ships a `PluginModule` subclass that injects a SendGrid mail client into each
request via middleware. Request building (endpoint, bearer auth, JSON body) is pure
and offline-verifiable; the network send uses `node:https`. No third-party runtime
dependencies.

## Install

```bash
npm install @streetjs/plugin-sendgrid
```

## Usage

```ts
import { PluginHost, signManifest } from 'streetjs';
import { generateKeyPairSync } from 'node:crypto';
import SendGridPlugin, { sendGridPluginManifest } from '@streetjs/plugin-sendgrid';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new SendGridPlugin({
  apiKey: process.env.SENDGRID_API_KEY,
  defaultFrom: 'no-reply@example.com',
});

// Signature verification is enforced when the host has a public key.
host.register(plugin, signManifest(sendGridPluginManifest(), privateKey));
await host.enable(plugin.name);

// Inside a handler, the client is available on ctx.state.mail:
//   await ctx.state.mail.send({ to: 'a@b.com', subject: 'Hi', text: 'Hello' });
```

## Manifest

- `manifest.json` — the unsigned plugin manifest (name, version, capabilities, permissions).
- `manifest.signed.json` — **produced by the build** (`npm run build`) via `signManifest()`
  (SHA-256 checksum + Ed25519 signature). Provide a stable signing key through the
  `STREET_PLUGIN_SIGNING_KEY` environment variable (PEM PKCS#8). Without it, the build
  generates an ephemeral dev keypair and writes the verifying public key to `manifest.pub`.

## Configuration

| Key           | Required | Description                                       |
| ------------- | -------- | ------------------------------------------------- |
| `apiKey`      | yes      | SendGrid API key.                                 |
| `defaultFrom` | no       | Default sender address when a message omits `from`. |
| `stateKey`    | no       | `ctx.state` key for the client (default `mail`).  |

## Example

A runnable example lives in [`example/`](./example).

## License

MIT
