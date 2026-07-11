---
layout: default
title: "StreetJS — Final Independent Falsification Audit"
nav_exclude: true
description: "Adversarial last-pass audit attempting to disprove engineering-completeness. Evidence-only."
sitemap: false
noindex: true
---

# StreetJS — Final Independent Falsification Audit (Last Pass)

**Roles:** Principal Engineer / Security Auditor / Release Engineer / QA Lead / Maintainer
**Date:** 2026-07-11 (UTC)
**Repository:** `hassanmubiru/StreetJS`
**HEAD at start:** `main` @ `c2cf098f` → **at conclusion:** `main` @ `a94de6b5`
**Local toolchain:** Node v20.20.1, npm 10.8.2 (packages declare `engines.node >=22`).
**Method:** Adversarial. Goal was to **prove the repository is NOT complete**. Every
PASS is from a command executed this engagement. No inference, no fabrication.

---

## Executive summary

**The falsification succeeded: a real, reproducible HIGH-severity engineering defect
was found** — the published `@streetjs/storage@1.0.1` **failed to import**
(`ERR_MODULE_NOT_FOUND`). It was **caused by the immediately-preceding engagement's
own packaging fix** (the `!dist/tests/**` exclusion removed a *shipped runtime*
module). This directly disproves the prior "no engineering defect" conclusion as it
stood.

The defect was then **root-caused, fixed (minimal), verified locally, republished as
`@streetjs/storage@1.0.2`, and re-verified from npm**. After remediation, no
reproducible engineering defect remains; the residual is external (provider
credentials). Final verdict: **CONDITIONALLY COMPLETE** — but only *after* the fix;
the prior state was **defective**.

---

## Newly discovered findings

### F-4 (HIGH) — published `@streetjs/storage@1.0.1` broken on import
- **Evidence (reproduction):**
  ```
  npm install @streetjs/storage@1.0.1
  node --input-type=module -e "await import('@streetjs/storage')"
  → FAIL ERR_MODULE_NOT_FOUND: Cannot find module
    '.../@streetjs/storage/dist/tests/contract.js'
    imported from '.../@streetjs/storage/dist/cli/commands.js'
  ```
- **Location / root cause:** `packages/storage/src/cli/commands.ts:31-32` imports
  `../tests/contract.js` — a **shipped runtime support module** (its own header says
  "a support module under `src/tests/` (not itself a `*.test.js`)"). The prior F-1
  packaging fix added `!dist/tests/**` to the `files` allowlist, which excluded
  `dist/tests/contract.js` from the published tarball while production code still
  imports it → the published package cannot load.
- **Blast radius (verified):** a repo-wide scan for production (non-test) source
  importing a `/tests/` or `/__tests__/` path returned **only `storage`**. Other
  packages import cleanly (verified: `@streetjs/gateway@1.0.1`, `@streetjs/edge@1.0.1`,
  core line — all OK).
- **Minimal fix (applied):** narrow the exclusion to actual test *files*. Dropped the
  over-broad directory negations `!dist/tests/**` and `!dist/**/__tests__/**` across
  the 38 packages that had them, keeping the precise file patterns
  `!dist/**/*.test.{js,js.map,d.ts,d.ts.map}`. This still excludes every `*.test.*`
  while retaining non-test modules like `contract.js`.
- **FIXED + verified:**
  - Local: storage packs `dist/tests/contract.js` present, `*.test.js` = 0; main
    imports OK (46 exports); the previously-failing `dist/cli/commands.js` loads.
  - Regression: all 8 previously-republished packages re-checked — **0 `*.test.js`
    in tarball, import OK** for each.
  - Remediation: bumped `storage → 1.0.2`, pushed `backend-v1.0.2`; `publish-backend`
    run `29139856891` = **success**.
  - **npm re-verification:** `@streetjs/storage` `latest = 1.0.2`, **SLSA provenance
    v1**; fresh `npm install @streetjs/storage@1.0.2` + `import('@streetjs/storage')`
    → **OK, 46 exports**; `contract.js` present, `*.test.js` = 0.

> No other findings were discovered. Aside from F-4, **no engineering defects were
> discovered during this engagement.**

---

## Verified areas (fresh commands this engagement)

