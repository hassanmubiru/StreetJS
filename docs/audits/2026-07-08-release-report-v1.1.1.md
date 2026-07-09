---
layout: default
title: "Release Report — v1.1.1 (2026-07-08)"
nav_exclude: true
description: "Release-manager engagement report for StreetJS v1.1.1: verified evidence, defects fixed, and final release decision."
sitemap:     false
noindex:     true
---

# StreetJS Release Report — v1.1.1

**Released:** 2026-07-08
**Final commit:** `2b11f049cc39c923d22c2d7694101f65a37ae90f` (`main`)
**Tag:** [`v1.1.1`](https://github.com/hassanmubiru/StreetJS/releases/tag/v1.1.1)
**Packages published:** `streetjs@1.1.1`, `@streetjs/core@1.1.1` (compat shim), `@streetjs/cli@1.1.1` — verified live on the npm registry with real SLSA provenance attestations.
**Method:** Evidence-only. Every claim below is backed by an executed command, a real GitHub Actions run, or an explicit `NOT VERIFIED`. No result was assumed or fabricated.

---

## Executive Summary

**Release status: RELEASED.** v1.1.1 is live on npm (lockstep across all three packages, provenance-attested), tagged, and published as a GitHub Release. Every GitHub Actions workflow on `main` at the release commit is green, including `Release Engineering Enforcement` running for real (not skipped) on the release event with live-derived security/coverage evidence.

**Defects found and fixed this engagement:**
1. **Critical** — path traversal in `@streetjs/storage`'s `LocalStorageDriver`
2. **Medium** — missing `LICENSE` file in 26 published npm tarballs
3. **High** — `Secret Scanning` CI gate red on `main` (Gitleaks false positive)
4. **High** — `Repository policy` CI gate red on `main` (stray files + misplaced template)
5. **Medium** — scale-dependent false-failure in the WebSocket-scale test harness

**Remaining open item:** one finding from a prior independent audit (missing `@types/ws` breaking the documented Quick Start) could not be reproduced under repeated, careful retesting this session. It is not claimed fixed — logged as item #33 in `plans/OUTSTANDING-ACTIONS.md` for future re-investigation if it recurs.

**Overall readiness: READY.** No known unresolved defects block this release. All required release gates were either verified passing or fixed and re-verified.

---

## Findings Table

| ID | Severity | Description | Evidence | Status | Recommendation |
|---|---|---|---|---|---|
| F-1 | Critical | Path traversal in `LocalStorageDriver.objectPath()`/`metaPath()` — `path.join(root, key)` with no containment check let `../`-escaping or absolute-path keys read/write arbitrary filesystem locations | Live-reproduced exploit (`put('../victim/pwned.txt', ...)` wrote outside root); fix verified by re-running the same exploit (now throws `ValidationError`, no file created) | **FIXED + VERIFIED** | Closed. 4 new regression tests added (`packages/storage/src/tests/local-driver.test.ts`) |
| F-2 | Medium | 26 published packages (including `streetjs` itself) declared `"license": "MIT"` but shipped no `LICENSE` file in their npm tarball | `npm pack --dry-run` before/after on `packages/core` and 3 other spot-checked packages; confirmed missing → present | **FIXED + VERIFIED** | Closed. `LICENSE` copied into each package dir + added to each `files` array |
| F-3 | High | `Secret Scanning` GitHub Actions gate failing on `main` — Gitleaks flagged `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==` in two deleted debug scripts as `generic-api-key` | Downloaded the exact gitleaks 8.30.1 binary CI uses; confirmed the flagged value is RFC 6455's own published example handshake nonce, not a secret; reproduced 0-leak result locally and live on CI post-fix | **FIXED + VERIFIED** | Closed. Added to `.gitleaks.toml` allowlist with rationale comment |
| F-4 | High | `Repository policy` gate failing — 3 unapproved files at repo root: `npm`, `tsc` (stray 0-byte tracked files) and `release-inputs.template.json` (real file, wrong location) | Local allowlist re-implementation found the 3 files; `git log --diff-filter=A` confirmed `npm`/`tsc` were accidental commits; live CI run post-fix: `success` | **FIXED + VERIFIED** | Closed. Removed the 2 stray files; moved the template to `scripts/release/` |
| F-5 | Medium | `scripts/audit/ws-scale.mjs` used a fixed 500ms post-close wait regardless of connection count, causing a false "server leaked N clients" failure at 10,000 connections on a loaded CI runner | CI run showed `serverClientsAfterClose: 10000` at N=10000 while N=1000/5000 passed; 3 consecutive local runs at N=10000 all showed `serverClientsAfterClose: 0`, proving the server-side cleanup itself was correct; re-verified live on CI post-fix (all 3 matrix points green) | **FIXED + VERIFIED** | Closed. Harness now polls for `clients.size === 0` up to 10s instead of a fixed wait |
| F-6 | Low | `npm run build`'s `tsconfig.lib.json` excludes `tests/`, so `dist/tests/integration.test.js` (the file `package.json`'s own `test` script targets) doesn't exist after a plain `build` — only a full `tsc` (base `tsconfig.json`) produces it | Reproduced directly: absent after `build`, present after plain `tsc` | Informational, not fixed | Document the two-build split, or have `test`/`coverage` scripts depend on a build step that includes tests |
| F-7 | Low | One `Backward Compatibility Regression (22)` CI job failure traced to a transient module-load issue in a long combined test invocation | Re-ran the same job on the same commit: passed. Parallel `CLI Unit + Migration` jobs at the same commit passed on first try | Confirmed transient, no fix needed | None — monitor for recurrence |
| F-8 | Medium (unresolved) | Prior independent audit reported `@types/ws` missing breaks `tsc` for Quick-Start users importing `streetjs`'s websocket subpath | Retested repeatedly (fresh installs, `NodeNext`+strict, with/without declaration emit, direct subpath import, class instantiation) — did not reproduce in any configuration tried | **NOT VERIFIED — unreproduced, not resolved** | Logged as item #33 in `plans/OUTSTANDING-ACTIONS.md`; needs a real user's exact environment to isolate if it recurs |
| F-9 | Informational | `v1.1.0` git tag collided with an unrelated prior `@streetjs/plugin-marzpay v1.1.0` release — the repo's tags share one flat `v*` namespace across the core framework and independently-versioned plugins | `git tag -a v1.1.0` failed with "tag already exists"; `git show v1.1.0` confirmed it belonged to the plugin release (2026-06-25) | Resolved by version choice, not a code fix | Released as `1.1.1` instead. Consider a tag-prefix convention (e.g. `plugin-marzpay-v*`) to prevent recurrence |

