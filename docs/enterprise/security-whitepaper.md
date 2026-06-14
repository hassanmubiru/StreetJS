---
layout: default
title: Security Whitepaper
parent: Enterprise
nav_order: 3
description: "StreetJS security mechanisms: plugin signing, provenance, SBOM, audit logging, encryption, vault, mTLS, rate limiting, DAST."
---

# Security Whitepaper

Mechanism-level detail for security teams. Each section names the concrete
feature and how to verify it.

## Plugin signing

Plugin manifests (capabilities + permissions) are signed with **Ed25519**. The
`PluginHost`, when configured with a trusted public key, verifies the signature
**before** registering a plugin and rejects tampered or wrong-key manifests
(`PluginSignatureError`) without changing the installed set. Official plugins are
signed with the StreetJS official key (`OFFICIAL_PLUGIN_PUBLIC_KEY_PEM`, exported
from core). *Verify:* `scripts/verify-official-signatures.mjs` checks every
published `@streetjs/plugin-*` against the official key.

## Provenance

Releases publish to npm with **Sigstore provenance** (`npm publish --provenance`,
OIDC via GitHub Actions `id-token: write`). A CI **provenance gate** fails the
release if any published package lacks an attestation. *Verify:*
`npm view <pkg> dist.attestations`.

## SBOM

A **CycloneDX 1.5** SBOM is generated per release (`scripts/generate-sbom.mjs`)
and uploaded as a retained CI artifact, listing the production dependency tree
with hashes.

## Audit logging

`AuditWriter` plus `auditAuthEvent` / `auditPermissionDenied` emit structured
audit records (login, permission-denied, security-relevant events), persisted via
`AUDIT_LOG_MIGRATION_SQL`. Records are tamper-evident at the application layer and
queryable for review.

## Encryption

- **Sessions:** AES-256-GCM (`SessionManager`).
- **Secrets/config:** `encryptSecret`/`decryptSecret` (vault mode).
- **Field-level:** `Keyring` + `FieldCipher` encrypt designated columns; the
  keyring supports multiple keys to enable rotation.
- **In transit:** `securityHeaders` (HSTS), mutual TLS (`createMutualTlsServer`,
  client-cert validation, certificate pinning).

## Vault mode

Configuration and secrets can be stored encrypted so the database never holds
plaintext; `loadConfig` + `decryptSecret` decrypt at use. `constantTimeEqual`
guards secret comparisons against timing attacks.

## mTLS

`createMutualTlsServer` enforces client certificates with `validateClientCert`,
`certificateFingerprint`, `verifyCertificatePin`, and a `TrustStore`; supports
server-cert rotation.

## Rate limiting

`RateLimiter` (in-memory or Redis-backed via `RedisRateLimitStore`) with the
`@RateLimit` decorator / `rateLimit` middleware; window parsing is validated.
`AbuseEngine` adds IP-reputation and auth-signal-based abuse decisions.

## DAST

A dynamic application security testing pipeline (`dast.yml`, `scripts/dast/`)
runs OpenAPI-conformance and ZAP-style scans; results feed a severity gate
(`evaluateDastGate`).

## Verification index

| Mechanism | Verify with |
|-----------|-------------|
| Plugin signatures | `scripts/verify-official-signatures.mjs`; `plugin-structure` tests |
| Provenance | `npm view <pkg> dist.attestations` |
| SBOM | release artifact `sbom-<ref>.json` |
| Secret scanning | `secret-scan.yml` (Gitleaks + TruffleHog) |
| Static analysis | CodeQL (`codeql.yml`), zizmor (Security Lint) |
| Dependency risk | dependency-review + `npm audit --audit-level=high` |
