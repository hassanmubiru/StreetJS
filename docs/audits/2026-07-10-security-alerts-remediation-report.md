# StreetJS — Security Alerts & CI Remediation Report

**Date:** 2026-07-10
**Branch / tip at completion:** `main` @ `f3538233`
**Scope:** GitHub secret-scanning alerts, one CodeQL alert, two OpenSSF Scorecard
findings, one Dependabot alert, stale-branch cleanup, and workflow-pipeline
verification.
**Discipline:** Evidence-only. Every claim below is backed by an executed command
(`gh api`, `git`, `npm ci`/`npm audit`, `node --test`, `tsc`). Items that cannot
be verified from the repository are marked as such.

---

## Executive summary

| # | Item | Type | Outcome |
|---|------|------|---------|
| 1 | Secret-scanning alerts #1–#16 (`google_api_key`) | GitHub secret scanning | ✅ All 16 closed as `used_in_tests`; history purge reviewed and deliberately **skipped** |
| 2 | Alert #170 — `js/polynomial-redos` in gateway auth | CodeQL | ✅ Fixed (regex → linear parser) + regression tests |
| 3 | Alert #173 — Pinned-Dependencies | OpenSSF Scorecard | ✅ Fixed (`npm ci` + pinned, integrity-hashed lockfile) |
| 4 | Alert #116 — SAST coverage ratio | OpenSSF Scorecard | ◑ Investigated; config already optimal, no change |
| 5 | Alert #15 — `uuid` OOB write (transitive) | Dependabot | ✅ Fixed via `overrides` → `uuid@11.1.1`; alert `state: fixed` |
| 6 | 8 stale branches (1 copilot + 7 Dependabot) | Repo hygiene | ✅ Verified superseded; deleted (recovery SHAs recorded) |
| 7 | Workflow pipeline on `main` | CI | ✅ Green — all 10 push-triggered workflows `success` |

Net posture: no open security alerts introduced or left behind by this session;
the pipeline is green; the branch list is down to `main` only.

---

## 1. Secret-scanning alerts #1–#16 — Google API keys

**Finding.** All 16 GitHub secret-scanning alerts (`google_api_key`) resolved to a
single committed third-party binary, `.release-verify-tmp3/gitleaks` (21 MB ELF),
at consecutive lines 19541–19556 — a block of Google API keys that are
**gitleaks' own detection-rule test fixtures** embedded in the compiled tool, not
StreetJS-owned credentials. Two are self-evidently fixtures: #4
`AIzaSyabcdefghijklmnopqrstuvwxyz1234567` (a literal alphabet) and #11 with a
malformed `AIzay…` prefix. The binary was added in commit `0a7147b4` during an
ad-hoc release-verify run. Nothing to rotate or revoke.

**Actions taken (verified).**
- All 16 alerts closed as `resolved` / `used_in_tests` via `gh api -X PATCH`.
  Verified: `gh api repos/hassanmubiru/StreetJS/secret-scanning/alerts` shows
  #1–#16 all `resolved`/`used_in_tests`.
- Recurrence prevention (already on `main`): `.gitignore` ignores
  `.release-verify-tmp*/`; `.gitleaks.toml` path-allowlists the fixture directory.

