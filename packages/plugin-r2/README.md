<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-r2

Official [StreetJS Framework](https://hassanmubiru.github.io/StreetJS/) plugin for
**Cloudflare R2 object storage**.

It ships a `PluginModule` subclass that injects an R2 client into each request
via middleware. R2 is S3-compatible, so request signing reuses the framework's
verified AWS SigV4 signer (service `s3`, region `auto`). Signing is
deterministic and offline-verifiable; the network transport uses `node:https`.
No third-party runtime dependencies.

## Install

```bash
npm install @streetjs/plugin-r2
```

## Usage

```ts
import { PluginHost, signManifest } from 'streetjs';
import { generateKeyPairSync } from 'node:crypto';
import R2Plugin, { r2PluginManifest } from '@streetjs/plugin-r2';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new R2Plugin({
  accountId: process.env.R2_ACCOUNT_ID,
  bucket: process.env.R2_BUCKET,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
});

// Signature verification is enforced when the host has a public key.
host.register(plugin, signManifest(r2PluginManifest(), privateKey));
await host.enable(plugin.name);

// Inside a handler, the client is available on ctx.state.r2:
//   const headers = ctx.state.r2.signedObjectHeaders('GET', 'reports/q1.csv');
```

## Manifest

- `manifest.json` — the unsigned plugin manifest (name, version, capabilities, permissions).
- `manifest.signed.json` — **produced by the build** (`npm run build`) via `signManifest()`
  (SHA-256 checksum + Ed25519 signature). Provide a stable signing key through the
  `STREET_PLUGIN_SIGNING_KEY` environment variable (PEM PKCS#8). Without it, the build
  generates an ephemeral dev keypair and writes the verifying public key to `manifest.pub`.

## Configuration

| Key               | Required | Description                                       |
| ----------------- | -------- | ------------------------------------------------- |
| `accountId`       | yes      | Cloudflare account id (forms the R2 endpoint).    |
| `bucket`          | yes      | R2 bucket name.                                   |
| `accessKeyId`     | yes      | R2 access key id.                                 |
| `secretAccessKey` | yes      | R2 secret access key.                             |
| `stateKey`        | no       | `ctx.state` key for the client (default `r2`).    |

## Example

A runnable example lives in [`example/`](./example).

## License

MIT
