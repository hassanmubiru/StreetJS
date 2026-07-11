---
layout: default
title: "StreetJS — Final Adversarial Closure Review"
nav_exclude: true
description: "Adversarial closure review that rebuilt conclusions from fresh evidence. Falsification succeeded: broken published packages found and fixed."
sitemap: false
noindex: true
---

# StreetJS — Final Adversarial Closure Review

**Roles:** Principal Engineer / Architect / Release Engineer / QA Lead / Security Auditor / DevOps / Maintainer
**Date:** 2026-07-11 (UTC)
**Repository:** `hassanmubiru/StreetJS` @ `main` `e64a449c`
**Method:** Adversarial — rebuilt from fresh evidence, goal was to **disprove**
completeness. Every PASS is from a command run this engagement. No inference/fabrication.

---

# Executive Summary

**The falsification SUCCEEDED. The prior certification was incorrect.** A fresh
exhaustive import of **every published package** (not just core/gateway/storage/edge
as prior passes did) revealed **four (4) reproducible HIGH-severity defects**:
`@streetjs/admin`, `@streetjs/ai`, `@streetjs/commerce`, and `@streetjs/search` at
`1.0.0` **failed to import from npm** (`ERR_MODULE_NOT_FOUND`). These were
pre-existing and had never been caught.

Root cause: an **over-restrictive `files` allowlist** (`["dist/index.js", …]`) that
shipped only `dist/index.js` and omitted sibling runtime modules that `index.js`
imports (`types.js` / `providers.js` / `internal.js`).

All four were **fixed, republished at `1.0.1` with provenance, and re-verified
importing cleanly from npm.** A final full-registry sweep now shows **54/54 packages
import OK, 0 failures.** After remediation, no reproducible engineering defect
remains.

> **Honest note:** this is the second consecutive adversarial pass to find broken
> published packages a prior "certified" report had missed (previously
> `@streetjs/storage`; now four more). The definitive defense — an **exhaustive
> import of all 54 published packages** — has now been executed and passes. That
> raises confidence materially, but the record shows the earlier certifications were
> premature.

---

# Newly Discovered Findings

## F-5 (HIGH) — four published packages broken on import (missing shipped modules)

- **Affected (published):** `@streetjs/admin@1.0.0`, `@streetjs/ai@1.0.0`,
  `@streetjs/commerce@1.0.0`, `@streetjs/search@1.0.0`.
- **Reproduction (this engagement):**
  ```
  npm install @streetjs/admin@1.0.0
  node --input-type=module -e "await import('@streetjs/admin')"
  → ERR_MODULE_NOT_FOUND: Cannot find module '.../@streetjs/admin/dist/types.js'
    imported from '.../@streetjs/admin/dist/index.js'
  ```
  (ai → `dist/providers.js`; commerce/search → `dist/internal.js`.) Confirmed the
  published tarballs omit those files (`tar -tzf` count = 0).
- **Root cause:** `package.json` `files` = `["dist/index.js","dist/index.js.map",
  "dist/index.d.ts","dist/index.d.ts.map","README.md","LICENSE"]` — only the index
  module is published; sibling modules that `dist/index.js` imports at runtime are
  excluded from the npm tarball. (The modules exist on disk after build; they are
  simply not in the publish allowlist.)
- **Severity:** HIGH — the published packages are unusable (fail on `import`).
- **Minimal fix (applied):** widen `files` to the standard globs
  `dist/**/*.{js,js.map,d.ts,d.ts.map}` + test-file exclusions
  (`!dist/**/*.test.*`), matching the other packages — applied to **all 16**
  packages that had the narrow pattern (4 confirmed-broken + 12 latent-risk /
  single-module).
- **Verification:**
  - Local: each of the 4 now packs its sibling modules, 0 `*.test.js` leak, imports OK.
  - Remediation: bumped the 4 to `1.0.1`, pushed `backend-v1.0.3`; `publish-backend`
    run `29141265428` = **success**.
  - npm re-verify: `admin/ai/commerce/search` `latest = 1.0.1`, **provenance v1**,
    fresh install + `import(...)` → **OK** (5/9/9/7 exports).
  - **Full-registry sweep:** 54/54 published packages import OK, **0 failures**.
- **Regression risk:** Low. The widen only adds already-built runtime modules to the
  tarball; `*.test.*` exclusion prevents test-file pollution (verified 0 leak). The
  12 latent packages are single-module (`dist.js`=1) or already listed extras
  (plugin-htmx); republish not required for them (their current npm versions import OK).