---

## Verification Summary

| Gate | Status |
|---|---|
| Repository (clean tree, correct branch/commit, version lockstep) | ✅ VERIFIED |
| Build (core, cli — lib and app layouts) | ✅ VERIFIED |
| Tests (core: 14/14 integration; cli: 348/349 + 56/56, 1 honest skip; storage: 367/374, 7 honest credential-gated skips) | ✅ VERIFIED |
| Runtime (CLI entrypoint, `street doctor`, generated-project smoke checks) | ✅ VERIFIED |
| Documentation (README Quick Start reproduced end-to-end; CHANGELOG restructured and validated) | ✅ VERIFIED |
| Security (`npm audit` 0 vulnerabilities; no `eval`/`new Function`; path-traversal fixed; no hardcoded credentials found) | ✅ VERIFIED |
| Packaging (`npm pack` contents, `LICENSE`, `exports`, version lockstep, provenance) | ✅ VERIFIED |
| Release Engineering (semver, changelog entry, live scorecard: security 78, reliability 75, coverage 78.42, performance 70 — all ≥ threshold) | ✅ VERIFIED |
| CI (every workflow on `main` at the release commit) | ✅ VERIFIED |
| GitHub (tag pushed + pre-push-hook-verified; Release published, not draft/prerelease) | ✅ VERIFIED |
| npm (all 3 packages live at 1.1.1, provenance attestations confirmed) | ✅ VERIFIED |
| Cloud Providers (Azure/GCS/Backblaze/Supabase live integration) | ⛔ NOT VERIFIED — provider credentials unavailable in this environment |
| Quick-Start `@types/ws` finding (F-8) | ⛔ NOT VERIFIED — unreproduced |

