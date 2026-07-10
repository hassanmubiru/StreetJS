---
layout: default
title: "StreetJS — Release Execution Report"
nav_exclude: true
description: "Evidence-only production release execution for the StreetJS monorepo."
sitemap: false
noindex: true
---

# StreetJS — Production Release Execution Report

**Role:** Release Engineer
**Date:** 2026-07-10 (UTC)
**Repository:** `hassanmubiru/StreetJS`
**Branch / HEAD:** `main` @ `e8e528d9`
**Rule:** Evidence-only. Every PASS is backed by a command executed **in this
session**. Prior reports are historical context only and are not relied upon.
No publish, tag, release, provenance, CI, or version result is fabricated. Steps
not executed are reported **NOT VERIFIED**, never as passing.

---

## Executive summary

**Release status: RELEASE FAILED — release not required and blocked by an invalid
changelog. Stopped at Phase 3 per the workflow's "if invalid: STOP" rule.**

npm authentication is now working (`npm whoami` → `error51`, verified owner of the
packages), so the earlier auth blocker is cleared. However, execution stopped for
two independent, evidence-backed reasons:

1. **Phase 2 — nothing to publish.** All **54** publishable packages have a local
   version **identical** to the version already on npm. Per the rules ("If current
   versions already exist on npm: DO NOT REPUBLISH" / "Never overwrite an existing
   npm version"), **no package requires publishing** at the current committed
   versions. A release would require a new version bump, which is a maintainer
   decision (version number + lockstep scope) and was not authorized.
2. **Phase 3 — CHANGELOG is invalid.** `CHANGELOG.md` contains **duplicate
   version sections**: `## [Unreleased]` appears **twice** (lines 10 and 359) and
   `## [1.0.3]` appears **twice** with different dates (lines 494 `2026-05-29`,
   552 `2026-05-28`). The workflow requires "no duplicate version — if invalid:
   STOP."

No build, test, packaging, publish, tag, or release action was performed.

---

## Phase 1 — Repository validation (executed this session)

| Check | Result | Evidence |
|-------|:------:|----------|
| Current branch | ✅ `main` | `git rev-parse --abbrev-ref HEAD` → `main` |
| Working tree clean | ✅ | `git status --porcelain` → (empty) |
| No uncommitted changes | ✅ | `git status --porcelain` → (empty) |
| HEAD synced with origin | ✅ | local `e8e528d9` == `git ls-remote … refs/heads/main` `e8e528d9` |
| No unpushed commits | ✅ | `git log origin/main..HEAD` → (empty) |
| git authentication | ✅ | HTTPS via gh token; pushes succeeding this session |
| GitHub authentication | ✅ | `gh auth status` → `hassanmubiru`, scopes `gist, read:org, repo, workflow` |
| npm authentication | ✅ | `npm whoami` → `error51` |
| Repository / publish permission | ✅ | `npm owner ls streetjs` → `error51 <hassanteeb7@gmail.com>`; `npm access list packages` → all `@streetjs/*` `read-write` |

**Phase 1: PASS.**

---

## Phase 2 — Version validation (executed this session)

Compared every publishable package's local `package.json` version against the
version currently on npm (`npm view <pkg> version`). **Result: all 54 MATCH.**

- Publishable packages checked: **54**
- Already published at current version (MATCH): **54**
- New (never published): **0**
- Local ≠ npm (DIFF): **0**

Representative rows (full table generated this session; all rows `MATCH`):

| Package | Local | npm | State |
|---------|-------|-----|-------|
| `streetjs` | 1.1.1 | 1.1.1 | MATCH |
| `@streetjs/core` | 1.1.1 | 1.1.1 | MATCH |
| `@streetjs/cli` | 1.1.1 | 1.1.1 | MATCH |
| `@streetjs/gateway` | 1.0.0 | 1.0.0 | MATCH |
| `@streetjs/storage` | 1.0.0 | 1.0.0 | MATCH |
| `@streetjs/plugin-stripe` | 1.0.3 | 1.0.3 | MATCH |
| `@streetjs/plugin-marzpay` | 1.1.0 | 1.1.0 | MATCH |
| … (48 more) | = | = | MATCH |

**Determination:** No package requires publishing. A release would require a
**version bump**. The only unreleased delta in `CHANGELOG.md` `[Unreleased]` is the
`street create` scaffold-dependency fix (`^1.0.6` → `^1.1.1` in
`packages/cli/src/commands/create.ts`) — this would warrant a patch bump of the
`streetjs`/`@streetjs/core`/`@streetjs/cli` lockstep line (1.1.1 → 1.1.2), but that
is a maintainer decision and was not authorized in this run. **DO NOT REPUBLISH
existing versions.**

---

## Phase 3 — Changelog validation (executed this session)

`grep -nE '^## ' CHANGELOG.md` and `grep -cE '^## \[Unreleased\]' CHANGELOG.md`:

| Check | Result | Evidence |
|-------|:------:|----------|
| `[Unreleased]` section exists | ✅ | present at line 10 |
| No duplicate version | ❌ **FAIL** | `## [Unreleased]` ×2 (lines 10, 359); `## [1.0.3]` ×2 (lines 494 `2026-05-29`, 552 `2026-05-28`) |

**Phase 3: FAIL → STOP.** The changelog is invalid (duplicate sections). Per the
workflow this halts the release. Resolving it correctly (which unreleased entries
belong to which version; reconciling the two `1.0.3` blocks) requires maintainer
knowledge of release history and was not auto-fixed to avoid misattributing shipped
work.

---

## Phases 4–11 — NOT EXECUTED

Halted at the Phase 3 failure (and Phase 2 "nothing to publish"). The following
were **not executed this session** and are **NOT VERIFIED** (none counted as
passing):

| Phase | Status |
|-------|--------|
| 4 — Clean build | NOT VERIFIED (not executed this session) |
| 5 — Tests | NOT VERIFIED (not executed this session) |
| 6 — Packaging (`npm pack --dry-run`) | NOT VERIFIED (not executed this session) |
| 7 — Publish | NOT PERFORMED (no package requires publishing) |
| 8 — Git tags | NOT PERFORMED |
| 9 — GitHub Release | NOT PERFORMED |
| 10 — GitHub Actions | NOT PERFORMED |
| 11 — Post-release validation | NOT VERIFIED (nothing released this session) |

---

## Phase 12 — Final report

### Repository state (verified this session)
- Branch `main`; HEAD `e8e528d9` == `origin/main`; working tree clean; no unpushed
  commits.

### Build results
- **NOT VERIFIED** — no build executed this session.

### Test results
- **NOT VERIFIED** — no tests executed this session.

### Packaging results
- **NOT VERIFIED** — `npm pack --dry-run` not executed this session.

### Published packages (this session)

| Package | Version | npm Verified |
|---------|---------|--------------|
| (none) | — | No package published this session (none required publishing). |

### Git tags
- None created this session.

### GitHub Release
- None created this session.

### GitHub Actions
- No release workflow triggered or monitored this session.

### Post-release validation
- **NOT VERIFIED** — nothing released this session.

### Findings

| Severity | Finding |
|----------|---------|
| **High** | `CHANGELOG.md` invalid: duplicate `## [Unreleased]` (lines 10, 359) and duplicate `## [1.0.3]` (lines 494, 552, different dates). Blocks release per Phase 3. Requires maintainer reconciliation. |
| **Medium** | No release is required at current versions — all 54 publishable packages already published on npm. Shipping the `[Unreleased]` `street create` scaffold fix requires a maintainer-authorized version bump (proposed: `streetjs`/`core`/`cli` 1.1.1 → 1.1.2). |
| **Informational** | npm auth healthy (`error51`, package owner, `read-write` on all `@streetjs/*`); GitHub auth healthy; repo clean and synced at `e8e528d9`. |

### NOT VERIFIED (not independently confirmed this session)
- Clean build of any package; test suites; `npm pack --dry-run` contents; publish;
  provenance; git tags; GitHub Release; GitHub Actions release runs; post-release
  install/CLI/example/generated-project checks. None executed after the Phase 3 stop.

---

## Final decision

## RELEASE FAILED

**Cause (evidence-based, this session):**
1. **Nothing to publish** — all 54 publishable packages already exist on npm at
   their current versions (`npm view` vs local `package.json`, verified).
2. **Invalid changelog** — duplicate `[Unreleased]` and duplicate `[1.0.3]`
   sections; Phase 3 mandates STOP.

No release artifacts were created or fabricated.

### To produce a genuine release (maintainer actions required)
1. **Fix `CHANGELOG.md`:** merge the two `## [Unreleased]` sections into one and
   resolve the duplicate `## [1.0.3]` (correct dates / attribute entries to the
   right versions).
2. **Decide + apply a version bump** for the unreleased work (e.g.
   `npm run release:patch` → `streetjs`/`core`/`cli` 1.1.2), updating `CHANGELOG.md`
   with a dated section and release notes.
3. Re-run this workflow from Phase 1; publish via the repository's `publish-*`
   GitHub Actions (which carry npm provenance).
