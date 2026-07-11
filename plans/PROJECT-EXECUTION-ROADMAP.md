# StreetJS — Execution Roadmap (Next Major Phase)

**Owners:** Chief Architect / Product Lead / Engineering Manager / OSS Maintainer
**Date:** 2026-07-11 (UTC)
**Repository:** `hassanmubiru/StreetJS` @ `main`
**Status premise:** Engineering, security, release, CI/CD, packaging, and runtime
certification are complete and accepted; the Transition Report and Strategy Review
are complete. This document is the **execution plan**, not an audit.

**Source of truth (this engagement builds on, does not re-derive):**
- `docs/audits/2026-07-11-streetjs-final-engineering-certification.md` (ENGINEERING CERTIFIED)
- `plans/PROJECT-TRANSITION-REPORT.md` (roadmap P0–P4, technical debt TD-1…TD-5)
- `plans/PROJECT-STRATEGY-REVIEW.md` (bus factor = 1, funding, "Needs strategic investment before growth")

**Evidence discipline:** verified facts are drawn from the above. Forward-looking
initiatives are labeled **Strategic Recommendation** or **Opinion**. Effort estimates
are planning opinions, not measured commitments.

---

## Executive Summary

StreetJS is a certified, production-ready, dependency-free TypeScript full-stack
framework with a signed, provenance-carrying supply chain. Its constraints are
**organizational, not technical**: bus factor = 1 and no active funding cap its
ability to grow safely (Strategy Review). Therefore this roadmap deliberately
front-loads **sustainability and enterprise-enabling capability**, not more core
hardening.

The sequencing principle: **fix the carrying capacity first (people + funding + a
self-guarding pipeline), then ship the one technical capability that unlocks
enterprise (HA clients), then expand the ecosystem.** Feature breadth is intentionally
deferred behind these; the framework is already broad.

---

## Vision Statement

> StreetJS is the TypeScript framework you can trust end-to-end: a dependency-free
> core, a cryptographically verifiable supply chain, and enterprise-grade data
> capabilities — maintained by a healthy team and a sustainable community.

---

## Guiding Principles

1. **Organizational health before feature growth.** A second maintainer and funding
   outrank any feature.
2. **Depth over breadth.** The framework is already broad (54 packages); invest in
   making existing capabilities enterprise-grade, not in new surface area.
3. **The supply chain is sacred.** Never regress provenance/signing; only strengthen it.
4. **Additive, SemVer-honest evolution.** Breaking changes wait for a planned major.
5. **Prove, don't assert.** Every release self-verifies (CI gates), every benchmark is
   reproducible.
6. **Say no on purpose.** Reject initiatives that dilute the dependency-free,
   verifiable-supply-chain identity.

---

## Strategic Themes

- **Theme A — Sustainability:** maintainer bus factor, funding, contributor pipeline.
- **Theme B — Enterprise Readiness:** HA data clients, self-guarding CI, SLSA L3.
- **Theme C — Ecosystem:** third-party plugins, edge/serverless profile, positioning.
- **Theme D — Foundation Hygiene:** resilience consolidation, test-locality, the 2.0
  deprecation of the `@streetjs/core` shim.

---

## Prioritized Roadmap (by horizon)

### IMMEDIATE (0–3 months) — "Make it survivable and self-guarding"

**I-1. Recruit maintainer #2 (Theme A) — P1**
- **Objective:** move bus factor from 1 → 2.
- **Business value:** unblocks enterprise trust + governance activation. **Technical
  value:** review redundancy, faster triage.
- **Complexity:** High (human process). **Effort:** ongoing, 1–3 mo to first result.
- **Dependencies:** contributor pipeline (I-4). **Risks:** no qualified candidate;
  mitigate via mentored tasks + targeted outreach.
- **Milestone:** M1 — one additional committer with merge rights.

**I-2. Enable an active funding channel (Theme A) — P2**
- **Objective:** turn on GitHub Sponsors and/or Open Collective (`FUNDING.yml` already
  scaffolded).
