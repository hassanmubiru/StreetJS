<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-s3

Official [StreetJS Framework](https://hassanmubiru.github.io/StreetJS/) plugin for
**AWS S3 object storage**.

It ships a `PluginModule` subclass that injects an S3 storage adapter into each
request via middleware. AWS SigV4 request signing is deterministic and
offline-verifiable; the network transport uses the framework's built-in S3
adapter (`node:https`). No third-party runtime dependencies.

## Install

```bash
npm install @streetjs/plugin-s3
```

## Usage

```ts
import { PluginHost, signManifest } from 'streetjs';
import { generateKeyPairSync } from 'node:crypto';
import S3Plugin, { s3PluginManifest } from '@streetjs/plugin-s3';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new S3Plugin({
  bucket: process.env.S3_BUCKET,
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// Signature verification is enforced when the host has a public key.
host.register(plugin, signManifest(s3PluginManifest(), privateKey));
await host.enable(plugin.name);

// Inside a handler, the adapter is available on ctx.state.s3:
//   await ctx.state.s3.put('reports/q1.csv', body);
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
| `bucket`          | yes      | S3 bucket name.                                   |
| `region`          | yes      | AWS region (e.g. `us-east-1`).                    |
| `accessKeyId`     | yes      | AWS access key id.                                |
| `secretAccessKey` | yes      | AWS secret access key.                            |
| `prefix`          | no       | Key prefix within the bucket.                     |
| `stateKey`        | no       | `ctx.state` key for the adapter (default `s3`).   |

## Example

A runnable example lives in [`example/`](./example).

## License

MIT
