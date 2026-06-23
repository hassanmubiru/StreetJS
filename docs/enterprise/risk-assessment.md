---
layout: default
title: Risk Assessment
parent: Enterprise
nav_order: 2
permalink: /enterprise/risk-assessment/
description: "StreetJS risk assessment: supply-chain, operational, plugin, and credential risks with mitigations and residual risk."
---

# Risk Assessment

Each risk lists the **mitigation in StreetJS** and the **residual risk** (what the
operator still owns). This is an honest engineering assessment, not a guarantee.

## Supply-chain risks

| Risk | Mitigation | Residual (operator) |
|------|-----------|---------------------|
| Malicious/compromised dependency | 3 runtime deps (`reflect-metadata`, `ws`, `zod`); native drivers; dependency-review + high-sev audit in CI | pin/lockfile review; monitor advisories |
| Tampered published artifact | npm **provenance** (Sigstore) + per-release SBOM | verify provenance on install (`npm audit signatures`) |
| Typosquatting a plugin | official key signing + certification levels | install only Official/Verified plugins, or review Community ones |
| Leaked secret in repo | Gitleaks + TruffleHog scanning in CI | rotate any exposed secret; pre-commit hooks |

## Operational risks

| Risk | Mitigation | Residual (operator) |
|------|-----------|---------------------|
| Resource exhaustion / DoS | bounded memory, `RateLimiter`, backpressure in realtime | edge rate limiting, autoscaling, WAF |
| Unhandled error → info leak | central handler returns generic messages; no stack traces to clients | review custom handlers |
| Data loss | checksum-verified backups; migrations with up/down | backup schedule, restore drills |
| Misconfiguration | secure defaults; `street doctor` diagnostics | infra review, IaC, least-privilege DB roles |

## Plugin risks

| Risk | Mitigation | Residual (operator) |
|------|-----------|---------------------|
| Untrusted plugin code | manifest signing + host verification; sandboxed surface; explicit permissions | run only signed plugins; review Community-tier source |
| Over-broad permissions | permissions are declared and enforced per manifest | grant minimal permissions; audit manifests |
| Abandoned plugin | certification scorecard (maintenance signal) | track plugin health; pin versions |

## Credential risks

| Risk | Mitigation | Residual (operator) |
|------|-----------|---------------------|
| Secrets in code/logs | `SecretsProvider` indirection + log `redact` | use a real secret manager in prod |
| Weak session/JWT secrets | AES-256-GCM sessions; configurable strong secrets | supply high-entropy secrets via env/secret store |
| Key compromise | field-encryption keyring supports rotation | document + execute a key-rotation policy |
| Cleartext DB auth | PG SCRAM-SHA-256; MySQL refuses cleartext over non-TLS | enable TLS to the database |

## What StreetJS does NOT cover (operator-owned)

Network segmentation, IAM, OS/container hardening, secret-manager operation,
backup/DR execution, incident response, and the compliance audit itself. See
`docs/compliance/` for the control mappings.
