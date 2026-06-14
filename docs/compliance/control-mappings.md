---
layout: default
title: SOC2 / HIPAA / GDPR / PCI Mappings
parent: Compliance Control Mappings
nav_order: 1
description: "StreetJS feature-to-control mappings for SOC 2, HIPAA, GDPR, and PCI-DSS, with operator responsibilities called out."
---

# Control Mappings

Status legend: **Provided** = feature exists · **Partial** = supports the control
but needs configuration/process · **Operator** = not covered by StreetJS.

---

## SOC 2 (Trust Services Criteria)

| Control area | StreetJS support | Status |
|--------------|------------------|--------|
| Logical access — authentication | `JwtService`, `SessionManager`, `authMiddleware` | Provided |
| Logical access — authorization | `requireRoles` (RBAC), permission checks | Provided |
| Audit logging (CC7) | `AuditWriter` + `auditAuthEvent`/`auditPermissionDenied`; persisted via `AUDIT_LOG_MIGRATION_SQL` | Provided |
| Encryption at rest | vault (`encryptSecret`), field-level (`Keyring`/`FieldCipher`) | Provided |
| Encryption in transit | `securityHeaders` (HSTS/CSP), mTLS (`createMutualTlsServer`) + TLS at the edge | Partial (deploy config) |
| Secrets management | `SecretsProvider` adapters + log `redact` | Provided |
| Monitoring | Prometheus metrics, OpenTelemetry traces, subsystem metrics | Provided |
| Change management (CC8) | versioned releases + provenance + SBOM + CI gates | Partial (needs written policy) |
| Vendor/supply-chain | Gitleaks/TruffleHog, dependency-review, signed plugins | Provided |
| Risk assessment, personnel, incident response | — | **Operator** |
| Independent audit | — | **Operator** |

**Missing (operator):** formal change-management policy, access-review cadence,
incident-response runbook, risk register, the audit itself.

---

## HIPAA (Security Rule — technical safeguards)

| Safeguard | StreetJS support | Status |
|-----------|------------------|--------|
| Access control (§164.312(a)) | `authMiddleware` + `requireRoles`; field encryption gates PHI columns | Provided |
| Audit controls (§164.312(b)) | `AuditWriter` records access to PHI-bearing operations | Provided |
| Integrity (§164.312(c)) | parameterized queries, ACID transactions, checksummed backups | Provided |
| Person/entity authentication (§164.312(d)) | `JwtService`, MFA helpers, `SessionManager` | Provided |
| Transmission security (§164.312(e)) | mTLS + HSTS; TLS at the edge | Partial (deploy config) |
| Encryption of PHI at rest | `Keyring`/`FieldCipher` (field-level), vault | Provided |
| Retention / minimum necessary | `PrivacyControls` + `RetentionPolicy`; RBAC least-privilege | Partial (policy config) |
| BAAs, workforce training, contingency plan | — | **Operator** |

**Missing (operator):** Business Associate Agreements, breach-notification
process, workforce training, contingency/DR plan.

---

## GDPR

| Requirement | StreetJS support | Status |
|-------------|------------------|--------|
| Right to erasure (Art. 17) | `PrivacyControls` delete APIs over `PersonalDataSource` | Provided |
| Data retention limits (Art. 5) | `RetentionPolicy` + retention store | Provided |
| Consent (Art. 6/7) | `ConsentDecision`, `ConsentRequiredError` gating | Provided |
| Right to access / portability (Art. 15/20) | `PrivacyControls` export over registered data sources | Provided |
| Security of processing (Art. 32) | field encryption, RBAC, rate limiting, audit log | Provided |
| Data-protection by design (Art. 25) | data classification + field-level encryption defaults | Partial (config) |
| Breach notification (Art. 33/34) | audit log provides evidence trail | Partial (needs runbook) |
| Records of processing, DPO, DPIA | — | **Operator** |

**Missing (operator):** records of processing activities, DPIA, DPO designation,
controller/processor agreements.

---

## PCI-DSS (applicable technical requirements)

| Requirement | StreetJS support | Status |
|-------------|------------------|--------|
| Req 3 — protect stored data | field-level encryption; **never store PAN** (design out of scope) | Partial |
| Req 4 — encrypt transmission | mTLS + HSTS + TLS at edge | Partial (deploy config) |
| Req 6 — secure development | input validation, parameterized queries, CodeQL, dependency audit | Provided |
| Req 7 — restrict access | `requireRoles` (RBAC), least privilege | Provided |
| Req 8 — authentication | `JwtService`, MFA, `SessionManager` | Provided |
| Req 8.2 — no hard-coded secrets | `SecretsProvider` + log `redact` + Gitleaks scanning | Provided |
| Req 10 — log & monitor | `AuditWriter`, Prometheus/OTel | Provided |
| Req 11 — test security | DAST pipeline, system-test suites | Provided |
| Cardholder-data environment scoping, QSA assessment | — | **Operator** |

**Strong recommendation:** do not store card data in StreetJS — use a PCI-scoped
processor (the official `@streetjs/plugin-stripe` / `plugin-paypal`) so the CDE
stays out of your application. **Missing (operator):** network segmentation, the
QSA/SAQ assessment, key-management policy.

---

## How to use these mappings

1. Pull the control list your auditor uses.
2. For each control, cite the **StreetJS support** row (feature + API) as the
   technical evidence, and implement the **Operator** rows as process/policy.
3. The CI pipeline (provenance, SBOM, CodeQL, secret scanning) provides
   supply-chain evidence artifacts you can attach to the audit.

These mappings are a starting evidence pack, **not** a compliance certification.
