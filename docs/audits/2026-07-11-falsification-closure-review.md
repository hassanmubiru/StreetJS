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

---

# Addendum — Post-Review Follow-up (2026-07-11, later same day)

After the closure review above, three follow-up items were executed and verified
with fresh commands this engagement.

## 1. Branch reconciliation — no outstanding branches to merge

Checked exhaustively:

- `git ls-remote --heads origin` → **only `main`**.
- `gh api repos/hassanmubiru/StreetJS/branches` → **only `main`**.
- `gh pr list --state open` → **0 open PRs** (all 40+ historical PRs are MERGED or CLOSED).

The only non-`main` refs were two **stale local-only** branches,
`ci/gate-plugin-hardening-tests` (`acac5c59`) and
`test/tls-handshake-integration-suite` (`d0c81e54`), both 1087 commits behind
`main`. Their content is already fully integrated: the 5 TLS/webhook `*.it.test.mjs`
files are **byte-identical** to `main` (0-line diff), and their only differing file,
`.github/workflows/tls-integration.yml`, is **older** on the branch (it would
downgrade `actions/checkout` v7→v6 and Node 22→20). Merging was therefore either a
no-op or a regression. Both branches were **deleted** (reflog-recoverable at the
SHAs above). Local branches are now `main` + `gh-pages` only; working tree clean;
local `main` == `origin/main`.

## 2. CI pipeline — `main` green; the only 2 failures were stale tag runs

Across the last 200 workflow runs, exactly **2 failures** existed, both on the
immutable **`v1.1.3` tag** (runs from 02:24 UTC):

- **Kafka Integration** — `listOffsets failed with error code 6`
  (`NOT_LEADER_FOR_PARTITION`). The transient-leader **retry loop is present on
  `main`** (`packages/core/src/transports/kafka/client.ts`).
- **street CI/CD certification** — `files must not publish tests: !dist/tests/**`
  (the `files`-allowlist / certification-negation issue, also fixed on `main`).

That tag was later re-pointed to a commit that is an ancestor of `main`; both fixes
landed afterward. Every workflow's **latest run on `main` reports success**
(`Soak / Scale / Chaos` is a scheduled long-running job, not a failure). No
reproducible pipeline failure represents a live defect.

## 3. Clean release snapshot — `v1.1.4` cut

Because the published `v1.1.3` tag predated the Kafka retry fix, a clean patch
release was cut so the published line carries it (published tags are never
re-pointed). Verified this engagement:

- Lockstep trio bumped `1.1.3 → 1.1.4` (`streetjs` / `@streetjs/core` /
  `@streetjs/cli`) via `scripts/release.sh patch`; lockstep confirmed by
  `check-tag-version.mjs` + pre-push hook.
- `ci-cd.yml` on `main` (run `29142205092`) = **success** — CLI suite passed on
  Node 22 (the local Node-20 `dist/main.js` stderr was an environment artifact; 0
  test assertions failed), all three packages published, **provenance verified**.
- npm re-verify: `streetjs` / `@streetjs/core` / `@streetjs/cli` `latest = 1.1.4`,
  **provenance: OK** on all three.
- Tag `v1.1.4` (`de5cf355`) pushed; tag-triggered run `29142403633` = **success** —
  cosign steps ran; **signed GitHub Release `v1.1.4`** published (non-draft) with 3
  tarballs, 3 `*.cosign.bundle` files, and `sbom-v1.1.4.json`.

**CHANGELOG** updated with a `[1.1.4] - 2026-07-11` entry (Kafka `listOffset`
retry; clean-snapshot note).

**Net effect on verdict:** unchanged — **CONDITIONALLY CERTIFIED**. This follow-up
removed stale branches, confirmed the pipeline carries no live defect, and produced
a provenance-signed `v1.1.4` release; it did not add or resolve any engineering-owned
NOT VERIFIED item (per-subpath runtime and the framework Docker image remain as
listed above).

---

# Final Engineering Verification — Remaining NOT VERIFIED Items Closed (2026-07-11)

This pass targeted **only** the two engineering-owned `NOT VERIFIED` items that
remained after the closure review above. Both were executed with fresh commands
this engagement and both **PASS**.

