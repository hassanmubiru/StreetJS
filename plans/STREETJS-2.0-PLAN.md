# StreetJS 2.0 — Planning (Telemetry-Gated)

**Status:** Planning only — **2.0 is not scheduled and must not be started** until
the entry criteria below are met with evidence. This document defines *what to
measure*, *when a major is justified*, and *what a 2.0 would contain*. It is a gate,
not a commitment.

**Date:** 2026-07-11 · **Current line:** 1.2.x (see `CHANGELOG.md`, `PROJECT-EXECUTION-ROADMAP.md`).

---

## Principle

StreetJS has held **additive, SemVer-honest, no-breaking-changes** discipline across
the entire 1.x line. A major version is expensive for users (migration) and for
maintainers (support windows). **Do not cut 2.0 to "clean things up."** Cut it only
when accumulated, *evidence-backed* breaking changes justify the cost — and batch
them so users migrate once.

---

## What to monitor (collect before deciding)

| Signal | Why it matters | Source |
|--------|----------------|--------|
| npm weekly downloads (trio + plugins) | adoption scale; blast radius of a breaking change | npm registry |
| `@streetjs/core` vs `streetjs` install ratio | whether the compat shim can be retired | npm download stats per package |
| Plugin ecosystem size (first- vs third-party) | whether plugin-API changes need an RFC + long deprecation | registry + npm |
| Node engine distribution of consumers | whether the `engines >= 22` floor can rise | issues / surveys / CI of dependents |
| Recurring issues tagged `api`/`breaking-request` | real pain that only a major can fix | GitHub issues |
| Most-requested features requiring breaking change | demand evidence for each candidate | GitHub discussions |
| Resilience/HA API feedback (1.2 features) | whether `withRetry`/HA client shapes need finalizing | issues after 1.2 uptake |

**Instrumentation note:** none of this should require invasive telemetry in the
framework. Use registry download stats, issue/discussion labels, and voluntary
adopter reports. Do **not** add phone-home telemetry to a minimal-dependency framework.

---

## Entry criteria (the gate)

Schedule 2.0 only when **all** of these hold:

1. At least one candidate breaking change has **concrete evidence** (issues, requests,
   or a measured migration signal) — not just aesthetic preference.
2. There is **maintainer capacity** for a major's support/backport window (ties to the
   bus-factor risk — ideally ≥2 maintainers first).
3. The compat shim retirement is **safe** — `@streetjs/core` install share has fallen
   to a level where deprecation won't strand a meaningful cohort.
4. Each included change has an **accepted RFC** with a migration path.

If these are not met, **stay on 1.x** and ship features as additive minors.

---

## Candidate 2.0 items (each gated on its own evidence)

| Candidate | Rationale | Evidence required | Notes |
|-----------|-----------|-------------------|-------|
| **Remove the `@streetjs/core` compat shim** (TD-5) | simplify the published surface to `streetjs` + scoped plugins | `@streetjs/core` install share low; migration doc exists | Already deprecated; the cleanest 2.0 win. |
| **Finalize resilience API** (RFC 0004) | promote/settle `streetjs/resilience` surface; possibly fold gateway's `retry.ts` re-exports | usage feedback after 1.2; any confusion between the two | Keep gateway re-exports until then. |
| **Retire the legacy plugin-signing key** (RFC 0005) | drop dual-anchor once all plugins are keyless-signed | keyless rollout complete; telemetry shows no legacy-only consumers | Depends on RFC 0005 implementation landing first. |
| **Raise the Node engine floor** | use newer stdlib APIs; drop compatibility shims | consumer Node distribution shows the floor is safe | Currently `>=22`. |
| **Edge/serverless runtime shape** (P4-1) | first-class trimmed `@streetjs/edge` target | demand + a design that may change core module boundaries | May be additive; only breaking if it reshapes core. |
| **Export-surface reorganization** | consolidate subpaths if the 20+ grow unwieldy | evidence that the current surface causes friction | Last resort — subpaths are cheap and additive today. |

---

## What 2.0 is NOT

Per the roadmap's do-not-pursue list, 2.0 must **not** become a vehicle for:
- runtime dependencies in the core (permanent architectural invariant);
- a rewrite, or cosmetic refactoring dressed up as a major;
- speculative breadth (new verticals/transports without demand);
- breaking changes with no evidence behind them.

---

## Process

1. Each candidate gets (or already has) an RFC with a migration path.
2. When the entry criteria are met, open a `2.0` milestone and assign the
   evidence-backed RFCs to it.
3. Ship a `1.x` release that **deprecation-warns** every to-be-removed API first, so
   users get a full minor cycle of warnings before removal.
4. Cut `2.0.0` with a single consolidated migration guide.
5. Support the last `1.x` minor for a documented window (see `docs/enterprise/support-matrix.md`).

---

## Current recommendation

**Do not start 2.0.** Stay on 1.x, ship additive minors, and **collect the signals
above** as 1.2's HA features gain adoption. Revisit this gate once there is (a) a
second maintainer and (b) at least one evidence-backed breaking change. Until then,
2.0 is intentionally unscheduled.
