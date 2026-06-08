# Local Plugin Registry

`LocalPluginRegistry` turns the Street [plugin system](./plugins.md) into a
plugin *ecosystem*: a dependency-free, in-process registry that stores signed
plugin manifests, verifies their signatures, supports discovery, and installs
plugins directly into a `PluginHost`. No marketplace UI, no network, no external
services.

Exported from `@streetjs/core`.

## What it stores

Each published record holds the **signed manifest** (with its `checksum` and
`signature`), the **publisher public key** (PEM/SPKI), arbitrary **metadata**,
and a `publishedAt` timestamp.

```ts
interface RegistryRecord {
  manifest: PluginManifest; // includes checksum + signature
  publicKey: string;        // PEM (SPKI)
  metadata: Record<string, unknown>;
  publishedAt: string;
}
```

## API

| Method | Behaviour |
| --- | --- |
| `publish(manifest, publicKeyPem, metadata?)` | Verifies integrity + Ed25519 signature against the key; rejects unsigned/tampered/wrong-key/duplicate. |
| `fetch(name, version)` | Returns the record, re-verifying the signature. Throws if missing/invalid. |
| `list()` | All published ids (`name@version`). |
| `search(capability)` | Records exposing a capability tag. |
| `verify(name, version)` | Re-verify a stored plugin's signature. |
| `toJSON()` / `LocalPluginRegistry.fromJSON()` | Persistence round-trip; `fromJSON` rejects tampered records. |

## Publish & install end-to-end

```ts
import { generateKeyPairSync } from 'node:crypto';
import {
  LocalPluginRegistry, installFromRegistry, PluginHost,
  signManifest, S3Plugin, s3PluginManifest,
} from '@streetjs/core';

// Publisher signs the manifest with their Ed25519 key.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const registry = new LocalPluginRegistry();
registry.publish(signManifest(s3PluginManifest(), privateKey), publicPem, { author: 'street' });

// Discovery
registry.list();                  // ['street-plugin-s3@1.0.0']
registry.search('object-storage'); // [ RegistryRecord ]

// Install through the registry into a host (fetch → verify → register → enable).
const host = new PluginHost({ grantedPermissions: ['net', 'secrets', 'middleware'] });
await installFromRegistry(registry, host, new S3Plugin({
  bucket: 'b', region: 'us-east-1', accessKeyId: '…', secretAccessKey: '…',
}));
host.state('street-plugin-s3'); // 'enabled'
```

## Security model

- **Publish-time verification:** a manifest must be signed; its checksum must
  match its canonical body and the Ed25519 signature must verify against the
  supplied public key. Unsigned, tampered, wrong-key, and invalid-key
  publications are rejected.
- **Fetch/load-time re-verification:** `fetch()` and `installFromRegistry()`
  re-verify the stored signature before handing the manifest to the host.
- **Persistence integrity:** `fromJSON()` re-verifies every record and refuses
  to load a tampered registry snapshot.

## Verification

`packages/core/src/tests/plugin-registry.test.ts` covers publish/fetch/list/
search/verify, signed publication, unsigned/tampered/wrong-key/invalid-key
rejection, duplicate rejection, JSON round-trip with a tamper guard, and an
end-to-end publish→install→enable through a `PluginHost`.

```bash
cd packages/core
npx tsc
node --test dist/src/tests/plugin-registry.test.js
```
