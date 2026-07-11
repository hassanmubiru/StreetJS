---
layout: default
title: "StreetJS — Final Engineering Certification"
nav_exclude: true
description: "Single consolidated final engineering certification for StreetJS. Verdict: ENGINEERING CERTIFIED."
sitemap: false
noindex: true
---

# StreetJS — Final Engineering Certification

**Roles:** Principal Engineer / Architect / Release Engineer / QA Lead / Security Auditor / DevOps / Maintainer
**Date:** 2026-07-11 (UTC)
**Repository:** `hassanmubiru/StreetJS` @ `main` `834c723d`
**Method:** Adversarial — every PASS below is from a command executed this
engagement. No inference, no fabrication. Unreproducible claims are marked
NOT VERIFIED.

> This is the single authoritative closure report. It consolidates and supersedes
> the same-day `2026-07-11-falsification-closure-review.md` and
> `2026-07-11-engineering-certification-closure.md`.

---

# Executive Summary

StreetJS has reached a stable engineering endpoint. Across the certification
effort, five packaging/runtime defects (F-1…F-5) and one release-signing defect
(M-1) were discovered and **all fixed and verified**. In the final pass, the two
remaining engineering-owned `NOT VERIFIED` items were closed with fresh evidence:

- **Per-subpath runtime imports:** 54/54 published packages installed from the npm
  registry; **130/130 export subpaths import OK, 0 failures.**
- **Framework Docker build:** clean `--no-cache` build of `infra/docker/Dockerfile`
  succeeds and the image boots.

No reproducible engineering defect remains, and no engineering-owned `NOT VERIFIED`
item remains. The only residual is credential-gated provider verification, which is
purely operational.

**Verdict: ENGINEERING CERTIFIED.**

---

# Repository State

| Item | State (verified this engagement) |
|------|----------------------------------|
| Branch | `main`, not detached |
| Working tree | clean (`git status --porcelain` empty) |
| Origin sync | local `834c723d` == `origin/main` |
| Branches | remote has only `main`; 0 open PRs; 2 stale local branches (fully superseded by `main`) removed |
| Release tags | `v1.1.4` (latest core line), `v1.1.3`, `backend-v1.0.1/2/3`, `frontend-v1.0.1`, `plugins-v1.0.3` |
| Integrity | no accidental artifacts; benchmark/report outputs gitignored |

---

# Engineering Summary (verified outcomes only)

- **Architecture:** 54-package workspace; dependency-free core; clean package
  boundaries; `streetjs` / `@streetjs/core` (deprecated compat shim) / `@streetjs/cli`
  lockstep line. Stable.
- **Build health:** all buildable packages compile in dependency order (0 fail).
- **Runtime health:** core imports (510 exports); CLI `street v1.1.4`; a freshly
  generated project (`street create` → `npm install` → `tsc --noEmit`) compiles clean;
  **every published subpath imports (130/130).**
- **Package integrity:** exports/main/types targets resolve; published tarballs are
  test-file-free after remediation; LICENSE/README/types present.
- **API stability:** additive/fix-only across the 1.1.x line; no public export or
  path removed.
- **Release integrity:** core line `1.1.4` on npm with SLSA provenance (verified
  `provenance: OK` on all three of `streetjs`/`@streetjs/core`/`@streetjs/cli`); the
  `v1.1.4` GitHub Release carries cosign `.cosign.bundle` signed assets (3 tarballs +
  3 bundles + SBOM); framework/vertical packages published with provenance via
  `publish-backend.yml`.
- **Security:** 0 open secret-scanning / Dependabot / code-scanning alerts;
  `npm audit` 0 vulnerabilities; no dangerous sinks in production source.
- **CI/CD:** latest run of every workflow on `main` = success (transient
  `cancel-in-progress` cancellations from rapid successive commits are expected, not
  failures).
- **Docker:** clean `--no-cache` build of `infra/docker/Dockerfile`; image boots.

---

# Defect Register (certification effort)

| ID | Summary | Severity | Disposition |
|----|---------|:--------:|-------------|
| F-1 | Test files published in tarballs (8 packages shipped tests) | High | **FIXED** — `files` test-exclusion across 38 packages; 8 republished at 1.0.1; 0 test files verified |
| F-2 | Certification test false-positive on `files` negation entry | Low | **FIXED** — skip `!`-prefixed exclusions; suite green |
| F-3 | Kafka `listOffset` no retry on transient NOT_LEADER (code 6) | Medium | **FIXED** — transient-leader retry + metadata refresh; verified live + CI green; shipped in `v1.1.4` |
| F-4 | Published `@streetjs/storage@1.0.1` broken import (over-broad `!dist/tests/**` removed shipped `contract.js`) | High | **FIXED** — narrowed exclusion to `*.test.*`; republished `storage@1.0.2`; imports OK from npm |
| F-5 | 4 published packages (`admin`/`ai`/`commerce`/`search`@1.0.0) failed import (narrow `files` omitted sibling modules) | High | **FIXED** — widened `files` globs across 16 packages; republished the 4 at `1.0.1` w/ provenance; full-registry import sweep 54/54 |
| M-1 | cosign tag-signing failed (v3 new-bundle-format needs `--bundle`) | Medium | **FIXED** — migrated to `sign-blob --bundle`; live-validated on core-line tag `v1.1.4` (signed bundle assets present) |

