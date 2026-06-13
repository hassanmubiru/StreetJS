---
layout: default
title: "Plugin Registry — Publishing Guide"
nav_exclude: true
description: "How to publish a signed plugin to the StreetJS Network Plugin Registry with the street CLI — sign, authenticate, and publish over the /api/v1 REST API."
---

# Publishing Guide

This guide walks a plugin author through publishing a signed plugin to the
**Network Plugin Registry** (`@streetjs/registry-server`) using the
`street registry publish` command. The registry hosts, indexes, and serves
signed plugins over a `/api/v1` REST API; every published version is verified
with an **Ed25519 signature** over its manifest before it is stored.

> See also the [Installation Guide](./registry-installation-guide.md) for the
> consumer side of the flow.

## Prerequisites

- A running registry endpoint. Point the CLI at it with `--registry <url>` or
  the `STREET_REGISTRY_URL` environment variable. Defaults to
  `http://localhost:8787`.
- A **publisher bearer token** issued by the registry operator. The registry
  stores only the SHA-256 hash of your key — never the raw token. Supply it with
  `--token <apiKey>` or the `STREET_REGISTRY_TOKEN` environment variable.
- **Namespace ownership.** A publisher may only publish plugins whose namespace
  it owns. The namespace is the segment before the first `/`, with a leading `@`
  removed — so `@acme/widgets` and `acme/widgets` both belong to namespace
  `acme`. Publishing outside an owned namespace is rejected with `UNAUTHORIZED`.

## 1. Author the manifest

Create a `manifest.json` describing the plugin. Required fields are `name` and a
semver `version` (`MAJOR.MINOR.PATCH`); `capabilities` and `dependencies` are
optional but recommended for discovery and resolution.

```json
{
  "name": "acme/widgets",
  "version": "1.2.0",
  "capabilities": ["widgets"],
  "dependencies": {}
}
```

The manifest metadata is validated **before** anything is stored. A missing
required field, a malformed version, or a duplicate `name@version` is rejected
with an error that identifies the offending field.

## 2. Generate a signing key

Each publisher signs manifests with an **Ed25519** private key. Generate one
with the Node runtime that ships with StreetJS:

```bash
node -e "const {generateKeyPairSync}=require('node:crypto');const {privateKey}=generateKeyPairSync('ed25519');require('node:fs').writeFileSync('publisher.key.pem',privateKey.export({type:'pkcs8',format:'pem'}));"
```

Keep `publisher.key.pem` secret. The CLI derives the matching public key from it
automatically and sends the public key with the publish request so the registry
can verify the signature. (You may also supply a public key explicitly with
`--public-key <path>`.)

## 3. Package the plugin

Build a tarball of your plugin's distributable files:

```bash
npm pack            # produces acme-widgets-1.2.0.tgz
```

## 4. Publish

```bash
street registry publish \
  --registry https://registry.example.com \
  --token "$STREET_REGISTRY_TOKEN" \
  --manifest ./manifest.json \
  --tarball ./acme-widgets-1.2.0.tgz \
  --key ./publisher.key.pem \
  --categories ui,tools \
  --tags widget \
  --description "A widget plugin"
```

On success the CLI prints the published identity, the stored tarball checksum,
and the publish timestamp:

```
[street] Published acme/widgets@1.2.0
[street]   tarball checksum: 9f86d0818884...
[street]   published at:     2026-01-01T00:00:00.000Z
```

### What the CLI does

1. Loads `manifest.json` and **signs** it with your Ed25519 private key — the
   signature covers a deterministic, key-sorted canonical form of the manifest
   body and is recorded alongside a SHA-256 `checksum`.
2. Derives the public key from your private key (or reads `--public-key`).
3. Base64-encodes the tarball.
4. `POST`s `{ manifest, publicKeyPem, tarballBase64, … }` to
   `/api/v1/plugins` with `Authorization: Bearer <token>`.

### What the registry does

In order, the registry: authenticates the bearer token → validates the manifest
metadata → authorizes the publisher for the namespace → rejects duplicate
`name@version` → verifies the Ed25519 signature and checksum → stores the signed
manifest, public key, tarball, and indexed metadata. **Any rejection leaves the
store untouched, preserving previously published valid versions.**

## Error reference

| Exit | Code | Meaning |
| --- | --- | --- |
| 1 | `UNAUTHENTICATED` | No valid publisher token was presented. |
| 1 | `UNAUTHORIZED` | The token does not own the plugin's namespace. |
| 1 | `INVALID_MANIFEST` | A required metadata field is missing or malformed (the offending field is named). |
| 1 | `DUPLICATE` | `name@version` already exists. |
| 1 | `INTEGRITY_FAILED` | The signature, checksum, key, or tarball failed validation. |

A non-zero exit code makes the command safe to gate a release pipeline on.
