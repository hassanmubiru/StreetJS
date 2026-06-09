---
layout: default
title: "Street Framework — Threat Model"
nav_exclude: true
---

# Street Framework — Threat Model

Methodology: STRIDE over the framework's trust boundaries. Each control below is
backed by source and tests (see `docs/SECURITY-CERTIFICATION.md` and the
`security` / `fuzz` / `chaos` system suites).

## Assets

- User credentials & sessions; JWT/refresh-token secrets; tenant data; secrets
  (DB passwords, API keys); audit log integrity.

## Trust boundaries

1. Client ↔ HTTP server
2. Server ↔ database (PG/MySQL/SQLite wire protocols)
3. Server ↔ external services (webhooks, secret managers, LLMs, brokers)
4. Tenant ↔ tenant (multi-tenancy isolation)

## STRIDE analysis

| Threat | Vector | Control | Evidence |
| --- | --- | --- | --- |
| **Spoofing** | Forged JWT / `alg:none` | HS256-only verification, `timingSafeEqual` | `security-certification` |
| Spoofing | Stolen refresh token replay | Rotation + family revocation (`TokenReplayError`) | refresh-token tests |
| **Tampering** | Audit-log mutation | Append-only DB trigger + HMAC hash-chain | enterprise suite |
| Tampering | Ciphertext tampering | AES-256-GCM auth tag | crypto tests |
| **Repudiation** | Denying actions | Signed, append-only audit log | audit tests |
| **Information disclosure** | Secrets in logs | `[REDACTED]` redaction; `@Sensitive`/`@Classify` | secret/data-policy tests |
| Info disclosure | TLS downgrade | `rejectUnauthorized` true; MySQL refuses cleartext-over-non-TLS | secret-providers, mysql driver |
| **Denial of service** | Unbounded queues/cache | Bounded queues, LRU caps, rate limiter | load/chaos suites |
| **Elevation of privilege** | Missing authz | RBAC roles/permissions + `rbacGuard` | rbac tests |
| EoP | SSRF via webhooks | HTTPS-only + private-IP blocklist + DNS-rebind check | dispatcher tests |
| EoP | SQL injection | Parameterized queries throughout repository/driver | repository + driver tests |
| Tampering | CRLF/header injection | Node native rejection of CRLF in header values | `security-headers` test |

## Residual risks

- Application-level misuse (e.g. disabling `rejectUnauthorized`, passing `['*']`
  CORS) — guarded by safe defaults and documentation.
- Org-process controls (key custody, access reviews) are deployment
  responsibilities, not framework-enforced.