- **Business value:** funds maintainer time/infra. **Technical value:** indirect.
- **Complexity:** Low. **Effort:** days. **Dependencies:** none. **Risks:** low uptake
  (acceptable — presence itself signals sustainability).
- **Milestone:** M1 — at least one live channel with a public tiers page.

**I-3. Registry "install-and-import-every-subpath" CI gate (Theme B) — P1 — ✅ SHIPPED (2026-07-11)**
- **Objective:** automate the exact check run manually during certification (130/130),
  so the F-4/F-5 packaging defect class can never recur.
- **Business value:** release confidence. **Technical value:** High — self-guarding
  pipeline. **Complexity:** Medium. **Effort:** 2–4 days.
- **Dependencies:** none (pattern exists in `publish-backend.yml`). **Risks:** registry
  flakiness; mitigated via honest-BLOCKED-on-install-failure + scheduled + on-release
  triggers.
- **Delivered:** `scripts/verify-registry-subpaths.mjs` (installs all published
  packages from the registry, imports every `exports` subpath incl. JSON with
  `type: json`; fails only on a real import failure, honest-BLOCKED on registry
  outage) + `.github/workflows/registry-subpath-import.yml` (dispatch + `release:
  published` + weekly cron). **Verified live in CI (Node 22): 54 packages, 130/130
  subpaths OK, run `29144639144` green.**
- **Milestone:** M1.

**I-4. Contributor pipeline activation (Theme A) — P2**
- **Objective:** curate "good first issues" + publish 2–3 mentored tasks
  (`mentored_task.yml` template exists) to feed the documented contributor ladder.
- **Business value:** grows the maintainer funnel. **Complexity:** Low. **Effort:**
  ongoing. **Dependencies:** none. **Milestone:** M1.

**I-5. `release-inputs.json` CI generation (Theme B / TD-3) — P1 — ✅ DONE / VERIFIED (2026-07-11)**
- **Objective:** derive release-enforcement inputs from live sources (Scorecard API,
  coverage artifact) so the enforcement job passes on real dispatch without a
  hand-placed file — **without** fabricating scores.
- **Business value:** unblocks release enforcement. **Complexity:** Medium. **Effort:**
  1–2 days. **Dependencies:** none. **Milestone:** M1.
- **Finding on execution:** already implemented and wired —
  `scripts/release/derive-inputs.mjs` derives `security` live (OpenSSF Scorecard API,
  0-10 ×10) and `coverage` live (`packages/core/coverage/lcov.info`), merging the
  maintainer-owned rubric dimensions (reliability/performance) + thresholds + health
  from the git-tracked `scripts/release/release-inputs.template.json`; it never
  fabricates the rubric dimensions. `.github/workflows/ci-cd-enforcement.yml`
  (`release-engineering` job, gated to release/dispatch/`v*`-tag) runs coverage →
  derive → enforce.
