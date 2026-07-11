# StreetJS — Project Status & Direction

**Single consolidated report.** Supersedes and replaces the separate
`PROJECT-TRANSITION-REPORT.md`, `PROJECT-STRATEGY-REVIEW.md`, and
`PROJECT-EXECUTION-REPORT.md` (folded in here). Forward-looking plans remain in
`PROJECT-EXECUTION-ROADMAP.md` and `STREETJS-2.0-PLAN.md`; the certification record
is `docs/audits/2026-07-11-streetjs-final-engineering-certification.md`.

**Date:** 2026-07-11 (UTC) · **Repo:** `hassanmubiru/StreetJS` @ `main` `82b7faa1`
(local == origin) · **npm:** `streetjs`/`@streetjs/core`/`@streetjs/cli` = **1.2.0**
(provenance) · **CI:** green.

**Evidence discipline:** every ✅ is backed by a command/CI run this engagement.
Items needing external infra or owner decisions are marked ◑ with the reason —
never simulated, never overstated.

---

## 1. Executive Summary

The engineering roadmap is **substantially complete and released**. StreetJS is a
54-package TypeScript monorepo with a **minimal, curated dependency footprint**, a
signed/provenance-carrying supply chain, HA data clients (Redis Cluster +
PostgreSQL failover, live-verified), a consolidated resilience layer, self-guarding
CI, and task/architecture documentation. The **1.2.0** feature release ships all of
this to npm.

The dominant risk is no longer technical — it is **organizational** (bus factor = 1,
no active funding) and **adoption** (no evidence of real-world users yet). The
highest-return work now is consumer validation, friction removal, honest benchmarks,
and contributors — **not** more core code.

**Verdict:** Engineering — **MATURE**. Overall project — **STABLE, adoption-gated.**

---

## 2. Repository State (verified)

| Item | State |
|------|-------|
| Branch / sync | `main`, clean, local == `origin/main` `82b7faa1` |
| Release line | `streetjs`/`@streetjs/core`/`@streetjs/cli` **1.2.0**, npm + SLSA provenance |
| Signed release | GitHub Release `v1.2.0` — 3 tarballs + 3 cosign bundles + SBOM |
| Security | 0 open secret-scan / Dependabot / code-scan alerts; `npm audit` 0 |
| CI | 44 workflows; latest run per workflow on `main` = success |
| Packaging | subpath-import gate: **136/136** published subpaths import from npm |
| Leftover artifacts | none tracked (scratch removed; generated files gitignored) |

---

## 3. Engineering Status (what shipped)

- **Architecture:** dependency-free-*aspiring* but honestly **minimal-dependency**
  core (3 direct deps — `reflect-metadata`, `ws`, `zod` — each zero-transitive; 6
  resolved). Clean package boundaries; lockstep `streetjs`/`@streetjs/core`(shim)/
  `@streetjs/cli`.
- **HA data clients (1.2.0, RFC 0003):** `RedisClusterClient` (slot routing +
  MOVED/ASK + self-heal) and `PgHaClient` (primary discovery + role routing +
  failover). **Live-verified** against a real 3-master/3-replica Redis Cluster and a
  PostgreSQL primary+streaming-replica with a real `pg_promote` failover.
- **Resilience (RFC 0004):** `streetjs/resilience` (`computeBackoff`, `withRetry`,
  canonical `CircuitBreaker`); secret-provider backoff ladders migrated.
- **Self-guarding CI:** registry subpath-import gate; `release-inputs.json` derived
  live; keyless-signing identity policy + verifier (7/7, incl. the critical negatives).
- **Docs:** `ARCHITECTURE.md`, `docs/ha-clients.md`, `docs/plugin-authoring.md`,
  `examples/plugin-starter/` (builds + tests 2/2), footprint benchmark.
- **Release:** CI-driven, provenance + cosign; 1.1.2→1.1.4→**1.2.0** cadence.

---

## 4. Findings & Defect Register (certification effort + this engagement)

| ID | Summary | Severity | Disposition |
|----|---------|:--------:|-------------|
| F-1 | Test files published in tarballs | High | FIXED (files-exclusion; republished) |
| F-2 | Cert test false-positive on `files` negation | Low | FIXED |
| F-3 | Kafka `listOffset` no retry on transient NOT_LEADER | Medium | FIXED (shipped 1.1.4) |
| F-4 | `@streetjs/storage@1.0.1` broken import | High | FIXED (`storage@1.0.2`) |
| F-5 | 4 packages broken import (narrow `files`) | High | FIXED (widened; full-registry sweep) |
| F-6 | `dist/resilience/**` missing from core `files` (F-5 class) | Med | FIXED — caught by Package Integrity gate before publish |
| M-1 | cosign tag-signing v3 bundle format | Medium | FIXED (live on `v1.1.4`/`v1.2.0`) |
| **D-1** | **"dependency-free core" claim inaccurate** — core has 3 runtime deps | Low (accuracy) | **CORRECTED** in this session's docs → "minimal, curated dependencies"; broader legacy copy still uses the old phrase (see §7) |

