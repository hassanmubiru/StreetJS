# StreetJS — Official Enterprise Audit & Repository Modernization Report

> **Canonical, publishable enterprise audit** (formerly `STREETJS-MASTER-REPORT.md`).
> Single authoritative report consolidating every audit/hardening phase to date.
> Self-contained for executive + technical review; companion docs are cross-referenced
> for depth. Evidence-based (`git`, `openssl`/`node` fingerprinting, `docker compose
> config`, `npm run verify:signatures`, direct file reads).
>
> **Status tags:** **[DONE]** verified this work · **[OPERATOR]** GitHub/platform or
> destructive action · **[RUNTIME]** plugin/core code change (separate tested PR) ·
> **[ROADMAP]** future.
>
> **Invariants held throughout:** no `packages/core` runtime change · no public
> API/CLI break · no test files modified · plugin architecture + signing + provenance
> intact · full backward compatibility.

---

## 0. Executive Snapshot — Phase 19 (2026-06)

> CTO/architecture-board view. Evidence-based; tags VERIFIED/PARTIAL/GAP. Detail in
> §1–15 below and `audits/ENTERPRISE-READINESS-PHASE-18.md`.

**Verdict: GO WITH CONDITIONS · Overall ~83/100 (A-) · Maturity Level 3–4 (Enterprise Ready, gated by operator + bus-factor items).**

| Area | Score | Grade |
|---|---|---|
| Repository Organization | 90 | A |
| Security | 70 → 86* | B+ → A |
| Supply Chain (SLSA L2) | 82 | A- |
| Governance | 72 | B+ |
| Documentation | 88 | A |
| Developer Experience | 84 | A- |
| Architecture | 88 | A |
| Enterprise Readiness | 85 | A- |
| Ecosystem | 78 | B+ |
| Operations | 84 | A- |
| **Overall** | **83** | **A-** |

`*` Security projects to ~86/A once branch/push protection are enabled and the
(already-distrusted) leaked-key blob is purged from history.

**Top conditions to clear (P0/P1):** (1) branch + push protection + signed commits
[OPERATOR]; (2) purge leaked-key history + relocate on-disk keys [OPERATOR];
(3) CODEOWNERS teams + grow maintainers — neutrality/bus-factor [MAINTAINER];
(4) plugin HTTP timeouts + webhook verifiers [RUNTIME]; (5) starter breadth
(CRM/admin/microservices/auth/payments) [MAINTAINER].

**Foundation (OpenJS/CNCF) readiness:** licensing/security/release/docs bars met;
gating items are **multi-org neutral maintainership**, trademark policy, and a
documented decision process. **Differentiator vs peers:** signed + CI-verified plugin
trust model with provenance + SBOM — exceeds Express/Fastify/Vite and matches
Next/Nest/Nuxt on structure and release engineering. Full risk register + roadmap:
`plans/OUTSTANDING-ACTIONS.md`; compliance: `audits/OPENSSF-REVIEW.md`,
`security/{SLSA-ASSESSMENT,NIST-SSDF-MAPPING,OWASP-ASVS-MAPPING}.md`.

---

## 1. Executive Summary

StreetJS is a security-forward TypeScript monorepo framework (49 packages, 21 signed
official plugins, CLI, docs site, SaaS starter, marketplace). Across the audit phases
it was taken from a cluttered root with a **leaked, trusted signing key** to a
mature-framework layout with a **verified plugin trust model**, layered CI security
gates, full compliance mappings, and a clean root.

**Single most important outcome:** the historical critical — the official
plugin-signing private key was in git history *and* was the embedded trust anchor —
is **remediated by a completed key rotation** (new anchor DER-SHA256 `3ae9add0…`, all
21 plugin manifests re-signed and CI-verified). The old key is distrusted; the only
residual is purging the now-inert blob from history.

| Dimension | Score | Methodology |
|---|---|---|
| Security | 70 verified / 86 projected | `audits/SCORING-METHODOLOGY.md` (OpenSSF+ASVS checks) |
| Repository organization | 88 | metrics + mature-framework layout |
| Governance | 72 / 90 projected | charter/CODEOWNERS/RFC |
| Supply chain | SLSA Build **L2** (L3 targeted) | `security/SLSA-ASSESSMENT.md` |
| Enterprise readiness (composite) | ~82 | `audits/ENTERPRISE-READINESS-2026.md` |
| Residual risk | **LOW–MEDIUM (~20/100)** | — |

