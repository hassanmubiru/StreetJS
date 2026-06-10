# @streetjs/plugin-auth0

Official [Street Framework](https://hassanmubiru.github.io/street/) plugin for **Auth0 identity**.

It ships a `PluginModule` subclass that injects an Auth0 client into each request
via middleware. Request building (OAuth2 client-credentials token endpoint, JSON
body) is pure and offline-verifiable; the network send uses `node:https`. No
third-party runtime dependencies.

## Install

```bash
npm install @streetjs/plugin-auth0
```

## Usage

```ts
import { PluginHost, signManifest } from 'streetjs';
import { generateKeyPairSync } from 'node:crypto';
import Auth0Plugin, { auth0PluginManifest } from '@streetjs/plugin-auth0';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new Auth0Plugin({
  domain: process.env.AUTH0_DOMAIN,
  clientId: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  audience: 'https://api.example.com',
});

// Signature verification is enforced when the host has a public key.
host.register(plugin, signManifest(auth0PluginManifest(), privateKey));
await host.enable(plugin.name);

// Inside a handler, the client is available on ctx.state.auth0:
//   const status = await ctx.state.auth0.getToken();
```

## Manifest

- `manifest.json` — the unsigned plugin manifest (name, version, capabilities, permissions).
- `manifest.signed.json` — **produced by the build** (`npm run build`) via `signManifest()`
  (SHA-256 checksum + Ed25519 signature). Provide a stable signing key through the
  `STREET_PLUGIN_SIGNING_KEY` environment variable (PEM PKCS#8). Without it, the build
  generates an ephemeral dev keypair and writes the verifying public key to `manifest.pub`.

## Configuration

| Key            | Required | Description                                         |
| -------------- | -------- | --------------------------------------------------- |
| `domain`       | yes      | Auth0 tenant domain (protocol/trailing slash stripped). |
| `clientId`     | yes      | Auth0 application client id.                        |
| `clientSecret` | yes      | Auth0 application client secret.                    |
| `audience`     | no       | Default API audience for token requests.            |
| `stateKey`     | no       | `ctx.state` key for the client (default `auth0`).   |

## Example

A runnable example lives in [`example/`](./example).

## License

MIT
