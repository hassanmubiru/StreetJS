<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-twilio

Official [StreetJS Framework](https://hassanmubiru.github.io/StreetJS/) plugin for **Twilio SMS**.

It ships a `PluginModule` subclass that injects a Twilio client into each request
via middleware. Request building (HTTP Basic auth + form-encoded body) is pure and
offline-verifiable; the network send uses `node:https`. No third-party runtime
dependencies.

## Install

```bash
npm install @streetjs/plugin-twilio
```

## Usage

```ts
import { PluginHost, signManifest } from 'streetjs';
import { generateKeyPairSync } from 'node:crypto';
import TwilioPlugin, { twilioPluginManifest } from '@streetjs/plugin-twilio';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new TwilioPlugin({
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  defaultFrom: '+15555550100',
});

// Signature verification is enforced when the host has a public key.
host.register(plugin, signManifest(twilioPluginManifest(), privateKey));
await host.enable(plugin.name);

// Inside a handler, the client is available on ctx.state.sms:
//   await ctx.state.sms.send({ to: '+15555550111', body: 'hello' });
```

## Manifest

- `manifest.json` — the unsigned plugin manifest (name, version, capabilities, permissions).
- `manifest.signed.json` — **produced by the build** (`npm run build`) via `signManifest()`
  (SHA-256 checksum + Ed25519 signature). Provide a stable signing key through the
  `STREET_PLUGIN_SIGNING_KEY` environment variable (PEM PKCS#8). Without it, the build
  generates an ephemeral dev keypair and writes the verifying public key to `manifest.pub`.

## Configuration

| Key           | Required | Description                                  |
| ------------- | -------- | -------------------------------------------- |
| `accountSid`  | yes      | Twilio Account SID.                          |
| `authToken`   | yes      | Twilio Auth Token.                           |
| `defaultFrom` | no       | Default sender number when a message omits `from`. |
| `stateKey`    | no       | `ctx.state` key for the client (default `sms`). |

## Example

A runnable example lives in [`example/`](./example).

## License

MIT
