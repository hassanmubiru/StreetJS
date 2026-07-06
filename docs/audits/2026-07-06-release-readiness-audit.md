# StreetJS Release-Readiness Audit — 2026-07-06

> **Point-in-time record.** Immutable once published, per `audits/REPORT-INDEX.md`
> conventions. Archived here (not under `audits/`) because this is a dated,
> commit-pinned engagement snapshot rather than a living companion document.
> Superseding findings, if any, will link back to this file rather than edit it.

**Commit pinned:** [`8d4540a`](https://github.com/hassanmubiru/StreetJS/commit/8d4540a7986b324b53e0b744cb3c90d1992bf282) (`main`, 2026-07-06 11:00:12 +0300)
**Repository:** [`hassanmubiru/StreetJS`](https://github.com/hassanmubiru/StreetJS)
**Published package versions at time of audit:** `streetjs@1.0.27`, `@streetjs/core@1.0.27`, `@streetjs/cli@1.0.27` (lockstep, npm-provenanced)
**Audit discipline:** evidence-only — every claim below is backed by an executed command or a live GitHub Actions run. Items that could not be verified are marked `NOT VERIFIED` rather than assumed passing.

## Release decision

**CONDITIONALLY READY.** Every checkable engineering gate passes. The only open
item is live verification against four cloud/vendor providers, which is blocked
on credentials that are not available in this environment (see below) — not on
any known defect.

## Fixes shipped this engagement

| Item | Problem | Fix | Verification |
|---|---|---|---|
| H-1 | `street generate controller` CLI emitted `ctx.status(n).json(...)`, which doesn't exist on `StreetContext` | `packages/cli/src/commands/generate.ts` now emits `ctx.json(data, status)` / `ctx.send(status)` | Generated-code `tsc --noEmit` clean; `generate.test.js` 26/26 pass |
| R-1/R-2 | `packages/realtime` redis-integration test raced `init()`, causing a failing test + hung process in real CI | `createInstance()` now awaits `presence()` before returning (`packages/realtime/src/tests/redis-integration.test.ts`) | Local pass + real GitHub Actions (`realtime-integration.yml`), Node 22 and 24 both green |
| NATS coverage gap | No live NATS integration test existed | Added `packages/plugin-nats/test/broker.it.test.mjs` — real wire-protocol test against a live `nats:2-alpine` broker | Local pass + `plugin-tests.yml` on GitHub (honest skip when no broker present) |
| M-1 | `street migrate:run` / `migrate:diff` are PostgreSQL-only; SQLite-configured projects got a misleading PG auth error instead of clear guidance | `packages/cli/src/commands/migrate.ts` detects SQLite config and emits clear guidance instead of attempting a PG connection | PG path re-verified unaffected |
| Regression (self-caused) | An earlier manual `npm publish` of `@streetjs/cli@1.0.26` broke version lockstep (`streetjs`/`@streetjs/core`/`@streetjs/cli` must match) and the npm provenance-attestation gate, breaking automated `Test & Publish` for 5 consecutive pushes | Bumped all three packages to `1.0.27` (explicit user approval at each step); ran `npm deprecate @streetjs/cli@1.0.26 "..."` | Real GitHub Actions run — `Provenance OK` for all three packages; confirmed live via `npm view` |
| Release Engineering Enforcement | CI gate had never passed in project history. Root causes: (1) `release-inputs.json` is gitignored with no CI generation step, so the scorecard always defaulted to 0; (2) `validateReleaseNotes()` in `packages/core/src/release/scorecard.ts` treated any markdown heading (including a changelog's own `### Added` sub-heading) as the "next entry" boundary, so it never validated real changelog entries | Added `scripts/release/derive-inputs.mjs` (derives `security` live from the OpenSSF Scorecard API, `coverage` live from `c8`/lcov, merges with a new git-tracked `release-inputs.template.json` for maintainer-owned rubric fields); wired into `.github/workflows/ci-cd-enforcement.yml`. Fixed `validateReleaseNotes()` to only break on a same-or-shallower heading depth. Added 2 new property-based tests (200 runs each) in `packages/core/src/tests/release-semver-notes-pbt.test.ts` | All 8 existing + 6 sibling PBT tests pass; `RELEASE_VERSION=1.0.27 npm run verify:release` → `VERIFIED` (exit 0) locally **and** on real GitHub Actions run [28770929233](https://github.com/hassanmubiru/StreetJS/actions/runs/28770929233) (`workflow_dispatch`, all 7 jobs including `Release Engineering Enforcement` succeeded) |
| Manual audit checks → CI automation | Manifest integrity, README named-import verification, placeholder-marker scanning, and circular-dependency analysis were only ever run manually during audits | New `scripts/audit/repo-wide-checks.mjs` + `.github/workflows/repo-hygiene.yml`; builds core + the 6 pillar packages for full-depth manifest/import checking, honestly skips packages not built in that job context (rather than false-failing them) | Local run exit 0 (93 manifest targets / 47 skipped, 52 README imports / 45 skipped, 446 files scanned / 0 placeholder markers, 880 files / 0 cycles); real GitHub Actions dispatch [28778295306](https://github.com/hassanmubiru/StreetJS/actions/runs/28778295306), 37s, identical numbers to local |
| Storage providers false-green (found + fixed during this audit) | `provider-integration.yml`'s `storage-providers` job ran `node --test dist/tests/*.test.js` without building `packages/storage` first; on Node ≥22, `node --test` against a glob matching zero files silently reports 0/0/0 and exits 0, so the job had been passing while running **zero** real tests | Added an explicit `npm run build -w packages/storage` step before the test step | Confirmed via job logs: run 28755739760 (pre-fix, 0 tests) vs run 28755961571 (post-fix, 370 tests / 363 pass / 0 fail / 7 skip against live Postgres/GCS/Azurite containers) |
| kafka-chaos | Was tracked as "in progress" (long-running by design, 6-hour timeout budget) | — | Confirmed completed: 41m22s run, 5/5 harness tests + 5 live fault-injection scenarios against real Kafka, 0 message loss |

## Explicitly out of scope for this audit (correctly not "fixed")

- **Redis Cluster / PostgreSQL HA support** — determined to be a missing
  **client capability**, not missing test coverage. `RedisClientOptions`
  (`packages/core/src/transports/resp.ts`) and `PgConnectOptions`
  (`packages/core/src/database/wire.ts`) have no multi-node/cluster/HA fields.
  Filed as [GitHub issue #111](https://github.com/hassanmubiru/StreetJS/issues/111)
  and tracked as item 30 in `plans/OUTSTANDING-ACTIONS.md`.

## NOT VERIFIED (honest gaps, not fabricated)

| Item | Reason | Status |
|---|---|---|
| Real cloud/vendor providers: S3, R2, Azure, GCS, Backblaze, Supabase, Twilio, SendGrid, Stripe, Auth0 | No credentials available in this environment — checked env vars, `~/.aws`, `~/.config/gcloud`, `~/.azure`, and `gh secret list` (8 unrelated secrets present, none matching required names) | Blocked on credential provisioning (Task 3, not started) |
| npm deprecate cleanup follow-through | `npm deprecate @streetjs/cli@1.0.26` was executed and confirmed live via `npm view`; any further registry-side cleanup is a maintainer/operator action outside repo scope | Pending user/operator, if any further action is desired |

## Verification summary (this snapshot)

- `npm run verify:release` (RELEASE_VERSION=1.0.27): **VERIFIED**, exit 0 — local + [GitHub Actions run 28770929233](https://github.com/hassanmubiru/StreetJS/actions/runs/28770929233)
- `CI/CD Enforcement` on current `main` HEAD ([run 28776748979](https://github.com/hassanmubiru/StreetJS/actions/runs/28776748979)): success (Release Engineering Enforcement job `skipped` on this push — it only runs on `workflow_dispatch`/`release` by design, per item 31)
- `Repository Hygiene` ([run 28778295306](https://github.com/hassanmubiru/StreetJS/actions/runs/28778295306)): success, 37s
- `Kafka Integration` scheduled run ([28775172641](https://github.com/hassanmubiru/StreetJS/actions/runs/28775172641)): success, 41m24s (kafka-chaos included)
- npm registry: `streetjs`, `@streetjs/core`, `@streetjs/cli` all report `1.0.27` via `npm view`
- Working tree at time of this report: clean at commit `8d4540a`

## Related documents

- `plans/OUTSTANDING-ACTIONS.md` — master action register (items 30, 31 reference this audit)
- `scripts/audit/repo-wide-checks.mjs`, `.github/workflows/repo-hygiene.yml` — CI automation shipped this engagement
- `scripts/release/derive-inputs.mjs`, `release-inputs.template.json` — release scorecard derivation
- `CHANGELOG.md` — `1.0.26`/`1.0.27` entries
- `audits/REPORT-INDEX.md` — canonical report map (this file is intentionally *not* added there — it is a dated snapshot, not a living companion doc)
