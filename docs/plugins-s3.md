# Official Plugin: AWS S3

`S3Plugin` is the first official reference plugin for the Street
[plugin system](./plugins.md). It provides AWS S3 object storage, built on the
framework's existing AWS SigV4 signer and `S3StorageAdapter` — no AWS SDK, no
third-party dependencies.

It demonstrates the full plugin contract: a signed manifest, capability
metadata, an explicit permission declaration, a validated configuration schema,
lifecycle hooks, and sandbox middleware integration.

## Manifest

```ts
import { s3PluginManifest } from '@streetjs/core';

s3PluginManifest();
// {
//   name: 'street-plugin-s3',
//   version: '1.0.0',
//   capabilities: ['storage', 'object-storage', 's3'],
//   permissions: ['net', 'secrets', 'middleware'],
// }
```

## Configuration schema

```ts
interface S3PluginConfig {
  bucket: string;            // required
  region: string;            // required
  accessKeyId: string;       // required
  secretAccessKey: string;   // required
  prefix?: string;           // optional key prefix
  stateKey?: string;         // ctx.state key for the injected adapter (default 's3')
}
```

`validateS3Config(input)` enforces the schema and throws `PluginError` with a
precise message on the first violation.

## Install through the PluginHost (signed)

```ts
import { generateKeyPairSync } from 'node:crypto';
import { PluginHost, signManifest, S3Plugin, s3PluginManifest } from '@streetjs/core';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey, // host now requires a valid signature to register
});

const manifest = signManifest(s3PluginManifest(), privateKey);
host.register(new S3Plugin({
  bucket: 'my-bucket',
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  prefix: 'tenants/acme',
}), manifest);

await host.enable('street-plugin-s3');
```

## Using it in request handling

On load the plugin registers a middleware that injects an `S3StorageAdapter`
into `ctx.state[stateKey]` (default `s3`). Mount the plugin's middleware in your
pipeline and use it from any handler:

```ts
for (const mw of host.middlewaresOf('street-plugin-s3')) app.use(mw);

// in a handler:
const s3 = ctx.state['s3']; // S3StorageAdapter
await s3.write('reports/2025.csv', stream);
const data = await s3.read('reports/2025.csv');
```

## Lifecycle

| Hook | Behaviour |
| --- | --- |
| `onInstall` | Validates configuration once (fails enable on bad config). |
| `onLoad` | Builds the `S3StorageAdapter` and registers the injector middleware. |
| `onUnload` | Releases the adapter (`plugin.storage` then throws until reloaded). |

## Offline-verifiable signing

`signedObjectHeaders(method, key, payloadHash, now?)` returns deterministic AWS
SigV4 headers for an object request, enabling signing verification without any
network call:

```ts
const headers = plugin.signedObjectHeaders('GET', 'reports/2025.csv', emptyHash, fixedDate);
// headers.authorization === 'AWS4-HMAC-SHA256 Credential=…/20250101/us-east-1/s3/aws4_request, …, Signature=<64 hex>'
```

## Verification

`packages/core/src/tests/plugin-s3.test.ts` covers config-schema validation,
signed-manifest registration + tamper rejection through `PluginHost`, permission
gating, lifecycle + sandbox injection, config validation at install, and
deterministic SigV4 signing (stability, key-sensitivity, prefix handling).

```bash
cd packages/core
npx tsc
node --test dist/src/tests/plugin-s3.test.js
```