- **Verified this engagement:** (a) the `Release Engineering Enforcement` job
  **passed on the `v1.1.4` tag** (run `29142403646`, "live-derived: security,
  coverage", "not derived: (none)"); (b) fresh local run derived
  security=74 (OpenSSF 7.4×10) / coverage=78.42 / reliability=75 / performance=70,
  and `render-report.mjs` enforced **6/6 controls PASS, exit 0**. No new code required.

### NEAR-TERM (3–6 months) — "Unlock enterprise + tidy the foundation"

**N-1. HA data clients — Redis Cluster + PostgreSQL failover (Theme B) — P1 — ◑ RFC DRAFTED (2026-07-11)**
- **Objective:** extend `RedisClientOptions`/`PgConnectOptions` to multi-node/replica
  topologies with redirect/failover handling (Transition Report P1-3, TD is a
  *capability* gap, not a defect).
- **Business value:** the single largest enterprise-adoption enabler. **Technical
  value:** High. **Complexity:** High. **Effort:** 3–6 weeks + live-cluster tests.
- **Dependencies:** live cluster/HA test infra. **Risks:** protocol edge cases;
  mitigate with property-based + live-topology integration tests.
- **Status:** design complete — `rfcs/0003-ha-data-clients.md` (additive option
  shapes, CLUSTER SLOTS + MOVED/ASK routing, PG primary discovery + failover,
  live-topology test plan). **Cannot be honestly marked SHIPPED without live
  Redis-Cluster / PG-HA integration infra** (evidence discipline: no simulation).
  Ready to implement once the RFC is accepted and cluster CI infra is provisioned.
- **Milestone:** M2 — additive config + passing live-cluster/HA integration suite.

**N-2. Consolidated resilience primitive (Theme D / TD-1) — P2 — ✅ SHIPPED (2026-07-11)**
- **Objective:** unify the 2× `CircuitBreaker` + ad-hoc retry/backoff helpers into
  one canonical primitive; keep existing public re-exports.
- **Business value:** lower maintenance cost. **Technical value:** consistency.
  **Complexity:** Medium. **Effort:** 3–5 days. **Dependencies:** none (additive).
- **Delivered (RFC 0004 → Implemented):** `packages/core/src/resilience/index.ts`
  (`computeBackoff`, `withRetry`, `defaultDelay` + canonical `CircuitBreaker`
  re-exported from `microservices/circuit-breaker`); new **`streetjs/resilience`**
  export subpath; `cloud/secret-providers.ts` migrated off its 4× hardcoded
  `[1000,2000,4000,8000,10000]` ladders to `computeBackoff` (TD-4 closed,
  behavior-identical). **Verified:** new resilience suite **11/11**; regression
  guards green — microservices/CircuitBreaker **25/25**, secret-providers
  **15/15** + adapters **9/9**; `streetjs/resilience` imports cleanly (5 exports);
  CircuitBreaker class identity asserted single-canonical.
- **Follow-up (opt-in, low value):** `@streetjs/gateway` keeps its package-local
  `retry.ts` public API (unchanged); `otel`/`chaos` single-use helpers may adopt
  `withRetry` later. Core duplication removed.
- **Milestone:** M2.

**N-3. Per-plugin test-script locality (Theme D / TD-2) — P2 — ✅ SHIPPED (2026-07-11)**
- **Objective:** real local `test` scripts for the 6 HTTP plugins (auth0/r2/s3/
  sendgrid/stripe/twilio) so `npm test -w <pkg>` is meaningful everywhere.
- **Business value:** contributor clarity. **Complexity:** Low. **Effort:** 0.5 day.
  **Milestone:** M2.
- **Delivered:** each plugin gained `test/contract.test.mjs` — a network-free
  contract test (plugin-class default export; `manifest` name/version; `*PluginManifest`
  factory matches NAME/VERSION consts; `validate*Config` rejects `null` and `{}`) +
  a `test: node --test test/*.test.mjs` script. Export names are resolved by pattern
  so one test is valid for all six. **Verified:** built core + all 6, each suite
  **4/4 pass, 0 fail** (24 new tests). `test/` is outside the `files` allowlist, so
  nothing new is published (no F-1 regression). Only `core-compat` (generated shim)
  now lacks a test script, by design.

**N-4. ARCHITECTURE.md + package map + `street doctor` (Theme C DX) — P2 — ✅ SHIPPED (2026-07-11)**
- **Objective:** single architectural entry point + first-run diagnostics (Node engine,
  `PG_HOST` reachability, plugin signatures).
- **Business value:** reduces onboarding friction (the Docker image's correct
  `PG_HOST` fail-fast currently surprises newcomers). **Complexity:** Low–Medium.
  **Effort:** 3–5 days. **Milestone:** M2.
- **Delivered:** top-level `ARCHITECTURE.md` — dependency-free-core principle, the
  full 54-package map by category, a "which package do I need" guide, the extension
  model, test-coverage locality (folding in N-3's documentation goal), and the
  release/supply-chain summary. **`street doctor` was already implemented**
  (`packages/cli/src/commands/doctor.ts`: Node ≥22, TypeScript ≥5, required
  `.env.example` vars, live DB connectivity) and routed/documented in the CLI — no
  new command needed.

### MID-TERM (6–12 months) — "Ecosystem + supply-chain leadership"

**M-1. Keyless / KMS signing → SLSA L3 (Theme B/Supply-chain) — P3**
- **Objective:** migrate plugin signing to Sigstore/OIDC or KMS/HSM, removing the
  long-lived key.
- **Business value:** enterprise procurement checklists; supply-chain leadership.
  **Complexity:** Medium. **Effort:** 1–2 weeks. **Dependencies:** none blocking.
  **Risks:** verification-flow changes; mitigate with a transition period verifying
  both anchors. **Milestone:** M3.

**M-2. Third-party plugin ecosystem (Theme C) — P3**
- **Objective:** public community-plugins index + plugin-author guide + signed-manifest
  submission flow.
- **Business value:** network effects / stickiness. **Technical value:** Medium.
  **Complexity:** Medium. **Dependencies:** governance activation (needs maintainers).
  **Milestone:** M3.

**M-3. Reproducible competitive benchmarks (Theme C) — P3**
- **Objective:** publish head-to-head, reproducible benchmarks vs. comparable
  frameworks (self-measurement exists; competitor comparison was out of cert scope).
- **Business value:** positioning/marketing. **Complexity:** Medium. **Risks:**
  benchmark fairness disputes; mitigate with open, reproducible harnesses.
  **Milestone:** M3.

**M-4. Edge/serverless first-class profile (Theme C) — P3 (Opinion)**
- **Objective:** promote `@streetjs/edge` to a trimmed, first-class deploy target.
- **Business value:** broadens deployable surface. **Complexity:** Medium–High.
  **Dependencies:** core module boundaries. **Milestone:** M3–M4.

### LONG-TERM (1–3 years) — "2.0 and durability"

**L-1. StreetJS 2.0 major (Theme D) — P3**
- **Objective:** retire the `@streetjs/core` compat shim (TD-5) on migration telemetry;
  simplify to `streetjs` + scoped plugins.
- **Business value:** cleaner surface. **Complexity:** Medium (mostly deprecation
  choreography). **Dependencies:** download telemetry. **Milestone:** M5.

**L-2. Governance activation at N≥3 (Theme A) — P2 when unlocked**
- **Objective:** activate Steering Committee/elections once maintainer count supports
  it (already documented; needs people, not docs).
- **Milestone:** M5.

**L-3. Long-term research (Theme B/C) — P4**
- Pluggable coordination/consensus for multi-node stateful features; expanded formal
  property-based testing into transport/DB wire layers; deeper OTel semantic
  conventions **only if enterprise users request them.**
- **Milestone:** M6 (research track, no fixed date).

---

## Milestone Plan

| Milestone | Horizon | Definition of done |
|-----------|---------|--------------------|
| **M1** | 0–3 mo | Maintainer #2 in progress; funding channel live; subpath CI gate + `release-inputs.json` generation shipped; contributor pipeline active |
| **M2** | 3–6 mo | HA clients (Redis Cluster + PG failover) shipped + live-tested; `@streetjs/resilience` extracted; plugin test locality; ARCHITECTURE.md + `street doctor` |
| **M3** | 6–12 mo | Keyless/KMS signing (SLSA L3); community plugin index + author guide; reproducible competitive benchmarks |
| **M4** | ~12 mo | Edge/serverless first-class profile (if validated) |
| **M5** | 1–2 yr | StreetJS 2.0 (shim removal); governance activated at N≥3 |
| **M6** | 2–3 yr | Research initiatives as warranted |

---

## Release Plan

- **Cadence:** continue the proven CI-driven, provenance-carrying patch/minor cadence
  (1.1.x → 1.2.x). **No change to the release mechanism** — it is certified.
- **Minors** for all additive work (HA clients, resilience module, edge profile) under
  1.x with SemVer discipline.
- **Major (2.0)** reserved for the `@streetjs/core` shim removal and any accumulated
  breaking changes — batched, migration-doc-backed, telemetry-gated.
- Every release passes the new subpath-import gate (I-3) before publish.

---

## Ecosystem Growth Plan

1. Convert the strong first-party plugin model into third-party growth (M-2): index +
   author guide + signed submission.
2. Publish positioning content and reproducible benchmarks (M-3) to make the
   dependency-free / signed-supply-chain differentiators legible.
3. Edge/serverless profile (M-4) to broaden where StreetJS runs.
- **Opinion:** ecosystem work should trail maintainer growth — a network of plugins
  needs reviewers to remain trustworthy.

---

## Enterprise Adoption Plan

- **Technical unlock:** HA clients (N-1) + keyless signing (M-1).
- **Organizational unlock:** maintainer #2 (I-1) + funding (I-2) — enterprises evaluate
  durability, not just code.
- **Assets already in place:** compliance docs, support matrix, provenance, signed
  releases — leverage, don't rebuild.
- **Milestone:** enterprise-ready posture achievable by M3 *if* Theme A lands.

---

## Community & Governance Plan

- Keep the existing governance framework **as written** — it is complete; do not author
  more.
- Drive N from 1 → 2 → 3 via the mentored-task pipeline; activate Steering
  Committee/elections automatically at the documented thresholds.
- Maintain Code of Conduct enforcement as best-effort until a second moderator exists.

---

## Funding & Sustainability Plan

- **Immediate:** enable GitHub Sponsors; add a tiers/impact page.
- **Near-term:** open an Open Collective if sponsor interest appears.
- **Mid-term:** pursue a fiscal host / foundation umbrella if enterprise adoption
  materializes (improves neutrality + enables the org/teams governance the CODEOWNERS
  work is waiting on).
- **Opinion:** tie funding asks to concrete deliverables (HA clients, SLSA L3) rather
  than generic support.

---

## Technical Debt Plan (from Transition Report)

| ID | Item | Plan | Horizon |
|----|------|------|---------|
| TD-1 | Duplicated resilience primitives | Extract `@streetjs/resilience` (N-2) | Near-term |
| TD-2 | 6 HTTP plugins lack local test script | ✅ Done — real offline contract tests (4/4 each) + `test` scripts (N-3) | Near-term |
| TD-3 | `release-inputs.json` not CI-generated | ✅ Done — derive-inputs.mjs wired in ci-cd-enforcement.yml; verified on v1.1.4 tag + locally (I-5) | Immediate |
| TD-4 | Hardcoded backoff ladders | Folded into TD-1 | Near-term |
| TD-5 | `@streetjs/core` compat shim | Remove in 2.0 on telemetry (L-1) | Long-term |

No new technical debt is proposed. No defect exists to fix.

---

## Success Metrics (KPIs)

- **Sustainability:** # active human maintainers (target ≥2 by M2, ≥3 by M5); funding
  channel live (Y/N) + monthly sponsors.
- **Enterprise:** HA client capability shipped + live-tested (Y/N); SLSA level (target
  L3 by M3); # documented enterprise adopters.
- **Ecosystem:** # third-party signed plugins; # external human contributors/quarter;
  npm weekly downloads trend.
- **Quality (maintain, not chase):** 0 open security alerts; CI green rate; release
  provenance 100%; subpath-import gate pass rate 100%.
- **DX:** time-to-first-successful-`street create` (via `street doctor`); docs search
  success.

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|:--------:|-----------|
| Maintainer unavailability (bus factor = 1) | **High** | I-1 + I-4; document tribal knowledge; funding to compensate time |
| Feature sprawl dilutes identity | Medium | Guiding Principle #2 + the "Never Pursue" list below |
| HA client protocol edge cases | Medium | Property-based + live-topology tests before GA |
| Supply-chain regression during keyless migration | Medium | Dual-anchor verification transition window |
| Low funding uptake | Low–Med | Presence still signals sustainability; tie asks to deliverables |
| Ecosystem trust erosion without reviewers | Medium | Gate M-2 behind maintainer growth |

---

## Do-NOT-Pursue List (would dilute the framework)

1. **Adding runtime dependencies to the core** — the dependency-free core is the
   identity; never compromise it for convenience.
2. **A bespoke package manager / registry replacement** — reuse npm + provenance; do
   not reinvent.
3. **Framework-owned hosted cloud/PaaS** — out of scope; would fracture focus and
   maintainer capacity.
4. **Speculative breadth** (new verticals/transports with no demand signal) — depth
   over breadth.
5. **More governance/audit documents** — the framework is complete; add people, not
   paper.
6. **Non-reproducible/marketing-only benchmarks** — only publish open, reproducible
   comparisons.

## Architectural Decisions That Should Remain Permanent

- Dependency-free core.
- Signed, provenance-carrying supply chain and the CI-driven release model.
- Lockstep `streetjs` / `@streetjs/core` / `@streetjs/cli` line (until the planned 2.0
  shim removal).
- SemVer + additive-only + Keep-a-Changelog discipline.
- Signed-manifest plugin model.

## Features That Should Wait for a Future Major (2.0+)

- Removal of the `@streetjs/core` compat shim (TD-5).
- Any breaking change to public client option shapes (HA config must be **additive** in
  1.x; a cleaner unified shape can wait for 2.0).
- Any export-surface reorganization.

## Differentiators to Press (vs. competing TS frameworks) — Opinion

- **Verifiable supply chain end-to-end** (provenance + cosign + signed plugins) — few
  competitors match this; lead with it.
- **Dependency-free core** — security/audit story competitors can't easily copy.
- **HA-by-default data clients** (once shipped) — turns a checkbox into a headline.

---

## Three-Year Outlook (Opinion)

- **If Theme A lands (maintainers + funding):** StreetJS becomes a credible,
  enterprise-adoptable, supply-chain-leading TypeScript framework with a small team and
  a growing third-party plugin ecosystem by year 2–3.
- **If Theme A stalls:** engineering stays excellent but adoption plateaus and
  maintainer burnout becomes the dominant risk — the technical roadmap cannot
  compensate for organizational fragility.
- The differentiators age well; the people/funding variable decides the outcome.

---

## Official Prioritized Development Plan (single list)

1. **[P1] Maintainer #2** (I-1) — Immediate
2. **[P1] Subpath-import CI gate** (I-3) — Immediate — ✅ **SHIPPED 2026-07-11**
3. **[P1] `release-inputs.json` CI generation** (I-5) — Immediate — ✅ **DONE/VERIFIED 2026-07-11**
4. **[P2] Enable funding channel** (I-2) — Immediate
5. **[P2] Contributor pipeline** (I-4) — Immediate
6. **[P1] HA data clients (Redis Cluster + PG failover)** (N-1) — Near-term
7. **[P2] Extract `@streetjs/resilience`** (N-2) — Near-term
8. **[P2] Plugin test-script locality** (N-3) — Near-term
9. **[P2] ARCHITECTURE.md + `street doctor`** (N-4) — Near-term
10. **[P3] Keyless/KMS signing → SLSA L3** (M-1) — Mid-term
11. **[P3] Third-party plugin ecosystem** (M-2) — Mid-term
12. **[P3] Reproducible competitive benchmarks** (M-3) — Mid-term
13. **[P3] Edge/serverless first-class profile** (M-4) — Mid-term
14. **[P3] StreetJS 2.0 (shim removal)** (L-1) — Long-term
15. **[P2] Governance activation at N≥3** (L-2) — Long-term
16. **[P4] Long-term research** (L-3) — Long-term

**Bottom line:** invest in carrying capacity (people, funding, self-guarding CI)
first; ship HA clients to unlock enterprise; then expand the ecosystem. Keep the
dependency-free, verifiable-supply-chain identity permanent, and defer all breaking
changes to a telemetry-gated 2.0.
