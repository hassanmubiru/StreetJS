---
layout: default
title: "Plugin System"
nav_exclude: true
permalink: /plugins/
description: "The StreetJS plugin system — signed manifests, capability permissions, lifecycle hooks and a permission-gated host for extending your TypeScript backend."
---

# Plugin System

> **Looking for plugins to install?** Browse the
> [**Plugin Marketplace**](/StreetJS/plugins/marketplace/) — {{ site.data.plugins.count }} official, signed,
> dependency-free plugins for databases, payments, auth, storage, messaging and AI.

StreetJS ships a formal, dependency-free plugin system built on `node:crypto`. It
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

## Plugin trust model

> **Read this before loading third-party plugins.** Signature verification
> establishes *who* authored a plugin — not *what* it is allowed to do at
> runtime. StreetJS plugins run in-process with full Node.js privileges.

StreetJS plugins are loaded **in-process**, in the same V8 isolate and with the
same OS-level privileges as your application. The plugin system is built for
**trusted, signed code** — it is not a runtime sandbox for hostile code.

- **A signed plugin is a `Trusted_Plugin`, and a trusted plugin is *not*
  sandboxed.** A manifest that carries a valid Ed25519 signature verified
  against the host's configured `publicKey` is trusted: it is a statement about
  *authorship and integrity*, established by `signManifest` / `verifyManifest`.
  It does **not** place the plugin inside a runtime sandbox. Once enabled, a
  trusted plugin executes with the same access to memory, the filesystem, the
  network, and the process as the host application itself.

- **Declared `net`, `fs`, `db`, and `secrets` permissions are honor-system
  grants, not enforced runtime confinement.** The host checks that every
  permission a manifest requests is in `grantedPermissions` before `enable`, and
  the `SandboxedApp` handed to `onLoad` gates the `app.use(...)` (`middleware`)
  and `app.on(...)` (`events`) entry points. But `net`, `fs`, `db`, and
  `secrets` are **declarative metadata only** — nothing in the runtime prevents
  a loaded plugin from opening a socket, reading a file, querying a database, or
  reading environment secrets regardless of whether those permissions were
  granted. Treat the permission list as a manifest of *intent* you audit before
  trusting, not as a cage enforced around the plugin.

- **Verify a plugin's signature before loading it.** Construct the host with a
  trusted `publicKey` so registration rejects any unsigned or tampered manifest
  — when a public key is configured, `register()` throws
  `PluginSignatureError` unless `verifyManifest` succeeds. Use
  `host.verifiesSignatures()` to confirm enforcement is active. Only load
  plugins whose signatures verify against a key you control or trust; an
  unverified plugin should be treated as untrusted code and not loaded into the
  process at all.

  ```ts
  const host = new PluginHost({ grantedPermissions: ['middleware', 'net'], publicKey });
  host.verifiesSignatures();           // true — registration enforces signatures
  host.register(new StripePlugin(), signedManifest); // throws if signature is invalid
  ```

- **True isolation of untrusted plugins is a separate, future initiative.**
  Running *untrusted* plugins behind an enforced boundary (for example a
  `worker_threads`- or `vm`-based runner with real capability confinement) is
  tracked as a future security initiative (**F-P2**) and is **not** provided
  today. Until it ships, do not load code you are not prepared to trust with
  full process privileges.

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