**Verdict: GO WITH CONDITIONS** — enterprise-adoptable today; close the P0 operator
items (branch/push protection, history purge, key relocation) for unconditional GO.

---

## 2. Repository Metrics (reproducible — `audits/REPOSITORY-METRICS.md`)

| Metric | Value | Metric | Value |
|---|---|---|---|
| Packages | 49 | Workflows | 38 |
| Official plugins / signed | 21 / 21 | Doc pages (`docs/**/*.md`) | 229 |
| Examples (incl. scaffolds) | 13+ | Test files | 355 |
| Demos | 4 | Scripts | 91 |
| RFCs | 4 | Dockerfiles | 7 |

---

## 3. Repository Organization  [DONE]

Mature-framework layout; root reduced **45 → 7** tracked `.md` (README, LICENSE,
SECURITY, GOVERNANCE, MAINTAINERS, CONTRIBUTING, CODE_OF_CONDUCT, CHANGELOG +
manifests/dotfiles).
```
packages/ docs/ examples/ demos/ benchmarks/ rfcs/ scripts/ ci/ dast/
infra/{docker{,/compose}, kubernetes, helm, examples, monitoring}
security/  audits/  governance/  plans/  .github/  .githooks/
```
- [DONE] `deploy/`→`infra/`, `observability/`→`infra/monitoring/`, compose+Dockerfile→`infra/docker/` (refs updated, `docker compose config` validated).
- [DONE] `app-htmx/next/none/react` → `examples/scaffold-*` (zizmor + dependabot updated; no functional refs left).
- [DONE] Website SEO files removed; generated `sbom.json`/`release-inputs.json` untracked.
- [OPERATOR] Move SEO files into the website repo; `[MAINTAINER]` relocate remaining strategy docs are already in `plans/`.

---

## 4. Security Posture

### 4.1 Trust model  [DONE]
Official anchor `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM` = `3ae9add0…`; all 21 plugin
`manifest.pub` match it (`npm run verify:signatures` → **21/21**). Signing is CI-only
(`STREET_PLUGIN_SIGNING_KEY`), fail-closed, verified against the anchor on publish and
on every push (`verify-signing-anchor`).

### 4.2 Findings ledger
| # | Severity | Finding | Status |
|---|---|---|---|
| F-1 | Critical→**resolved** | Leaked official key was the trust anchor | Rotated; anchor `3ae9add0`; 21/21 re-signed |
| F-2 | High→resolved | `.gitleaks.toml` false "not production key" comment + masking allowlist | Removed; truthful commit-scoped allowlist |
| F-7 | High→resolved | Half-finished rotation (manifests ≠ anchor) | All 21 now match |
| Hist | **HIGH open** | Leaked blob still in history (distrusted) | [OPERATOR] purge (`KEY-ROTATION-RUNBOOK.md` §7) |
| Keys | **HIGH open** | On-disk private keys in tree (gitignored) | [OPERATOR] relocate to secrets manager |
| BP | MED open | Branch/Push protection not enforced | [OPERATOR] apply `repository-settings.json` |