**History purge — deliberately NOT run (risk review).** A verified-clean
`git filter-repo` purge mirror was prepared and validated (2265 files / 4920
commits intact, blob absent) but **discarded unrun**. With the alerts closed,
prevention in place, and the strings being non-exploitable third-party fixtures,
the force-push rewrite was judged not worth its cost: it would unsign all 4920
commits (degrading the P0 signed-commits control, OUTSTANDING #5), change every
commit SHA (breaking clones and PR refs), require temporarily disabling force-push
protection, and still need a GitHub Support request for PR-ref/cache purge.
Recovery SHA of `main` at decision time: `ae2afa38`. The runbook
(`security/RELEASE-VERIFY-TMP-PURGE-RUNBOOK.md`) is retained for any future
genuine leak.

**Tracking:** OUTSTANDING-ACTIONS #36 (✅ resolved).

---

## 2. CodeQL #170 — Polynomial ReDoS in `packages/gateway/src/auth.ts`

**Finding.** The bearer-token extractor used
`/^Bearer[ \t]+(.+)$/i`. Because `.` also matches space and tab, `[ \t]+` and
`(.+)` overlap; on adversarial input (`"bearer"` + many tabs with no real token)
the backtracking engine partitions the whitespace run O(n) ways before failing —
quadratic time (CWE-1333 / CWE-400).

**Fix.** Replaced the regex with a linear, backtracking-free string scan that
preserves the exact contract — case-insensitive `Bearer` scheme, ≥1 space/tab
separator, non-empty trimmed token. No regex, so the pattern cannot recur.

**Verification.**
- `tsc` build clean; no diagnostics on the file.
- Full gateway suite: **252 pass, 0 fail, 0 skipped**.
- Added 4 regression tests, including an adversarial `"bearer" + "\t"×200,000`
  input that now resolves to `null` in **< 1000 ms** (previously quadratic), plus
  case-insensitivity, tab-separator, and no-separator/empty-token edge cases.

**Commits:** `c3ce8043` (source), `72b411ba` (tests).
**Tracking:** OUTSTANDING-ACTIONS #37 (✅ done).

---

## 3. Scorecard #173 — Pinned-Dependencies (`vendor-integration.yml`)

**Finding.** The storage live-round-trip job installed optional cloud SDKs with a
mutable `npm install @supabase/supabase-js @google-cloud/storage
@azure/storage-blob --package-lock=false --prefix packages/storage`. Per
Scorecard's own source (`isNpmUnpinnedDownload`), **only `npm ci` or a git URL
pinned to a 40-hex commit hash counts as pinned** — an `npm install pkg@version`
is still flagged. Confirmed by reading `checks/raw/shell_download_validate.go`.

**Fix.** Added a dedicated, non-workspace, pinned project at
`.github/ci/live-sdks/`:
- `package.json` exact-pins Supabase `2.110.2`, GCS `7.21.0`, Azure `12.33.0`.
- Committed `package-lock.json` with integrity hashes for the full tree.
- The workflow step now runs `npm ci --prefix .github/ci/live-sdks` then copies
  the resolved trees onto `packages/storage`'s module-resolution path.

A dedicated dir is required because `packages/storage` is ESM (so `NODE_PATH`
tricks don't apply) and is a workspace member that triggers a documented npm
10.8.2 Arborist bug on the `-w` install form.

**Verification.**
- `npm ci` installs cleanly against the committed lockfile.
- All three SDKs resolve via ESM `import()` from within `packages/storage`
  (`Storage`, `createClient`, `BlobServiceClient` all present).
- Workflow YAML parses; no diagnostics.

**Commits:** `921565b5`, `ff4cbe0e` (initial), `3d66dcc9` (workflow step).
**Tracking:** OUTSTANDING-ACTIONS #38 (✅ done).

---

## 4. Scorecard #116 — SAST coverage ratio

**Finding.** "SAST tool detected but not run on all commits: 1 of 3 commits
checked."

**Investigation — no change made.** `.github/workflows/codeql.yml` already triggers
on push→`main`, PR→`main`, and a weekly schedule, and its `concurrency` block is
**already deliberately tuned for this exact metric**: main pushes are grouped per
`github.sha` with `cancel-in-progress: false`, so every default-branch commit
completes its own SAST run (PR runs are per-ref and cancellable). The rolling
"N of M commits checked" ratio self-heals as CodeQL analyses complete; it dips
transiently when commits land faster than analyses finish — which this
environment's auto-commit-on-every-change cadence aggravates. No config change
meaningfully raises the ratio; churning the file would only undo prior tuning.

**Tracking:** OUTSTANDING-ACTIONS #39 (◑ investigated / no-op).

---

## 5. Dependabot #15 — `uuid` out-of-bounds write (transitive)

**Finding.** The lockfile committed for #173 pulled `uuid@9.0.1` transitively
under `@google-cloud/storage@7.21.0` (`gaxios`/`teeny-request`, which pin `^9`) —
GHSA-w5hq-g745-h8pq / CVE-2026-41907. The flaw affects only `uuid` `v3/v5/v6` when
a caller-supplied buffer is provided; the GCS SDK uses `v4` (unaffected), so the
path is unreachable — but it still generated a Dependabot alert.

**Fix.** Because `.github/ci/live-sdks/` is a fully isolated project, added an npm
`overrides: { "uuid": "11.1.1" }` forcing the whole tree onto the patched
**uuid 11.1.1**. Chosen over `14.x` (an ESM-only major that would break the CJS
`require('uuid')` used by gaxios/teeny-request) and over leaving `9.0.1`.

**Verification.**
- `uuid@11.1.1` retains a CJS `require` conditional export → `require('uuid').v4()`
  still works (verified).
- `npm ci` clean; **`npm audit` → 0 vulnerabilities** (was 5 moderate).
- Single `uuid@11.1.1` in the tree; all three SDKs load.
- Dependabot alert #15 now `state: fixed` (`fixed_at: 2026-07-10T03:22:40Z`).

**Commits:** `2266f2da` (override), `63a21ca7` (lockfile).
**Tracking:** folded into OUTSTANDING-ACTIONS #38.

---

## 6. Stale-branch cleanup

**Finding.** 8 non-`main` branches existed with no open PRs. Each was assessed
against `main`:

| Branch | Proposed | `main` has | Verdict |
|--------|----------|-----------|---------|
| `copilot/fix-docker-build-push-job` | (0 commits ahead) | — | stale |
| `dependabot/docker/demos/node-725aeba` | node:26 `725aeba` | node:**24** `a0b9bf06` | obsolete (regress) |
| `dependabot/docker/infra/docker/node-725aeba` | node:26 `725aeba` | node:**24** | obsolete (regress) |
| `dependabot/docker/packages/registry-server/node-a2dc166` | node:26 `a2dc166` | node:**24** | obsolete (regress) |
| `dependabot/github_actions/actions-3231de200b` | checkout v7.0.0, cosign v4.1.2 | v7.0.0, v4.1.2 | superseded |
| `dependabot/npm_and_yarn/development-dependencies-a243c58be6` | `@types/node` ^26.0.0 | ^26.1.0 | superseded |
| `dependabot/.../marzpay-next/...` | `@types/node` ^26.0.0, TS ^6.0.3 | ^26.0.1, ^6.0.3 | superseded |
| `dependabot/.../marzpay-react/...` | react ^19.2.7 | react ^19.2.7 | superseded |

Every branch carried only changes already present on `main` at an equal-or-higher
version; the three Docker branches would have *regressed* main (node 24→26). All
were 1160–2119 commits behind, so no clean, protection-compliant merge was
possible. **None was mergeable.**

**Action.** With approval, deleted all 8. Recovery SHAs recorded:

```
copilot/fix-docker-build-push-job                                4fb650da
dependabot/docker/demos/node-725aeba                             f7c08b82
dependabot/docker/infra/docker/node-725aeba                      4012ecf3
dependabot/docker/packages/registry-server/node-a2dc166          7e306799
dependabot/github_actions/actions-3231de200b                     e4d29f67
dependabot/npm_and_yarn/development-dependencies-a243c58be6      b77d320f
dependabot/npm_and_yarn/.../marzpay-next/web/...-5dbbd9334e      41893ada
dependabot/npm_and_yarn/.../marzpay-react/web/...-6f92b22514     8b5bfecf
```

**Verification.** `git ls-remote --heads` now returns `refs/heads/main` only.
Dependabot regenerates any branch automatically if an update is genuinely needed
again.

---

## 7. Workflow-pipeline status

Latest push-triggered run per workflow on `main` — all `success`:

- Block private keys & verify signing anchor
- CI/CD Enforcement
- CodeQL Advanced
- Repository Hygiene
- Repository policy
- Runtime Certification
- Scorecard supply-chain security
- Secret Scanning
- Security baseline
- street CI/CD

The only non-success entry seen was Dependabot's own uuid update job, now moot
(§5). `cancelled` runs were concurrency-superseded by rapid commits, not failures.
No pipeline fix was required.

> Note: not all 38 workflows run on every push — many are path-filtered or gated to
> PR / schedule / release events, so they are absent from the per-push list by
> design.

---

## Commit ledger (this session, on `main`)

| Commit | Change |
|--------|--------|
| `ae2afa38`, `82892a03` | Runbook: record purge-skip decision |
| `038c6e2e`, `e8fca68e` | OUTSTANDING #36 resolution |
| `c3ce8043` | Gateway ReDoS fix (linear bearer parser) |
| `72b411ba` | Gateway ReDoS regression tests |
| `11e5bfa9` | OUTSTANDING #37 |
| `921565b5`, `ff4cbe0e` | `.github/ci/live-sdks/` pinned project + lockfile |
| `3d66dcc9` | `vendor-integration.yml` → `npm ci` |
| `93034668` | OUTSTANDING #38/#39 |
| `2266f2da`, `63a21ca7` | uuid override → 11.1.1 (audit clean) |
| `f3538233` | OUTSTANDING #38 (uuid resolution) |

---

## Residual / follow-ups

- **Secret-scanning history purge (#36):** intentionally not run; runbook retained
  for a future genuine leak only. No action pending unless policy requires a full
  history scrub.
- **Scorecard SAST #116 (#39):** self-healing; no repo action available.
- **uuid override (#38):** revisit if `@google-cloud/storage` ships a tree on a
  patched `uuid` so the override can be dropped.
- All other OUTSTANDING P0/P1 platform items remain as previously tracked; this
  session did not change their status.
