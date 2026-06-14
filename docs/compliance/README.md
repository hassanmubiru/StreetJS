---
layout: default
title: Compliance Control Mappings
nav_order: 30
description: "How StreetJS features map to SOC 2, HIPAA, GDPR, and PCI-DSS control families — and what the framework does not provide."
---

# Compliance Control Mappings

> **Important:** A framework cannot *be* compliant — compliance is achieved by an
> **operator** through people, process, and an independent audit. StreetJS
> provides **technical controls** that *support* your compliance program. These
> documents map StreetJS features to control families and **explicitly list the
> controls StreetJS does not provide** (your responsibility).

Each mapping uses three columns:

- **Control** — the requirement (paraphrased).
- **StreetJS support** — the feature(s) that help satisfy it (with the public API).
- **Status** — `Provided` (feature exists), `Partial` (helps, needs config/process),
  or `Operator` (StreetJS does not cover this — you must).

See [`control-mappings.md`](control-mappings.md) for SOC 2, HIPAA, GDPR, and
PCI-DSS. All referenced features are verified exports of `streetjs`.

## Feature → control building blocks (verified)

| Capability | StreetJS API |
|------------|--------------|
| Authentication | `JwtService`, `SessionManager`, `authMiddleware` |
| Authorization (RBAC) | `requireRoles`, role claims on the auth context |
| Audit logging | `AuditWriter`, `auditAuthEvent`, `auditPermissionDenied`, `AUDIT_LOG_MIGRATION_SQL` |
| Encryption at rest (secrets/fields) | `encryptSecret`/`decryptSecret` (vault), `Keyring` + `FieldCipher` |
| Encryption of sessions | AES-256-GCM (`SessionManager`) |
| Encryption in transit | `createMutualTlsServer`, `securityHeaders` (HSTS), TLS by deployment |
| Secret management | `SecretsProvider` (GitHub/AWS/Azure/GCP), log `redact` |
| Data retention / deletion / consent / export | `PrivacyControls`, `RetentionPolicy`, `ConsentDecision` |
| Rate limiting / abuse | `RateLimiter`, `AbuseEngine` |
| Input validation | `validate`, `@Validate` |

These are the primitives the mappings reference.
