# Plugin System

Street ships a formal, dependency-free plugin system built on `node:crypto`. It
covers the full in-process lifecycle of a plugin — registration, signature and
integrity verification, capability/permission metadata, dependency and version
resolution, lifecycle orchestration, and discovery. The network install flow
(fetch + extract from a registry) lives separately in `PluginInstaller`.

All symbols are exported from `streetjs`.

## Concepts

A plugin is a subclass of `PluginModule` with `name`, `version`, and optional
`onInstall` / `onLoad` / `onUnload` hooks. A `PluginManifest` describes its
capabilities, requested permissions, and dependencies:

```ts
interface PluginManifest {
  name: string;
  version: string;
  capabilities?: string[];                 // discovery tags, e.g. ['payments']
  permissions?: PluginPermission[];        // 'middleware'|'events'|'net'|'fs'|'db'|'secrets'
  dependencies?: Record<string, string>;   // name → semver range
  checksum?: string;                       // SHA-256 of canonical body
  signature?: string;                      // base64 Ed25519 over checksum
}
```

## Signing & verifying manifests

Manifests are signed with an Ed25519 key. Integrity is a SHA-256 over a
deterministic, key-sorted body; authenticity is an Ed25519 signature over that
checksum. Verification is offline and constant against tampering.

```ts
import { generateKeyPairSync } from 'node:crypto';
import { signManifest, verifyManifest } from 'streetjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const signed = signManifest({ name: 'pay', version: '1.0.0', capabilities: ['payments'] }, privateKey);

verifyManifest(signed, publicKey); // true
verifyManifest({ ...signed, capabilities: ['payments', 'evil'] }, publicKey); // false (tampered)
```

## Hosting plugins

`PluginHost` grants a set of permissions and (optionally) a public key. When a
public key is configured, registration requires a valid signature.

```ts
import { PluginHost, PluginModule } from 'streetjs';

class StripePlugin extends PluginModule {
  readonly name = 'stripe';
  readonly version = '1.0.0';
  async onLoad(app) { app.use(async (ctx, next) => { /* ... */ await next(); }); }
}

const host = new PluginHost({ grantedPermissions: ['middleware', 'net'], publicKey });
host.register(new StripePlugin(), signedManifest);
await host.enable('stripe');
```

### Permissions

A plugin can only load if every permission in its manifest is granted by the
host. The sandbox passed to `onLoad` is gated too: calling `app.use(...)`
without the `middleware` permission, or `app.on(...)` without `events`, throws
`PluginPermissionError`. Pass `grantedPermissions: '*'` to grant all.

### Dependencies & versions

`enable(name)` resolves dependencies first, in dependency order, validating that
each is registered and its version satisfies the declared range. Supported
ranges: exact (`1.2.3`), caret (`^1.2.3`), tilde (`~1.2.3`), comparators
(`>=`, `>`, `<=`, `<`), and any (`*`). Missing dependencies, version conflicts,
and dependency cycles raise `PluginDependencyError`.

```ts
host.register(new Base(), { name: 'base', version: '1.2.0' });
host.register(new Feature(), { name: 'feature', version: '1.0.0', dependencies: { base: '^1.0.0' } });
await host.enable('feature'); // enables base first, then feature
```

### Lifecycle

| Method | Behaviour |
| --- | --- |
| `register(plugin, manifest)` | Validates identity + signature; state → `registered`. |
| `enable(name)` | Checks permissions/deps; runs `onInstall` once, then `onLoad`; state → `enabled`. |
| `disable(name)` | Runs `onUnload`; refuses if an enabled plugin still depends on it; state → `disabled`. |
| `remove(name)` | Removes from the host; requires the plugin be disabled first. |

`enable` is idempotent (no duplicate `onInstall`/`onLoad`).

### Discovery

```ts
host.list();                      // all registered names
host.has('stripe');               // boolean
host.state('stripe');             // 'registered' | 'enabled' | 'disabled'
host.findByCapability('payments');// names exposing a capability
host.middlewaresOf('stripe');     // middlewares an enabled plugin contributed
```

## Verification

`packages/core/src/tests/plugin-host.test.ts` covers semver matching, real
Ed25519 sign/verify (including tamper and wrong-key rejection), signature
enforcement on registration, permission gating (including the sandbox),
dependency ordering + version conflicts + cycle detection, idempotent enable,
discovery, and disable/remove safety.

```bash
cd packages/core
npx tsc
node --test dist/src/tests/plugin-host.test.js
```