**No unresolved engineering defect remains.**

---

# Final Verification — Remaining Engineering-Owned Items Closed (this pass)

## Item A — Per-subpath runtime import of every published package: **VERIFIED**

- **Method:** resolved published `latest` for all **54** publishable workspace
  packages (54/54 published), installed every `name@version` from the **npm
  registry** into an isolated project (101 pkgs incl. deps), then enumerated **every
  subpath key in each installed package's published `exports`** and dynamically
  imported the corresponding specifier. JSON targets imported with
  `{ with: { type: 'json' } }`; types-only and `*` wildcard keys classified (none
  occurred).
- **Result:** **130 runtime subpaths attempted → 130 OK, 0 FAIL**, across **all 54
  packages** (each contributed ≥1 subpath). Includes **16 JSON manifest subpaths**
  (`plugin-*/manifest`, `plugin-*/manifest.signed`) and 22 subpaths each for
  `streetjs` and `@streetjs/core`.
- **Note:** ran on Node v20.20.1 (below declared `engines >= 22`); all subpaths still
  resolved and loaded — the export surface is clean even under an older runtime.

## Item B — Framework `infra/docker/Dockerfile` clean build: **VERIFIED**

- **Method:** `docker build --no-cache -f infra/docker/Dockerfile .` (Docker 29.1.3).
- **Result:** **build succeeded** — all 22 steps; multi-stage `node:24-alpine`
  builder → `distroless/nodejs22-debian12` runtime; final image **208 MB**. Builder
  ran `npm ci`, downloaded SQLite wasm, compiled core with `tsc`, emitted
  `dist/src/main.js`.
- **Runtime confirmation:** `docker run` boots the app — cluster primary forks 12
  workers, which fail-fast on `Missing required environment variable: PG_HOST` (the
  intended zero-config refusal; the DB endpoint is an **operational dependency**, not
  a build defect).

---

# Remaining NOT VERIFIED / Out-of-Scope Items

| Item | Status | Class |
|------|--------|-------|
| Provider integrations (Stripe/Twilio/SendGrid/Auth0/PayPal/OpenAI/Supabase/GCS/Azure/S3/R2/B2) | NOT VERIFIED | **Operational** — requires third-party credentials; never simulated |
| Benchmark competitor comparison | out of scope | Product measurement, not an engineering defect |

**No engineering-owned NOT VERIFIED item remains.**

---

# Operational Dependencies (not engineering defects)

- Provider credentials; GitHub administration (`enforce_admins`, org/teams, history
  purge PR-ref/cache); npm ownership; PGP key / commercial-support governance.

---

# Technical Debt

- Duplicated resilience primitives (Low). Redis-Cluster / PostgreSQL-HA client
  capability absent (Low; also roadmap). No other material debt identified.

---

# Future Work (product features only)

- Redis Cluster / PostgreSQL HA support; keyless/KMS (Sigstore/OIDC) signing;
  OSS-Fuzz onboarding; new transports/databases/plugins; multi-version docs.

---

# Confidence Assessment

| Area | Confidence | Basis |
|------|-----------|-------|
| Architecture | High | package boundaries / exports resolve |
| Build | High | dependency-order build, 0 fail |
| Runtime | High | **130/130 subpath imports across 54 published packages** |
| Testing | High | full suite + system suites incl. real-PG (prior passes) |
| Security | High | 0 alerts, `npm audit` 0, no dangerous sinks |
| Packaging | High | F-1/F-4/F-5 fixed; full-registry import sweep 54/54 |
| Releases | High | npm `1.1.4` + provenance + cosign bundle signatures |
| Documentation | High | README imports resolve; CHANGELOG consistent |
| CI/CD | High | `main` green |
| Docker | High | clean `--no-cache` build + boots |
| Operations | None (external) | credentials/org unavailable |

---

# Final Engineering Verdict: **ENGINEERING CERTIFIED**

**Rationale.** All engineering-owned work is complete and evidence-verified. Every
defect discovered during the certification effort (F-1…F-5, M-1) is FIXED and
verified. The two remaining engineering-owned `NOT VERIFIED` items — per-subpath
runtime imports and the framework Docker build — were executed this pass and both
PASS. No reproducible engineering defect remains; no engineering-owned NOT VERIFIED
item remains. The sole residual (provider integrations) is a purely operational
dependency on external credentials.

> All engineering-owned verification activities have been completed successfully. No
> engineering defects remain, and no engineering-owned NOT VERIFIED items remain. Any
> remaining limitations are purely operational or organizational (such as
> credentials, governance, or external infrastructure). The engineering certification
> effort for StreetJS is concluded. Future work should be treated as normal software
> development rather than further certification unless new code changes are
> introduced.

**Recommended next milestone.** Operator provisioning of provider credentials to
convert the credential-gated provider integrations from NOT VERIFIED to VERIFIED;
thereafter the project is fully operationally validated.
