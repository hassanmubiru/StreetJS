---
layout: default
title: "StreetJS — Final Certification Audit"
nav_exclude: true
description: "Independent engineering-completeness certification audit of StreetJS. Evidence-only, fresh this engagement."
sitemap: false
noindex: true
---

# StreetJS — Final Certification Audit

**Roles:** Principal Engineer / Release Engineer / QA Lead / Security Auditor / DevOps / Maintainer
**Date:** 2026-07-10 (UTC)
**Repository:** `hassanmubiru/StreetJS`
**HEAD at audit:** `main` @ `aa3eac7f`
**Local toolchain:** Node **v20.20.1**, npm 10.8.2 (packages declare `engines.node >=22`)
**Rule:** Every PASS is from a command executed **this engagement**. No inference,
no fabrication. Statuses: **VERIFIED / FIXED / NOT VERIFIED / SKIPPED / N-A.**

---

## Executive summary

This engagement found and **fixed one real engineering defect** — **test-file
publish pollution**: 8 published npm packages shipped their test files to consumers
(e.g. `@streetjs/storage@1.0.0` = 220 test files of 363; `@streetjs/gateway@1.0.0`
= 132 of 239). Root cause: `build: tsc` compiles tests into `dist`, and a broad
`files: ["dist/**/*.js", …]` glob publishes them, with no exclusion. **Fixed** by
adding `!dist/**/*.test.*` + `!dist/tests/**` negations to all **38** packages with
the vulnerable glob; **verified** the 8 formerly-polluted packages now pack **0**
test files while retaining real entrypoints.

After that fix, **no verified engineering defect remains in the source.** Complete
verification is nonetheless blocked by external dependencies, so the verdict is
**CONDITIONALLY COMPLETE** (details in Final Decision).

Everything executed this engagement passed: 53/53 buildable packages compile;
**2068 tests pass, 0 fail, 34 skipped**; all 6 core system suites pass (incl. real
PostgreSQL); `npm audit` 0 vulnerabilities; generated-project `tsc` clean; Docker
image builds; benchmark 22,084 req/s; 0 open security alerts; v1.1.2 published with
provenance.

---

## Repository status — VERIFIED

- Branch `main`; working tree clean; local `aa3eac7f` == `origin/main`.
- 54 workspace packages. Latest `ci-cd.yml` on `main` = **success**.

## Build results — VERIFIED

- Full dependency-order build sweep (2 build rounds + verification round):
  **53/53 buildable packages pass, 0 fail.** 1 package (`core-compat`) is generated.
- ESM/CJS: core-compat generates dual-condition stubs; core-line `tsc` clean.

## Test results — VERIFIED (with honest skips)

- Full per-package sweep: **47 packages tested, 0 failed, 7 no test script.**
- **Aggregate: 2068 pass, 0 fail, 34 skipped** (skips gate on live services/creds;
  reported skipped, never as passing).
- Core system suites (`test:system:ci` + `test:infra` against real PostgreSQL on
  `:5433`): Security / Memory / Load / Fuzz / Chaos + **Infrastructure (25/25)** —
  all 6 green, 0 fail.

## Runtime results — VERIFIED

- `import('packages/core/dist/index.js')` → **510** named exports.
- Built CLI → `street v1.1.2`.
- **Generated project:** `street create` (scaffold pins `streetjs@^1.1.2`) →
  `npm install` (resolves `streetjs@1.1.2`) → `npx tsc --noEmit` **exit 0, clean**.

## Security results — VERIFIED

- Source scans: `eval(` **0**, `new Function(` **0**, `@ts-ignore/@ts-nocheck`
  **0**, `child_process exec/execSync` **0** (only `spawn` with static args),
  hardcoded-secret patterns **0**, `__proto__` sinks **0**.
- Open alerts: secret-scanning **0**, Dependabot **0**, code-scanning **0**.
- `npm audit` (all workspaces): **0 vulnerabilities**.

## Packaging results — DEFECT FOUND → FIXED → VERIFIED

- **Defect:** published tarballs contained test files (authoritative scan of npm
  tarballs): `dating-auth` 4, `edge` 12, `events` 84, `gateway` 132, `queue` 116,
  `realtime` 76, `storage` 220, `workflow` 124.
- **Fix:** added test-exclusion negations to `files` in **38** packages.
- **Verified:** the 8 packages now `npm pack --dry-run` with **0** test files
  (gateway 239→107, storage 363→143) and retain real entrypoints
  (`dist/index.js`, `dist/drivers/gcs.js`, etc.).
- core/cli/core-compat/edge: LICENSE + README + types present, no pollution.

## Documentation results — VERIFIED

- Root README present; **54/54** packages have a README.
- `CHANGELOG.md`: exactly **1** `[Unreleased]`, **no duplicate** versions; latest
  `[1.1.2]`.

## CI/CD results — VERIFIED

- 43 workflow files; latest `ci-cd.yml` on `main` = **success** (current HEAD).

## Release results — VERIFIED