### 4.3 Controls in place  [DONE]
`secrets-guard` (rule #1 gating release chain), `block-private-keys.yml`,
`repository-policy.yml` (root allowlist, no-RESTRICTED-tracked, no-plugin-dockerfiles,
governance-docs-present), `security-baseline.yml` (plugin standard + forbidden files),
`secret-scan.yml` (gitleaks free CLI + trufflehog `--only-verified`), CodeQL, Scorecard,
dependency-review, zizmor; `.gitleaks.toml` (6 rules), hardened `.gitignore`, pre-push key block.

---

## 5. Compliance Alignment

| Framework | Result | Doc |
|---|---|---|
| OpenSSF Scorecard | strong; hard gaps are platform branch/push protection | `audits/OPENSSF-REVIEW.md` |
| SLSA v1.0 | Build **L2** (L3 after branch protection + keyless signing) | `security/SLSA-ASSESSMENT.md` |
| NIST SSDF (800-218) | PO/PS/PW/RV largely ✅ (gaps: ownership breadth, branch protection) | `security/NIST-SSDF-MAPPING.md` |
| OWASP ASVS v4 | V1–V14 ✅/◑ (gaps: DB TLS, webhook verifiers) | `security/OWASP-ASVS-MAPPING.md` |

Scoring is reproducible per `audits/SCORING-METHODOLOGY.md` (equal-weight per-check;
platform/unverifiable checks count 0 until evidenced).

---

## 6. Plugin Runtime Audit  (`audits/PLUGIN-SECURITY-REPORT.md`, `PLUGIN-MATURITY-MATRIX.md`)

- [DONE] **Code safety:** 0 `eval`/`new Function`/`child_process`/`exec`/`any` across all 21 plugin `src/`.
- [DONE] All 21 ship README + manifest.json + manifest.signed.json + manifest.pub + LICENSE + SECURITY.md; no secret logging; input validation; signed.
- **Reference tier:** marzpay (88/100 — fail-closed webhooks + server re-verify, atomic idempotency, server-derived tenant binding, timeout, ~97% cov), htmx.
- [RUNTIME] **Gaps (separate tested PR):** outbound HTTP timeouts on the 9 `node:https` plugins; webhook verifiers for stripe/twilio/paypal/sendgrid (timestamp + replay + constant-time + pre-persist reject); TLS options for redis/mongodb/nats/kafka/rabbitmq.
  - **Scope note:** stripe/sendgrid/twilio/auth0/s3/r2 canonical impls live in `packages/core/.../official/` → frozen; cannot be changed under the no-core rule. paypal/openai/clerk/supabase/firebase are in their own packages.

---

## 7. Infrastructure Audit  (`audits/DOCKER-REVIEW.md`)  [DONE]

- All 11 compose host ports bound to `127.0.0.1` (off the LAN); `docker compose config` validates all 6 files.
- `infra/docker/Dockerfile`: multi-stage, distroless non-root, digest-pinned base; `.dockerignore` at context root.
- All Docker base images digest-pinned; Dependabot `docker` ecosystem tracks `infra/docker`, the 4 scaffolds, `demos`, `registry-server`.
- No plugin ships a Dockerfile (CI-enforced). [ROADMAP] read-only rootfs + cap-drop/resource limits documented for prod.

---

## 8. Supply Chain Verification  [DONE]

- `scripts/security/verify-release.mjs` + `npm run verify:signatures` — verifies all 21 manifests against the anchor using the framework's `verifyManifest`; `-- --provenance` runs `npm audit signatures`. **Verified 21/21.**
- npm provenance (`--provenance`) + cosign/Sigstore release signing in CI; CycloneDX SBOM generated.
- [OPERATOR/ROADMAP] consume-time cosign verification gate; keyless (Sigstore OIDC) signing for SLSA L3.

---

## 9. Documentation Consistency  [DONE]

- Canonical `security/TRUST-CENTER.md` (signing, provenance, SBOM, disclosure, CVE,
  release/manifest verification with the real command, branch protection, compliance index).
- `SECURITY.md`: supported versions, CVSS SLAs, private reporting, plugin reporting, CVE/GHSA, encrypted reporting (PGP placeholder — no fabricated key).
- `CHANGELOG.md` `[Unreleased]` records all non-breaking changes.
- No stale functional path references; relocated-doc links fixed. Point-in-time audits intentionally keep historical paths.
- [ROADMAP] versioned + searchable docs (Pagefind/Algolia).

---

## 10. Governance  (`governance/`)  [DONE]

CHARTER, REPOSITORY-ORGANIZATION, RELEASE-POLICY (SemVer/LTS/breaking/deprecation/
security/emergency/plugin/marketplace), CONTRIBUTOR-GOVERNANCE (roles/review/RFC/
templates/labels/security review). CODEOWNERS present (single-owner) + team-based
`.proposed` with customization instructions.
- [OPERATOR] Fill CODEOWNERS teams + activate; grow MAINTAINERS (bus-factor).

---

## 11. Operator Deliverables (Phase A)  [DONE generating]

- `.github/repository-settings.json` — settings-as-code (branch protection: PR + CODEOWNER review, signed commits, linear history, no force-push/delete, required checks: build-and-test/codeql/secret-scan/verify-signing-anchor/secrets-guard; secret-scanning + push-protection toggles).
- `security/KEY-ROTATION-CHECKLIST.md`, `security/KEY-EMERGENCY-RUNBOOK.md` (rotation/revocation/recovery/verification), `security/SECRET-SCANNING-GUIDE.md`, `security/KEY-ROTATION-RUNBOOK.md` (history purge + rollback).

---

## 12. Benchmark vs leading frameworks  (`audits/ENTERPRISE-READINESS-2026.md`)

Ahead of Express/Fastify/Vite on supply-chain trust (signed + CI-verified plugins);
on par with Next/Nest/Nuxt on structure, RFCs, provenance; behind Next/Laravel on
ecosystem breadth and hosted-docs versioning/search.

---

## 13. Outstanding Actions (authoritative: `plans/OUTSTANDING-ACTIONS.md`)

**P0 [OPERATOR]:** branch protection · Secret Scanning + Push Protection · purge
leaked-key history · relocate on-disk keys · require signed commits.
**P1:** CODEOWNERS teams · `web/` lockfiles · `[RUNTIME]` plugin timeouts + webhook
verifiers · move SEO files to website repo.
**P2:** keyless/KMS signing (SLSA L3) · consume-time provenance verify gate · generate
`verification-artifacts/` in CI · plugin TLS options · versioned/searchable docs ·
security dashboard · standardize CI retention/concurrency.
**P3 [ROADMAP]:** SOC 2 · ISO 27001 · OpenSSF Best Practices badge · Security
Champions · dual-control releases · maintainer growth.

---

## 14. Validation Evidence (this work)

| Check | Result |
|---|---|
| `npm run verify:signatures` | 21/21 ✓ |
| `docker compose config` (6 compose files) | all OK ✓ |
| dependabot directories resolve | all exist ✓ |
| zizmor / dependabot / repository-policy YAML | valid ✓ |
| root-folder allowlist | PASS ✓ |
| `node --check` on edited scripts | clean ✓ |
| diagnostics on new/edited files | clean ✓ |
| `packages/core` modified | **no** ✓ |
| test files modified | **no** ✓ |
| API / CLI / starter / plugin-architecture changed | **no** ✓ |

### Not claimed (per "don't claim unverifiable")
Full test-suite, lint, docs build, examples build, and marketplace build require CI
runners + network (`npm install`) unavailable here — **statically validated only**;
a branch CI run is the gate. `web/` lockfiles need an operator `npm install`.

---

## 15. Companion documents
- Security: `TRUST-CENTER.md`, `SECURITY-AUDIT.md`, `KEY-ROTATION-RUNBOOK.md`, `KEY-ROTATION-CHECKLIST.md`, `KEY-EMERGENCY-RUNBOOK.md`, `SECRET-SCANNING-GUIDE.md`, `SECURITY-CLASSIFICATION.md`, `PLUGIN-SECURITY-STANDARD.md`, `SLSA-ASSESSMENT.md`, `NIST-SSDF-MAPPING.md`, `OWASP-ASVS-MAPPING.md`, `THREAT-MODEL-2026.md`, `SECURITY-ROADMAP.md`, `*-REVIEW.md`.
- Audits: `STREETJS-FULL-AUDIT-REPORT.md`, `PHASE-19-MASTER-AUDIT.md`, `PHASE-20-FINAL-REPORT.md`, `OPENSSF-REVIEW.md`, `DOCKER-REVIEW.md`, `PLUGIN-SECURITY-REPORT.md`, `PLUGIN-MATURITY-MATRIX.md`, `REPOSITORY-METRICS.md`, `SCORING-METHODOLOGY.md`, `ENTERPRISE-READINESS-2026.md`.
- Governance: `CHARTER.md`, `REPOSITORY-ORGANIZATION.md`, `RELEASE-POLICY.md`, `CONTRIBUTOR-GOVERNANCE.md`.
- Plans: `OUTSTANDING-ACTIONS.md`, `REPOSITORY-CLEANUP-PLAN.md`.
- CI/config: `.github/repository-settings.json`, `repository-policy.yml`, `security-baseline.yml`, `block-private-keys.yml`, `.gitleaks.toml`, `dependabot.yml`, `.github/CODEOWNERS`, `scripts/security/verify-release.mjs`.

*Read-only consolidated assessment. No `packages/core` runtime code was modified in
any phase; all changes were organization, CI, documentation, and security controls.*