No other defects were found. Aside from F-5, no engineering defect was discovered
this engagement.

---

# Verified Areas (fresh commands, this engagement)

| Area | Result |
|------|--------|
| Repository state | `main`, not detached, clean, local == `origin/main` (`e64a449c`) |
| Version consistency | CHANGELOG `[1.1.3]` == core/cli `1.1.3` == npm `1.1.3`; 1 `[Unreleased]`, 0 dup versions |
| Runtime (all published) | **54/54 packages import OK from npm** (post-fix) |
| Packaging | narrow-files defect fixed; test-file exclusion holds (0 leak on the 16) |
| Release | core `1.1.3` + provenance; broken 4 republished `1.0.1` + provenance; storage `1.0.2` |
| Security | secret-scan 0, Dependabot 0, code-scan 0 open; `npm audit` **0 vulnerabilities** |
| CI/CD | latest `ci-cd.yml` on `main` = success |

---

# Remaining NOT VERIFIED Items (exact reason)

1. **Provider integrations** — credentials unavailable; not attempted/simulated.
2. **Framework `infra/docker/Dockerfile` image** — not built this engagement.
3. **Subpath-export runtime loading** — the full sweep verified each package's
   **main** entry imports; individual non-`.` export subpaths were not each imported
   this engagement (main-entry + exports-target-on-disk were verified). NOT VERIFIED
   at per-subpath runtime granularity.
4. **Benchmark competitor comparison** — only the Street measurement collected previously.

---

# Operational Dependencies (not engineering defects)

- Provider credentials (Stripe/Twilio/SendGrid/Auth0/PayPal/OpenAI/Supabase/GCS/
  Azure/S3/R2/B2), GitHub administration (`enforce_admins`, org/teams), npm ownership.

---

# Technical Debt

- Duplicated resilience primitives (Low). Redis-Cluster / PG-HA client capability
  absent (Low; also roadmap). No other material debt identified.

---

# Future Work (product features only)

- Redis Cluster / PostgreSQL HA support; keyless/KMS signing; OSS-Fuzz; new
  transports/databases/plugins; multi-version docs.

---

# Confidence Assessment

| Area | Confidence | Basis |
|------|-----------|-------|
| Architecture | High | package boundaries / exports resolve |
| Build | High | 53/53 dependency-order build (prior pass this day) |
| Runtime | **High (raised)** | **54/54 published packages import OK** this engagement |
| Testing | High | full suite 2068/0 + system suites incl. real-PG (prior passes) |
| Security | High | 0 alerts, `npm audit` 0, no dangerous sinks |
| Packaging | Medium→High | **F-5 proves prior packaging confidence was misplaced**; now fixed + full-sweep verified |
| Releases | High | npm + provenance + cosign signatures verified |
| Documentation | High | README imports resolve; CHANGELOG consistent |
| CI/CD | High | `main` green |
| Operations | None (external) | credentials/org unavailable |

---

# Final Engineering Verdict: **CONDITIONALLY CERTIFIED** (only after remediating F-5)

**Rationale.** The adversarial objective was met: four published packages were
genuinely broken (F-5), which **disproves** the prior certification as it stood — at
the point of discovery the correct verdict was **NOT COMPLETE**. All four defects
were root-caused, fixed (packaging `files` widened across 16 packages), republished
with provenance, and re-verified from npm; a full-registry import sweep now passes
**54/54**. With F-5 resolved and independently re-verified this engagement, **no
reproducible engineering defect remains**, and the only outstanding items are
external operational dependencies (provider credentials) plus narrowly-scoped
NOT VERIFIED items (per-subpath runtime, framework Docker image). That is the
**CONDITIONALLY CERTIFIED** state.

**This is not ENGINEERING CERTIFIED**, honestly, because engineering-owned
NOT VERIFIED items remain (per-subpath runtime imports were not each exercised; the
framework `infra/docker` image was not built this engagement), and because two
consecutive adversarial passes have now each surfaced real broken published
artifacts — a full ENGINEERING CERTIFIED claim would require the per-subpath runtime
verification to also be executed and pass.

**Recommended next milestone.** Add an automated **"install-and-import every
published package (including every export subpath) from the registry"** CI gate so
this defect class (packaging/exports vs. published tarball) cannot recur or escape
detection; then a subsequent pass can reach ENGINEERING CERTIFIED on evidence.
