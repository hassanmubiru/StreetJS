---
layout:    default
title:     "Plugin Author Guide"
parent:    "Ecosystem"
nav_order: 2
permalink: /ecosystem/plugin-author-guide/
description: "Build, sign, and publish a StreetJS plugin — package layout, the plugin contract, configuration validation, Ed25519 manifest signing, and the certification path."
---

# Plugin Author Guide

How to build a third-party StreetJS plugin that is safe, installable, and
trustworthy. StreetJS plugins are plain, dependency-light packages that implement
a small contract and ship a **signed manifest** so consumers can verify
provenance.

> Prerequisites: a published understanding of [Plugin Certification](/ecosystem/plugin-certification/)
> and a TypeScript package targeting Node ≥ 20, ESM (`"type": "module"`).

---

## 1. Package layout

```
my-plugin/
├── src/index.ts          # plugin implementation + exported factory
├── manifest.json         # name, version, capabilities (source of truth)
├── manifest.signed.json  # generated at publish: checksum + signature
├── manifest.pub          # generated at publish: public key (verification)
├── scripts/sign.mjs       # signing step (runs ONLY at publish)
├── package.json
└── tsconfig.json
```

`package.json` scripts follow the official pattern — **build never signs**:

```json
{
  "scripts": {
    "build": "tsc",
    "sign": "node scripts/sign.mjs",
    "prepublishOnly": "npm run clean && npm run build && npm run sign"
  }
}
```

This separation is a hard rule (see §5): a plain `npm run build` must never mutate
`manifest.signed.json`/`manifest.pub`. Signing happens only during `npm publish`,
and only when the signing key is present.

---

## 2. The plugin contract

A plugin exports a factory and a manifest. Keep runtime dependencies minimal —
prefer Node core and `@streetjs/*` peers over third-party packages.

```typescript
// src/index.ts
export const MY_PLUGIN_NAME = '@acme/streetjs-plugin-acme';
export const MY_PLUGIN_VERSION = '1.0.0';

export interface AcmeConfig {
  apiKey: string;
  baseUrl?: string;
}

/** Validate config defensively — accept valid, throw on invalid (never trust input). */
export function validateAcmeConfig(input: unknown): AcmeConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  if (typeof o.apiKey !== 'string' || o.apiKey.trim() === '') {
    throw new Error('acme plugin config: "apiKey" must be a non-empty string');
  }
  if (o.baseUrl !== undefined && typeof o.baseUrl !== 'string') {
    throw new Error('acme plugin config: "baseUrl" must be a string');
  }
  return { apiKey: o.apiKey, ...(o.baseUrl ? { baseUrl: o.baseUrl } : {}) };
}

export class AcmePlugin {
  constructor(private readonly cfg: AcmeConfig) {}
  // ... capabilities the plugin exposes, built on Node core / public APIs only.
}

/** Factory used by consumers. */
export function acmePlugin(config: unknown): AcmePlugin {
  return new AcmePlugin(validateAcmeConfig(config));
}
```

Guidelines:
- **Validate all config** with a `validate*` function that throws on bad input
  (this is checked by the runtime certification harness for official plugins).
- **No regex on uncontrolled input** that can backtrack (avoid `js/polynomial-redos`);
  use `startsWith`/`slice`/linear scans.
- **No secrets in the bundle**; read credentials from config/env at runtime.
- **Never reach into core internals** — depend on documented `@streetjs/*` APIs.

---

## 3. The manifest

`manifest.json` is the source of truth describing the plugin:

```json
{
  "name": "@acme/streetjs-plugin-acme",
  "version": "1.0.0",
  "capabilities": ["http-client"],
  "engines": { "streetjs": ">=1.0.0" }
}
```

At publish time the signing step produces:
- `manifest.signed.json` — the manifest plus a SHA-256 `checksum` and an Ed25519
  `signature`.
- `manifest.pub` — the SPKI public key consumers use to verify the signature.

---

## 4. Signing your plugin

Generate a stable Ed25519 key once and keep the private key secret (a CI secret —
never in the repo):

```bash
node -e "const {generateKeyPairSync}=require('crypto');const{privateKey,publicKey}=generateKeyPairSync('ed25519');console.log(privateKey.export({type:'pkcs8',format:'pem'}).toString())" > signing-key.pem
```

Your `scripts/sign.mjs` must **require** the key and fail without it, so an
unsigned/ephemerally-signed package can never be published:

```javascript
import { signManifest, verifyManifest } from 'streetjs';
import { createPrivateKey, createPublicKey } from 'node:crypto';

const envKey = process.env.PLUGIN_SIGNING_KEY;
if (!envKey) { console.error('FATAL: PLUGIN_SIGNING_KEY not set'); process.exit(1); }
const privateKey = createPrivateKey(envKey);
const signed = signManifest(JSON.parse(/* manifest.json */), privateKey);
// write manifest.signed.json + manifest.pub (public key), verify before writing.
```

Publish from CI with the key injected as a secret:

{% raw %}
```yaml
- name: Publish
  env:
    PLUGIN_SIGNING_KEY: ${{ secrets.PLUGIN_SIGNING_KEY }}
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
  run: npm publish --provenance --access public
```
{% endraw %}

Consumers verify with the framework's `verifyManifest()` against your published
`manifest.pub`.

---

## 5. CI hygiene (required)

Add a check that a build never mutates signed artifacts — this catches the classic
"build re-signs with an ephemeral key" footgun:

```yaml
- run: npm run build
- run: git diff --exit-code   # fails if build changed manifest.signed.json/.pub
```

The official StreetJS monorepo enforces exactly this in
`runtime-certification.yml`; mirror it in your plugin repo.

---

## 6. Validate at runtime

Before publishing, prove your plugin installs, imports, initializes, validates
config, and verifies its own signature:

```bash
npm pack                       # build the publishable tarball
npm install ./acme-*.tgz       # install as a consumer would
node -e "import('@acme/streetjs-plugin-acme').then(m => {
  if (typeof m.acmePlugin !== 'function') throw new Error('missing factory');
  try { m.validateAcmeConfig({}); throw new Error('should reject'); } catch {}
  m.acmePlugin({ apiKey: 'k' });           // valid path
  console.log('plugin OK');
})"
```

---

## 7. Certification path

| Level | Requirements |
|-------|--------------|
| **Community** | Published, signed, validates config, no core-internal imports |
| **Verified** | Above + CI (build clean + tests), provenance attestation, SemVer policy |
| **Official** | Maintained in-tree, signed by the official key, covered by the runtime certification suite |

See [Plugin Certification](/ecosystem/plugin-certification/) for the full criteria
and how to submit your plugin for review.

---

## Checklist before publishing

- [ ] `build` is `tsc` only — never signs.
- [ ] `prepublishOnly` runs `build && sign`; `sign` fails without the key.
- [ ] `validate*` rejects invalid config; no ReDoS-prone regex on input.
- [ ] No secrets in the bundle; no core-internal imports; minimal dependencies.
- [ ] `npm pack` + install + import smoke passes.
- [ ] CI asserts `git diff --exit-code` is clean after `build`.
- [ ] Provenance enabled on publish (`--provenance`).
