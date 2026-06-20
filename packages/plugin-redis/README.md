<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-redis

Official [StreetJS Framework](https://hassanmubiru.github.io/StreetJS/) plugin for a
**Redis cache / key-value store**.

It ships a `PluginModule` subclass that connects a Redis client on load and
injects it into each request via middleware. The client is a **dependency-free
RESP2 implementation** built on `node:net` — no vendor SDK is required. RESP
command encoding and reply parsing are pure and offline-verifiable; only the
socket transport touches the network.

## Install

```bash
npm install @streetjs/plugin-redis
```

## Usage

```ts
import { PluginHost, signManifest } from 'streetjs';
import { generateKeyPairSync } from 'node:crypto';
import { RedisPlugin, redisPluginManifest } from '@streetjs/plugin-redis';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new RedisPlugin({ host: '127.0.0.1', port: 6379 });

// Signature verification is enforced when the host has a public key.
host.register(plugin, signManifest(redisPluginManifest(), privateKey));
await host.enable(plugin.name);

// Inside a handler, the client is available on ctx.state.redis:
//   await ctx.state.redis.set('greeting', 'hello', 60);
//   const value = await ctx.state.redis.get('greeting');
```

## Manifest

- `manifest.json` — the unsigned plugin manifest (name, version, capabilities, permissions).
- `manifest.signed.json` — **produced by the build** (`npm run build`) via `signManifest()`
  (SHA-256 checksum + Ed25519 signature). Provide a stable signing key through the
  `STREET_PLUGIN_SIGNING_KEY` environment variable (PEM PKCS#8). Without it, the build
  generates an ephemeral dev keypair and writes the verifying public key to `manifest.pub`.

## Configuration

| Key         | Required | Description                                            |
| ----------- | -------- | ------------------------------------------------------ |
| `host`      | yes      | Redis server hostname.                                 |
| `port`      | yes      | Redis server port (1–65535).                           |
| `password`  | no       | AUTH password.                                         |
| `db`        | no       | Logical DB index to `SELECT` after connecting (default 0). |
| `timeoutMs` | no       | Connect/command timeout in ms (default 5000).          |
| `stateKey`  | no       | `ctx.state` key for the client (default `redis`).      |

## Example

A runnable example lives in [`example/`](./example).

## License

MIT
