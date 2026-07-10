---
layout: default
title: "StreetJS — Production Release Execution Report"
nav_exclude: true
description: "Evidence-only production release execution report for the StreetJS monorepo."
sitemap: false
noindex: true
---

# StreetJS — Production Release Execution Report

**Role:** Release Engineer
**Date:** 2026-07-10 (UTC)
**Repository:** `hassanmubiru/StreetJS`
**Branch / HEAD:** `main` @ `5f13c6b8`
**Discipline:** Evidence-only. Every PASS below is backed by an executed command.
Anything not independently confirmable is marked **NOT VERIFIED**. No publish,
tag, release, or version result is fabricated.

---

## Executive summary

**Release decision: RELEASE FAILED — release could not be executed.**

This is **not** a code, build, or test failure. The release could not be executed
for two independently sufficient reasons, both verified in Phase 1:

1. **npm is not authenticated** in this environment (`npm whoami` → `E401
   Unauthorized`). Publishing (Phase 7) is impossible. Per the rules, I will not
   fabricate a publish.
2. **There is no pending version to release.** The versions on `main`
   (`streetjs`/`@streetjs/core`/`@streetjs/cli` = `1.1.1`, plugins = `1.0.3`,
   framework packages = `1.0.0`) are **already published to npm and tagged**, and
   `v1.1.1` already has a published GitHub Release. Republishing identical
   versions is explicitly prohibited by the release rules.

The existing **v1.1.1 release is intact and independently verified** (npm + GitHub
Release both confirmed below). A *new* release would require a maintainer version
bump (the only unreleased delta is the `[Unreleased]` `street create` scaffold fix
in `CHANGELOG.md`) **and** valid npm authentication — neither is present here.

---

## Phase 1 — Repository validation

| Check | Result | Evidence |
|-------|:------:|----------|
| On `main` branch | ✅ | `git rev-parse --abbrev-ref HEAD` → `main` |
| Working tree clean | ✅ | `git status --porcelain` → empty |
| HEAD matches remote | ✅ | local `5f13c6b8` == `git ls-remote … refs/heads/main` `5f13c6b8` |
| No unpushed local commits | ✅ | `git log origin/main..HEAD` → empty |
| git authenticated | ✅ | HTTPS via `gh` token; pushes succeeding this session |
| **npm authenticated** | ❌ **FAIL** | `npm whoami` → `E401 Unauthorized` |
| Package versions consistent | ✅ | core line lockstep at `1.1.1`; plugins at `1.0.3` |
| Release tags present | ✅ | `git tag` shows `v1.1.1`, `plugins-v1.0.3` |

**Phase 1 abort criterion met:** npm authentication failed. Per the workflow
("Abort immediately if any fail"), no mutating release step (publish, tag push,
release creation) was performed.

---

## Phase 2 — Build verification (local, real)

Clean build of the root build target (`packages/core` + `packages/cli`; the root
`build` script is scoped to these two):

| Step | Result | Evidence |
|------|:------:|----------|
| `npm run clean` | ✅ exit 0 | /tmp build log |
| `npm run build` (core + cli, `tsc`) | ✅ exit 0 | duration 16s; `@streetjs/core` + `@streetjs/cli` compiled |

- **Packages built:** 2 (core, cli) — succeeded.
- **Failed:** 0. **Skipped:** 0.
- **NOT VERIFIED:** a fresh local clean build of all 54 workspace packages was
  **not** run in this session. Per-package builds are exercised by the CI gates
  (Runtime Certification, street CI/CD), which were green on `main` earlier this
  engagement.

---

## Phase 3 — Test verification (local, real)

| Suite | Passed | Failed | Skipped | Evidence |
|-------|:------:|:------:|:-------:|----------|
| `@streetjs/core` `test:run` | 14 | 0 | 0 | `node --test` summary: `# tests 14 / # pass 14 / # fail 0 / # skipped 0`, 10s |

- **NOT VERIFIED:** the full monorepo test suite (417 test files, 146
  property-based across all packages) was **not** re-run locally in this session.
  It is exercised by CI gates that reported `success` on `main`. No skipped tests
  are counted as passing anywhere in this report.

---

## Phase 4 — Packaging

**NOT EXECUTED.** `npm pack --dry-run` per-package packaging validation was not
performed because there is nothing to publish (all target versions already exist
on npm; see Phases 5/7). Marked **NOT VERIFIED** for this run rather than claimed.

---

## Phase 5 — Version validation

| Item | Result | Evidence |
|------|:------:|----------|
| Core line lockstep | ✅ `1.1.1` | `streetjs`, `@streetjs/core`, `@streetjs/cli` all `1.1.1` |
| Plugins version | ✅ `1.0.3` | `@streetjs/plugin-*` (sampled: stripe `1.0.3`) |
| Framework packages | ✅ `1.0.0` | e.g. `@streetjs/gateway` `1.0.0` |
| Git tag for current release | ✅ exists | `v1.1.1`, `plugins-v1.0.3` present |
| **New version to release** | ❌ none | current versions already published + tagged |

