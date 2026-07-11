---
layout:      default
title:       "Writing a StreetJS Plugin"
permalink:   /plugin-authoring/
nav_exclude: true
description:  "Author guide for StreetJS plugins — the PluginModule contract, package layout, signed manifests, offline tests, and publishing. Build a dependency-free, verifiable plugin."
---

# Writing a StreetJS Plugin

A StreetJS plugin is a small package that extends an app through the
`PluginModule` contract. Official plugins are dependency-free and ship a **signed
manifest** so hosts can verify them before load. This guide shows the whole path:
contract → package layout → manifest → tests → publish.

---

## 1. The `PluginModule` contract

Subclass `PluginModule` and implement `name` + `version`; the lifecycle hooks are
optional.

```typescript
import { PluginModule, type SandboxedApp } from 'streetjs';

export class HelloPlugin extends PluginModule {
  readonly name = 'street-plugin-hello';
  readonly version = '1.0.0';

  // one-time setup (migrations, etc.) — optional
  async onInstall(): Promise<void> {}

  // each load: register middleware + lifecycle listeners via the sandboxed app
  async onLoad(app: SandboxedApp): Promise<void> {
    app.use(async (ctx, next) => { ctx.res.setHeader('x-hello', 'street'); await next(); });
    app.on('server:ready', () => { /* … */ });
  }

  async onUnload(_app: SandboxedApp): Promise<void> {}
}

export default HelloPlugin;
```

`SandboxedApp` is a restricted view — `use(middleware)` and `on(event, handler)`.
Plugins cannot reach the DI container or internal server state directly.

---

## 2. Package layout

```
my-plugin/
  src/index.ts          # the PluginModule subclass (+ any exports)
  manifest.json         # name/version/capabilities/permissions
  example/index.mjs     # a runnable usage example (node --check clean)
  test/contract.test.mjs
  package.json
  tsconfig.json
  README.md  LICENSE
```

### package.json (note the `files` allowlist)

Ship the built `dist/**` and the manifest(s); **exclude compiled test files**, and
**do not** rely on a single `dist/index.js` entry — sibling runtime modules must
ship too (this is the packaging class that broke real packages historically; see
the registry subpath-import gate).

```jsonc
{
  "name": "@you/street-plugin-hello",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "peerDependencies": { "streetjs": ">=1.2.0" },
  "files": [
    "dist/**/*.js", "dist/**/*.js.map", "dist/**/*.d.ts", "dist/**/*.d.ts.map",
    "!dist/**/*.test.js", "!dist/**/*.test.js.map",
    "!dist/**/*.test.d.ts", "!dist/**/*.test.d.ts.map",
    "manifest.json", "manifest.signed.json", "README.md", "LICENSE", "example/**/*"
  ],
  "scripts": {
    "build": "tsc",
    "test": "node --test test/*.test.mjs",
    "lint": "tsc --noEmit"
  }
}
```

---

## 3. The manifest

`manifest.json` declares identity and the capabilities/permissions the host grants.

```json
{
  "name": "street-plugin-hello",
  "version": "1.0.0",
  "capabilities": ["middleware"],
  "permissions": ["middleware"]
}
```

Common permissions: `net`, `secrets`, `middleware`. Request the **least** you need —
hosts and the registry surface these to users at install time.

---

## 4. Signed manifests (optional for third parties, required for official)

Hosts verify a `manifest.signed.json` before load. StreetJS exports the primitives:

```typescript
import { signManifest, verifyManifest } from 'streetjs';
import { createPrivateKey, createPublicKey } from 'node:crypto';

const priv = createPrivateKey(process.env.PLUGIN_SIGNING_KEY!); // Ed25519 PKCS#8 PEM
const signed = signManifest(JSON.parse(readFileSync('manifest.json', 'utf8')), priv);
// verifyManifest(signed, createPublicKey(priv)) === true
```

Do the signing in a **release-only** step (e.g. `prepublishOnly`), never in `build`,
so a local/CI build never mutates a committed signed manifest, and never sign with an
ephemeral key. Keep the private key out of the repo (CI secret / KMS). Official
plugins pin this to a CI secret; a future move to keyless/OIDC signing is proposed in
[RFC 0005](https://github.com/hassanmubiru/StreetJS/blob/main/rfcs/0005-keyless-signing.md).

---

## 5. An offline contract test

Keep a fast, network-free test that proves the package loads and its contract holds
(this mirrors the framework's own plugin tests):

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import Plugin, * as mod from '../dist/index.js';

test('exposes a PluginModule subclass with name + version', () => {
  const p = new Plugin();
  assert.equal(typeof p.name, 'string');
  assert.match(p.version, /^\d+\.\d+\.\d+/);
  assert.equal(typeof p.onLoad, 'function');
});
```

---

## 6. Publishing

- **npm:** `npm publish --provenance --access public` (provenance ties the artifact
  to the building workflow — recommended).
- **Network Plugin Registry:** `street registry publish` runs the publish→install
  verification path; `street plugin install <name>@<version>` verifies the signed
  manifest before installing.

Verify your own tarball before publishing: `npm pack --dry-run` should show your
`dist/**` modules and manifest, and **zero** `*.test.*` files.

---

## Principles

- **No runtime dependencies** in official plugins — pure standard library. Keeps the
  trust surface small and the supply chain verifiable.
- **Least privilege** in the manifest.
- **Additive, SemVer-honest** changes; declare `streetjs` as a `peerDependency`.