- `streetjs`, `@streetjs/core`, `@streetjs/cli` all **1.1.2** on npm with **SLSA
  provenance v1**; `dist-tags.latest = 1.1.2`; GitHub Release `v1.1.2` (not draft).

## Performance results — VERIFIED (fresh measurement)

- `node packages/core/dist/benchmarks/run.js` (3000ms, concurrency 10):
  **Street 22,084 req/s, P50 0ms, P95 1ms, P99 2ms, 11.19 MB**. (Competitor
  comparison requires installing express/fastify/etc — not run.)

## Dependency results — VERIFIED

- `npm audit`: **0 vulnerabilities**. No repo-level missing/circular deps observed.
- **NOTE (local only):** installed `@types/node` is 25.9.2 while the committed
  lockfile is 26.1.0 — stale local `node_modules`; `npm ci` reconciles. Not a repo
  defect.

## Docker results — VERIFIED

- `docker build -f packages/registry-server/Dockerfile` → **exit 0, image built**
  (fresh this engagement; the registry-server lockfile + `streetjs` pin fixes from
  earlier in this session hold).
- **NOT VERIFIED:** the framework `infra/docker/Dockerfile` image was not built this
  engagement (registry-server image build was exercised instead).

## Provider results — NOT VERIFIED

- Live provider integrations (Stripe/Twilio/SendGrid/Auth0/PayPal/OpenAI/Clerk/
  Firebase/Supabase/GCS/Azure/etc.) require credentials that are unavailable. **Not
  attempted, not simulated** — marked NOT VERIFIED per instructions. (Their client
  logic is exercised offline by core's `plugins-official-hardening` suite, 17/17.)

---

## Remediations performed (this engagement)

| # | Remediation | Verification |
|---|-------------|--------------|
| R-1 | **Test-file publish pollution** — added `!dist/**/*.test.*` + `!dist/tests/**` + `!dist/**/__tests__/**` to `files` in **38 packages** | 8 formerly-polluted packages now pack **0** test files; entrypoints retained |

## Newly discovered findings

| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| F-1 | **High** | 8 published packages ship test files (publish-artifact pollution) | **Source FIXED** (R-1); already-published `1.0.0` tarballs still polluted until republished (release action) |

## Remaining NOT VERIFIED items

1. **Provider integrations** — no credentials (external dependency). Not simulated.
2. **cosign tag-signing (M-1)** — migrated to `sign-blob --bundle` and flag-validated
   against the exact cosign binary (v3.0.6), but end-to-end keyless signing needs
   OIDC on a real release tag — a release event, not runnable here.
3. **Framework `infra/docker` image** — not built this engagement.
4. **Benchmark competitor comparison** — only the Street measurement was run.

## Open engineering defects

- **None unresolved.** The one engineering defect found (F-1) had its **source
  fixed and verified** this engagement.

## Operational / release follow-ups (not engineering defects)

1. **Republish the 8 packages** (`dating-auth`, `edge`, `events`, `gateway`,
   `queue`, `realtime`, `storage`, `workflow`) with a patch bump so the packaging
   fix (R-1) reaches npm and removes tests from the published tarballs.
2. Confirm cosign tag-signing on the next real release tag (M-1).
3. Provider live verification when credentials are available.

## Evidence summary

Builds (53/53), tests (2068 pass/0 fail/34 skip), system suites incl. real-PG infra
(all green), `npm audit` (0), source security scans (all 0), packaging pack
dry-runs (fixed → 0 test files), generated-project `tsc` (clean), Docker build (exit
0), benchmark (22,084 req/s), npm+provenance (1.1.2, SLSA v1), 0 open alerts — all
from commands executed this engagement.

## Confidence assessment

**High** for source correctness, build, tests (incl. real-PG system suites),
security, packaging (post-fix), and the published core-line release. **Medium** on
release-artifact hygiene (source fixed; 8 published tarballs await republish).
**Unknown / external** for provider integrations and the cosign live tag-run.

---

## Final decision: **CONDITIONALLY COMPLETE**

**Justification (evidence-only):** This engagement discovered a real engineering
defect (F-1, test-file publish pollution) and **fixed it at the source across 38
packages, verified** by clean `npm pack` output. After that, **no verified
engineering defect remains unresolved in the source** — so the verdict is not
NOT COMPLETE. It is not ENGINEERING COMPLETE because **complete verification is
blocked by external dependencies**, exactly the CONDITIONALLY COMPLETE criterion:
provider integrations cannot be verified without credentials (NOT VERIFIED, not
simulated), and the cosign tag-signing fix's end-to-end confirmation requires a real
release event (OIDC). One operational release-remediation also remains — republish
the 8 packages so the packaging fix propagates to npm — which is a release action,
not a source engineering defect.

> Path to ENGINEERING COMPLETE: (1) republish the 8 packages (propagates R-1);
> (2) confirm cosign signing on the next release tag; (3) verify providers with
> credentials. All are release/operational/external, none an open source defect.