No reproducible engineering defect remains.

---

## 5. Technical Debt

| ID | Item | Status |
|----|------|--------|
| TD-1 | Duplicated resilience primitives | ✅ Done — canonical `streetjs/resilience` (RFC 0004) |
| TD-2 | HTTP plugins lacked local test scripts | ✅ Done — offline contract tests |
| TD-3 | `release-inputs.json` not CI-generated | ✅ Done — derived live |
| TD-4 | Hardcoded backoff ladders | ✅ Done — `computeBackoff` |
| TD-5 | `@streetjs/core` compat shim | Deferred to 2.0 (telemetry-gated) |

No material new debt. The one regression introduced this session (F-6) was caught by
CI and fixed same-engagement.

---

## 6. Strategy Assessment

- **Maintainer bus factor = 1** (Strategic Risk, P1). ~9,000 of ~9,100 commits from a
  single human; the rest are bots. Governance (charter, RFC process, steering
  committee) is documented but **inactive until N≥2–3 maintainers**. This is the top
  organizational risk and the main blocker to enterprise trust.
- **Funding** (P2): `FUNDING.yml` present but only GitHub Sponsors (not enabled);
  Open Collective commented out. No active channel.
- **Adoption** (P1): no evidence of production users, external contributors, or
  companies evaluating. The next KPIs to watch: npm download growth, issues from real
  users, plugin authors, community PRs, docs traffic.
- **Differentiators to lean into:** minimal curated dependencies (6 resolved vs
  17–67 for peers — see `docs/benchmarks/footprint.md`), signed/provenance supply
  chain, signed plugins, packaging discipline, enterprise orientation. **Do not chase
  feature parity** with larger ecosystems.

---

## 7. Roadmap Status

**Complete (engineering-actionable):** HA clients + live validation · 1.2.0 release +
docs + notes · resilience module · subpath-import gate · `release-inputs.json` ·
plugin test locality · ARCHITECTURE.md + `street doctor` · plugin-author guide +
starter template · footprint benchmark · keyless-signing identity policy + verifier
(RFC 0005 tooling).

**◑ Ready, gated on owner decision / infra:**
- **Keyless-signing rollout** (RFC 0005) — verification tooling + identity policy
  shipped/tested; producer wiring + plugin re-publish need CI-OIDC go-ahead.
- **StreetJS 2.0** (`STREETJS-2.0-PLAN.md`) — telemetry-gated; explicitly not started.

**Owner/community track (not engineering):** recruit maintainer #2; enable funding;
community plugin index + submission flow; tutorials/examples/case studies.

**Cleanup still owed:** the legacy "dependency-free core" phrasing remains in ~90
older docs (governance/audits/marketing copy) not authored this session; the newer
content plans already use "dependency-light." A messaging decision for the owner
(this report + this session's docs are already corrected).

---

## 8. Confidence Assessment

| Area | Confidence | Basis |
|------|-----------|-------|
| Architecture | High | boundaries/exports resolve; minimal-dep footprint measured |
| Build / Runtime | High | 136/136 published subpaths import; core suites green |
| Security | High | 0 alerts, `npm audit` 0, signed + provenance |
| Packaging | High | subpath-import + Package Integrity gates green |
| Releases | High | npm + provenance + cosign verified through 1.2.0 |
| HA | High | live-verified Redis Cluster + PG failover |
| Documentation | Medium→High | task docs + architecture present; more examples needed |
| CI/CD | High | 44 workflows green |
| Operations | None (external) | credentials / org / maintainers unavailable |
| Adoption | Unknown | no usage evidence yet — the key gap |

---

## 9. Recommended Direction (next 6 months)

1. **Become a consumer** — build 3–5 real apps on StreetJS only; fix the friction they expose.
2. **Kill friction** — install < 2 min, deploy < 10 min, clear package selection, debuggable failures, easy version migration.
3. **Task docs & examples** — build-a-SaaS / auth / Redis cache / PG-HA / Docker / K8s / CI-CD / prod hardening. People copy examples.
4. **Honest benchmarks** — extend `benchmark-footprint.mjs` with a separate runtime harness; publish scripts, never screenshots.
5. **Grow contributors** — good-first-issues, small RFCs, tiny fixes; accumulate gradually.
6. **Stabilize 1.x** — additive, evidence-driven only; defer 2.0 until adoption data justifies breaking changes.
7. **Enable funding + recruit maintainer #2** — the top organizational unlocks.

**Do not:** add heavy/uncurated core deps · chase parity · rush 2.0 · write more
certification audits · add speculative breadth.

---

## 10. Final Status

**Engineering: complete and released (MATURE).** The remaining work is
**organizational and adoption-driven**, not core engineering. The biggest risk is
no longer technical quality — it is whether the project earns real-world usage and
contributors. The most valuable feedback now will come from **production users**, not
further internal engineering. Treat the roadmap as mostly finished; shift investment
to consumers, docs, and community.