---

## Metrics

- **Packages built:** 2 directly (`core`, `cli`) + 1 no-build shim (`core-compat`); plus `plugin-marzpay`, `registry-server`, `storage`, `realtime` built as test dependencies during verification
- **Packages published this release:** 3 (`streetjs`, `@streetjs/core`, `@streetjs/cli`)
- **Tests passed:** 14 (core integration) + 348 (cli batch 1) + 56 (cli batch 2) + 367 (storage) = **785**
- **Tests failed:** 0
- **Tests skipped (honest, documented):** 1 (cli, no `node:sqlite` on Node 20) + 7 (storage, no live cloud credentials) = **8**
- **Workflows executed (this session):** `secret-scan.yml`, `repository-policy.yml`, `ci-cd-enforcement.yml` (×2, incl. release event), `ci-cd.yml` (`street CI/CD`), `soak-scale-chaos.yml`, `runtime-certification.yml`, plus passive confirmation of `repo-hygiene.yml`, `codeql.yml`, `scorecard.yml`, `block-private-keys.yml`
- **GitHub Actions runs inspected/dispatched:** 15+
- **npm publishes:** 3 (via the existing `test-and-publish` job on push to `main`, not manual)
- **Defects fixed:** 5 (F-1 through F-5)
- **Defects found, not fixed (informational/transient):** 2 (F-6, F-7)
- **Defects unreproduced:** 1 (F-8)
- **Files changed this session:** `packages/storage/src/drivers/local.ts`, `packages/storage/src/tests/local-driver.test.ts`, 26× package `LICENSE` (new) + `package.json` (`files` array), `.gitleaks.toml`, `scripts/release/release-inputs.template.json` (moved), `scripts/release/derive-inputs.mjs`, `scripts/audit/ws-scale.mjs`, `docs/PRODUCTION-HARDENING-PROGRAM.md`, `CHANGELOG.md`, `packages/core/package.json`, `packages/cli/package.json`, `packages/core-compat/package.json`, `plans/OUTSTANDING-ACTIONS.md`, root `npm`/`tsc` (deleted)

---

## Outstanding Items

**Engineering work:**
- Item #33 (`plans/OUTSTANDING-ACTIONS.md`) — the `@types/ws` Quick-Start finding, unreproduced this session, needs a real affected user's environment to isolate if it recurs.
- F-6 — the `build` vs `test:run` script split for `packages/core` is a minor DX trap, not fixed, documented only.

**Infrastructure limitations (not defects):**
- Real cloud/vendor provider integration (Azure Blob, GCS, Backblaze B2, Supabase live round-trips) remains `NOT VERIFIED` — no credentials available in this environment. Not a software defect; tracked separately in prior audit history.

**Release management tasks (not started, optional):**
- Consider a tag-naming convention (e.g. prefixing plugin release tags) to prevent future `v*` collisions like the one hit with `v1.1.0`.

---

## Final Decision

# READY

**Justification:** Every required release gate was either directly verified passing or, where a genuine defect was found, fixed and re-verified with fresh evidence (including live GitHub Actions runs at the exact release commit). The one Critical finding (path traversal) was fixed, exploit-reproduced-then-blocked, and regression-tested before the version was bumped or anything was published. The release itself is confirmed live on the npm registry with valid provenance, correctly tagged, and published as a GitHub Release. The single remaining open item (F-8) is explicitly non-blocking: it could not be reproduced despite genuine effort, is not silently dropped, and is durably tracked for future investigation rather than being papered over.