**No missing release tag to create** for the current versions. The `CHANGELOG.md`
`[Unreleased]` section (scaffold dependency fix) has **no version bump** — cutting
a new version is a maintainer decision and is out of scope for an evidence-only
release run with no npm auth.

---

## Phase 6 — GitHub release (existing state)

| Item | Result | Evidence |
|------|:------:|----------|
| `v1.1.1` Release exists | ✅ | `gh release view v1.1.1` → not draft, not prerelease, published `2026-07-08T15:05:35Z`, [release URL](https://github.com/hassanmubiru/StreetJS/releases/tag/v1.1.1) |
| `plugins-v1.0.3` Release | ⚠️ tag only | `gh release view plugins-v1.0.3` → `release not found` (git tag exists; no GitHub Release object) |

No new release was created (nothing new to release; Phase 1 abort).

---

## Phase 7 — npm publishing

**NOT PERFORMED — BLOCKED.** npm is not authenticated (`E401`). No package was
published or republished. Independently verified that the **current versions are
already on the registry** (so a publish would be a prohibited identical-version
republish regardless of auth):

| Package | npm `latest` / queried version | Status |
|---------|:------------------------------:|--------|
| `streetjs` | `1.1.1` (dist-tag `latest: 1.1.1`) | already published |
| `@streetjs/core` | `1.1.1` | already published |
| `@streetjs/cli` | `1.1.1` | already published |
| `@streetjs/plugin-stripe` | `1.0.3` | already published |
| `@streetjs/gateway` | `1.0.0` | already published |

Evidence: `npm view <pkg> version` / `npm view streetjs dist-tags`.

---

## Phase 8 — Provenance

**NOT VERIFIED this run.** No new artifacts were published, so no new provenance
was generated to verify. The repository's standing provenance controls
(`verify:signatures` fatal gate, `npm audit signatures`) are configured in CI but
were not re-executed as part of this release run.

---

## Phase 9 — GitHub Actions

No release workflow was triggered (no release performed). Standing CI on `main`
was `success` for all push-triggered workflows earlier this engagement (Runtime
Certification, CI/CD Enforcement, CodeQL, Repository policy, Repository Hygiene,
Security baseline, Scorecard, Secret Scanning, Block-private-keys, street CI/CD).
No release-specific workflow run was initiated or monitored in this run.

---

## Phase 10 — Post-release validation (existing release)

Verified the **already-published** release is installable/resolvable from npm:

- `npm view streetjs version` → `1.1.1`; `dist-tags.latest` → `1.1.1`.
- `@streetjs/core@1.1.1`, `@streetjs/cli@1.1.1`, `@streetjs/plugin-stripe@1.0.3`,
  `@streetjs/gateway@1.0.0` all resolve on the registry.

Deeper post-release checks (fresh install into a clean project, CLI run, example
run, generated-project compile) were **NOT executed** in this run — marked
**NOT VERIFIED**. (The `street create` scaffold-resolves-to-1.1.1 check was
verified in the prior engagement, per `CHANGELOG.md [Unreleased]`.)

---

## Findings

| Severity | Finding |
|----------|---------|
| **Critical** | npm not authenticated (`E401`) → publishing impossible in this environment. |
| **High** | No pending version to release: current `main` versions are already published + tagged; a new release requires a maintainer version bump. |
| **Low** | `plugins-v1.0.3` has a git tag but no corresponding GitHub Release object (cosmetic; packages are published on npm). |
| **Informational** | Local clean build (core+cli) exit 0 (16s); core `test:run` 14/14 pass, 0 skip. Existing `v1.1.1` GitHub Release + npm packages verified healthy. |

### NOT VERIFIED (could not be independently confirmed this run)
- Full 54-package clean build (only core+cli built locally; rest via CI).
- Full monorepo test suite locally (only core `test:run` run; rest via CI).
- `npm pack --dry-run` packaging contents per package (Phase 4 not executed).
- New-artifact provenance (Phase 8 — nothing new published).
- Fresh-install / CLI / example / generated-project post-release checks (Phase 10).
- npm publish success for any package (Phase 7 blocked by auth — **not** simulated).

---

## Final release decision

## RELEASE FAILED

**Reason (both independently sufficient):**
1. **npm authentication unavailable** (`npm whoami` → `E401`) — Phase 7 cannot run.
2. **Nothing to release** — `main`'s versions (`1.1.1` / `1.0.3` / `1.0.0`) are
   already published to npm, tagged, and `v1.1.1` already has a published GitHub
   Release; republishing identical versions is prohibited.

**Important:** this failure is **operational/environmental, not a quality
failure.** The local build passed, core tests passed, and the existing **v1.1.1
production release is intact and verified on both npm and GitHub**.

### To execute a genuine new release (operator steps)
1. Decide and apply a version bump (e.g. `npm run release:patch`) covering the
   `[Unreleased]` scaffold fix; update `CHANGELOG.md` + release notes.
2. Authenticate npm (`npm login` / set `NODE_AUTH_TOKEN`) as the publishing owner
   — the operator performs this; credentials are never handled here.
3. Re-run this release workflow from Phase 1; publish via the existing
   `publish-*` GitHub Actions (which carry provenance) rather than a local push.