## Item A — Per-subpath runtime import of every published package: **VERIFIED**

- **Method:** resolved the published `latest` of all **54** publishable workspace
  packages (`npm view <name> version` → 54/54 published), installed every
  `name@version` from the **npm registry** into an isolated project
  (`/tmp/subpath-verify`, 101 pkgs incl. deps), then for each installed package
  enumerated **every subpath key in its published `exports`** and dynamically
  imported the corresponding specifier. JSON targets were imported with
  `{ with: { type: 'json' } }`; `.d.ts`-only (types-only) and `*` wildcard
  pattern keys were classified (none occurred).
- **Result:** **130 runtime subpaths attempted → 130 OK, 0 FAIL**, spanning
  **all 54 packages** (every package contributed ≥1 runtime subpath). Includes
  **16 JSON manifest subpaths** (`plugin-*/manifest`, `plugin-*/manifest.signed`)
  loaded with the JSON type attribute, and deep coverage of the core surface
  (`streetjs` and `@streetjs/core` = 22 subpaths each).
- **Note (strengthens the result):** the sweep ran on **Node v20.20.1**, below the
  packages' declared `engines >= 22` — every subpath still resolved and loaded, so
  the published export surface is clean even under an older-than-declared runtime.
- **Disposition:** the "Subpath-export runtime loading" item (previously
  NOT VERIFIED #3) is **VERIFIED**. No defect found.

## Item B — Framework `infra/docker/Dockerfile` clean build: **VERIFIED**

- **Method:** `docker build --no-cache -f infra/docker/Dockerfile -t
  streetjs-framework:verify-1.1.4 .` from the repo root (Docker 29.1.3).
- **Result:** **build succeeded** — all 22 steps, multi-stage
  (`node:24-alpine` builder → `distroless/nodejs22-debian12` runtime); final image
  **208 MB**. The builder stage ran `npm ci`, downloaded the SQLite wasm asset,
  compiled core with `tsc`, and emitted `dist/src/main.js`.
- **Runtime confirmation:** `docker run` of the image boots the app in the
  distroless runtime — the cluster primary starts and forks 12 workers; each worker
  then **fail-fasts** with `Missing required environment variable: PG_HOST`. That is
  the app's intended zero-config-refusal behavior (a required DB endpoint is an
  **operational dependency**, not a build/engineering defect); the image itself
  builds, ships `dist/src/main.js`, and executes correctly.
- **Disposition:** the "Framework `infra/docker` image" item (previously
  NOT VERIFIED #2) is **VERIFIED**. No defect found.

## Remaining items after this pass

| Prior NOT VERIFIED item | Status now | Class |
|---|---|---|
| #1 Provider integrations (Stripe/Twilio/…/GCS/Azure/S3) | still NOT VERIFIED | **Operational** — requires third-party credentials; cannot be run without them (never simulated) |
| #2 Framework `infra/docker` image | **VERIFIED** | Engineering — closed this pass |
| #3 Per-subpath runtime loading | **VERIFIED** | Engineering — closed this pass |
| #4 Benchmark competitor comparison | out of scope | Product measurement, not an engineering defect (explicitly excluded from this pass) |

**No engineering-owned `NOT VERIFIED` item remains.** The only outstanding item is
provider integrations, which is purely operational (external credentials).

# Revised Final Engineering Verdict: **ENGINEERING CERTIFIED**

Both remaining engineering-owned verification activities have now been executed and
passed with fresh evidence (130/130 per-subpath imports across all 54 published
packages; a clean `--no-cache` Docker build that also boots). No engineering defect
was found. No engineering-owned `NOT VERIFIED` item remains; the sole residual
(provider integrations) is an operational dependency on external credentials.

> All engineering-owned verification activities have been completed successfully. No
> engineering defects remain, and no engineering-owned NOT VERIFIED items remain. Any
> remaining limitations are purely operational or organizational (such as
> credentials, governance, or external infrastructure). The engineering certification
> effort for StreetJS is concluded. Future work should be treated as normal software
> development rather than further certification unless new code changes are
> introduced.
