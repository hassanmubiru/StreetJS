---
layout: default
title: Architecture Overview
parent: Enterprise
nav_order: 1
permalink: /enterprise/architecture-overview/
description: "StreetJS architecture for enterprise evaluators: security model, plugin trust, dependency philosophy, runtime isolation."
---

# Architecture Overview (for evaluators)

An enterprise evaluator should be able to understand StreetJS's trust properties
without reading the source. This document summarizes the model; every claim maps
to a verifiable feature.

## Dependency philosophy

StreetJS core (`streetjs`) is built on Node.js core modules with **two runtime
dependencies** (`reflect-metadata`, `ws`). Database drivers (PostgreSQL wire v3,
MySQL, SQLite), HTTP, TLS, crypto, and clustering are implemented on `node:*` —
**no `express`, `pg`, or `prisma`**. This minimizes the third-party attack
surface and supply-chain exposure.

## Security model

| Concern | Mechanism |
|---------|-----------|
| Authentication | `JwtService`, `SessionManager` (AES-256-GCM sessions) |
| Authorization | RBAC via `requireRoles`; permission checks on the request context |
| Transport | `securityHeaders` (HSTS/CSP), mutual TLS (`createMutualTlsServer`) |
| Input safety | schema validation (`validate`/`@Validate`) rejects before handlers; parameterized SQL |
| Secrets | `SecretsProvider` adapters (GitHub/AWS/Azure/GCP); log `redact` |
| Data at rest | vault (`encryptSecret`) and field-level encryption (`Keyring`/`FieldCipher`) |
| Abuse | `RateLimiter`, `AbuseEngine`, moderation toolkit |
| Audit | `AuditWriter` + structured audit events, persisted via migrations |

## Plugin trust model

- Plugins declare a **manifest** (capabilities + permissions) that is
  **Ed25519-signed**.
- The `PluginHost` verifies signatures against a trusted public key before a
  plugin is registered; an invalid signature is rejected **before** load.
- Official plugins are signed with the StreetJS official key
  (`OFFICIAL_PLUGIN_PUBLIC_KEY_PEM`, embedded in core) and published to npm with
  **provenance**.
- Plugins run through a **sandboxed app surface** and only receive the
  permissions their manifest declares (`net`, `secrets`, `middleware`, …).
- Certification levels (Official / Verified / Community) are defined in
  `docs/ecosystem/plugin-certification.md`.

## Runtime isolation model

- Plugins interact with the app only through the **`SandboxedApp`** interface
  (middleware registration + declared capabilities), not the raw app object.
- Permission grants are explicit and enforced by the host (`PluginPermissionError`
  on a missing grant).
- Request handling uses a per-request context; secrets are redacted from logs.

## Supply chain

- Releases publish with **npm provenance** (Sigstore) and a per-release
  **CycloneDX SBOM**.
- CI enforces: secret scanning (Gitleaks/TruffleHog), dependency review,
  high-severity `npm audit`, CodeQL, and workflow static analysis (zizmor).
- Actions are pinned to commit SHAs.

See the [Security Whitepaper](security-whitepaper.md) for mechanism detail and
the [Risk Assessment](risk-assessment.md) for residual risks and mitigations.