| Area | Result |
|------|--------|
| Repo integrity | `main`, not detached, working tree clean, local == `origin/main` (`a94de6b5`) |
| TS escape hatches (prod src) | `@ts-ignore` 0, `@ts-nocheck` 0; the 3 `@ts-expect-error` are in a `.test-d.ts` **negative type-test** (intentional) |
| Exports integrity | **394/394** `main`/`types`/`exports` targets resolve to real built files (0 missing) |
| README imports | **209/209** streetjs-import specifiers in package READMEs resolve to declared exports (0 dangling) |
| Security source scans | `eval` 0, `new Function` 0, `exec/execSync` 0 (only `spawn`), hardcoded-secret patterns 0, `__proto__` sinks 0 |
| Security alerts | secret-scanning 0, Dependabot 0, code-scanning 0 (open) |
| `npm audit` | **0 vulnerabilities** |
| Packaging | core/cli/core-compat/gateway/storage pack clean (post-fix), LICENSE/README/types present |
| Runtime (published) | `streetjs@1.1.3` 510 exports, `@streetjs/core@1.1.3` 510, `@streetjs/cli@1.1.3` → `street v1.1.3`, `@streetjs/gateway@1.0.1`/`@streetjs/edge@1.0.1` import OK |
| Generated project | `street create` → `npm install` (streetjs 1.1.3) → `tsc --noEmit` exit 0 |
| Release | core 1.1.3 + provenance; `v1.1.3` GitHub Release carries cosign `.cosign.bundle` signed assets |
| CI | latest `ci-cd.yml` on `main` = success |
| Performance (fresh) | Street HTTP benchmark ~20,136 req/s (this engagement) |
| Docker | (prior engagement built registry-server image exit 0; see Not Verified) |

---

## Remaining NOT VERIFIED items (exact reason)

1. **Provider integrations** (Stripe/Twilio/SendGrid/Auth0/PayPal/OpenAI/Supabase/
   GCS/Azure/S3/R2/B2) — **credentials unavailable**; not attempted, not simulated.
2. **Framework `infra/docker/Dockerfile` image** — not built this engagement (only
   the `registry-server` Dockerfile was built, in the prior engagement).
3. **Benchmark competitor comparison** — only the Street measurement was collected;
   express/fastify/nest/hono not installed this engagement.
4. **`v1.1.3` tag CI run** — historical failure predating the F-2/F-3 fixes; a tag run
   is immutable and superseded by green `main`. Not re-runnable with the fixes.

---

## Confidence assessment (per area)

| Area | Confidence | Basis |
|------|-----------|-------|
| Source correctness / types | High | strict TS, 0 ignores, exports+README integrity verified |
| Build | High | 53/53 dependency-order build |
| Tests | High | 2068 pass / 0 fail; 6/6 system suites incl. real-PG infra (prior pass this day) |
| Security | High | 0 alerts, 0 dangerous sinks, `npm audit` 0 |
| Packaging | High (post-fix) | pack dry-runs clean; **F-4 proves this needed the fix** |
| Release / provenance / signatures | High | npm versions + SLSA + cosign bundles verified from registry |
| Published-artifact runtime | High (post-fix) | fresh installs import OK incl. the fixed storage@1.0.2 |
| Providers | None (external) | no credentials |
| Docker (full framework image) | Low | not built this engagement |

---

## Final decision: **CONDITIONALLY COMPLETE** (only after remediation of F-4)

**Justification.** The adversarial objective — disprove completeness — **was met**:
`@streetjs/storage@1.0.1` was a genuine, reproducible HIGH engineering defect
(broken import), introduced by the prior packaging fix. Had this audit stopped at
discovery, the correct verdict would be **NOT COMPLETE**. The defect was root-caused,
minimally fixed, verified locally with a regression check, republished as
`@streetjs/storage@1.0.2`, and **re-verified importing cleanly from npm with
provenance**. With F-4 resolved and re-verified, **no reproducible engineering
defect remains**, and the only unverifiable items are external (provider
credentials) — the CONDITIONALLY COMPLETE criterion.

**This audit demonstrates why the falsification pass mattered:** the immediately
preceding "CONDITIONALLY COMPLETE — no engineering defect" conclusion was, at the
time it was written, **incorrect** — a published package was broken. It is only
accurate now, after the fix landed and was verified this engagement.
