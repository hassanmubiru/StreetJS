# StreetJS — Project Transition Report

**Prepared by:** Maintainer / Principal Engineer / Architect (transition review)
**Date:** 2026-07-11 (UTC)
**Repository:** `hassanmubiru/StreetJS` @ `main` `55a2581a`
**Premise:** Engineering certification is complete
(`docs/audits/2026-07-11-streetjs-final-engineering-certification.md` → ENGINEERING
CERTIFIED). This is **not** another certification or release-readiness audit; it is a
transition review to establish the baseline for the next development cycle.

**Terminology used below:**
- **Finding** — directly verified this engagement.
- **Suggestion** — a reasonable improvement not exhaustively verified; opinion.
- **Technical debt** — real, non-defect maintenance cost.
- **Enhancement / Strategic** — future product or direction, not a defect.
- No item here is a production defect unless explicitly under P0.

---

## Executive Summary

StreetJS is a 54-package TypeScript monorepo (dependency-free core; `streetjs` /
`@streetjs/core` compat / `@streetjs/cli` lockstep line at `1.1.4` on npm with SLSA
provenance and cosign-signed release assets). The repository is clean, branch-synced,
green across all 44 CI workflows, and free of open security alerts.

The transition review found **no production defects** and **no leftover certification
artifacts polluting the tracked repository**. One piece of untracked local scratch (a
discarded git purge-mirror, `streetjs-mirror/`) was removed this engagement; it was
never committed. All `scripts/audit/*` and verification helpers are **intentionally
retained** tooling wired into CI, not scratch.

The main forward-looking themes are: consolidating duplicated resilience primitives,
decentralized plugin test coverage, closing the two known operational CI gaps
(`release-inputs.json` generation, keyless signing), and — strategically — Redis
Cluster / PostgreSQL-HA client capability as the flagship 2.0 feature.

**Final status: STABLE / MATURE** (justified in the last section).

---

## Repository Maturity Assessment

| Dimension | State (verified) | Notes |
|-----------|------------------|-------|
| Packages | 54 publishable | dependency-free core; clean lockstep line |
| Working tree / sync | clean; local == `origin/main` | Finding |
| Branches | remote `main` only; 0 open PRs | 2 stale local branches previously removed |
| Release line | `streetjs`/`@streetjs/core`/`@streetjs/cli` `1.1.4`, provenance OK | signed GitHub Release + SBOM |
| Security posture | 0 secret-scan / Dependabot / code-scan alerts; `npm audit` 0 | Finding |
| CI | 44 workflows; latest run per workflow on `main` = success | Finding |
| Docs site | Jekyll (just-the-docs), searchable, versioned surface | prior work |

**Leftover certification-artifact sweep (Finding):**
- `certification-report.json`, `sbom.json`, `RELEASE-CERTIFICATION.md`,
  `STREET_WEBSITE_ENTERPRISE_AUDIT.md`, `CLAUDE.md` → all **git-ignored** (generated
  locally / CI, not committed). Correct.
- `verification-artifacts/` → git-ignored, 0 tracked files. Correct.
- `keys/` → untracked and **empty** (correct resting state; no key material).
- `streetjs-mirror/` → untracked local git mirror (discarded purge mirror). **Removed
  this engagement.**
- `scripts/audit/*`, `scripts/verification/*`, `scripts/reliability/*`, etc. →
  **intentionally retained**; referenced by CI workflows (runtime certification,
  soak/chaos, provider integration, etc.). Not scratch.
- `docs/audits/` → historical report archive (13 dated reports + the single final
  certification). Intentionally retained as project record.

No tracked temporary/debug/scratch files were found.

---

## Architecture Assessment

**Findings:**
- **Duplicated resilience primitives (technical debt, Low).** Two independent
  `CircuitBreaker` classes exist — `packages/gateway/src/circuit-breaker.ts` and
  `packages/core/src/microservices/circuit-breaker.ts` — plus several ad-hoc retry
  helpers with their own backoff logic: `gateway/src/retry.ts` (`runWithRetry`,
  `computeRetryDelay`), `core/src/testing/chaos.ts` (`retryWithBackoff`),
  `core/src/observability/otel.ts` (`exportWithRetry`),
  `core/src/cloud/secret-providers.ts` (multiple `_fetchWithRetry` with hardcoded
  `[1000,2000,4000,8000,10000]` delay ladders), and transport-local
  `_connectWithRetry` / `_produceWithRetry` in rabbitmq/kafka. These are individually
  correct and tested, but the pattern is reimplemented ~7 times.
- **No circular dependencies** — retained tooling (`scripts/check-cycles.mjs`,
  `scripts/audit/circular-scan.mjs`) guards this; certification confirmed clean.

**Suggestions:**
- Extract a single internal `@streetjs/resilience` primitive (retry policy + backoff
  calculator + circuit breaker) and have gateway/core/transports/secret-providers
  consume it. Keep public re-exports where already exposed (gateway exports
  `runWithRetry`/`computeRetryDelay`) to avoid breaking the API.
- **Packages that could merge:** the 4 `dating-*` and 4 `social-*` vertical packages
  are fine as separate installables, but share enough surface that a documented
  "vertical package" contract (or an umbrella meta-package) would reduce per-package
  boilerplate. Suggestion only — current split is defensible.
- **Packages that could split:** none identified; `streetjs` (core) is large (22
  export subpaths) but its subpath exports already provide internal modularity.
- **Internal → public:** the resilience primitive above is the strongest candidate to
  promote to a documented public API once consolidated.
- **Public → deprecate (eventually):** `@streetjs/core` is already a deprecated compat
  shim re-exporting `streetjs`; plan its removal for a future major (2.0) once
  download telemetry shows migration.

---

## Maintainability Assessment

**Findings:**
- **Test-script coverage is decentralized for 7 packages.** `core-compat` (a
  generated shim — expected) and 6 HTTP plugins (`plugin-auth0`, `-r2`, `-s3`,
  `-sendgrid`, `-stripe`, `-twilio`) have **no local `test` script**; they are covered
  centrally by core's hardening suite and `npm run test:plugins-offline`. This is a
  deliberate, working arrangement, not a gap in coverage — but it makes per-package
  test intent non-obvious to a new contributor.

**Suggestions:**
- Add a thin per-plugin `test` script (even one that delegates to the central offline
  harness) so `npm test -w <pkg>` is meaningful everywhere and coverage locality is
  discoverable.
- Consolidate the 44 workflows' shared setup (already partially done via
  `.github/actions/setup`); consider a reusable workflow for the repeated
  build-plugin-then-integration pattern to reduce CI drift.

---

## Developer Experience Assessment

**Findings:**
- **All 54 packages ship a README** (the earlier `@streetjs/edge` gap is resolved).
- `street create` scaffolds a current project (`streetjs@^1.1.4`) that compiles clean
  (verified in the certification effort).
- CLI provides a broad command surface (`create`/`generate`/`make`/`migrate`/`dev`/
  `build`/`audit`/`certify`/`verify`/`plugin`) with consistent `[street]` prefixed
  output.

**Suggestions:**
- Publish a short "package map" (which of the 54 packages a consumer actually needs
  for common app shapes) — the breadth is a strength but can overwhelm newcomers.
- A `street doctor`/diagnostics summary that checks Node engine (>=22), DB reachability
  (`PG_HOST`), and plugin signatures in one command would smooth first-run friction
  (the Docker image currently fail-fasts on missing `PG_HOST`, which is correct but
  surprising to a first-time user).

---

## CI/CD Assessment

**Findings:**
- 44 workflows; every workflow's latest `main` run is success. Provenance publish
  (`ci-cd.yml`), backend publish (`publish-backend.yml`), signing verification, CodeQL,
  Scorecard, secret-scanning, runtime certification, and soak/chaos are all wired.
- Release is CI-driven and provenance-carrying; `scripts/release.sh` prepares + tags,
  CI publishes. cosign release-asset signing is on the new bundle format and validated
  on a core-line tag.

**Known operational CI gaps (not defects — tracked, external/maintainer-owned):**
- **`release-inputs.json` generation** (OUTSTANDING-ACTIONS #31): the "Release
  Engineering Enforcement" job fails on `workflow_dispatch`/`release` without a
  maintainer-supplied or CI-derived inputs file — by zero-trust design. Needs a
  derive-from-live-sources step or a secret-backed input; must not be "fixed" by
  committing a static scored file.
- **Platform Leadership aggregation** (#35): resolved for PRs via `--advisory`; the
  underlying artifact-availability model remains event-dependent by design.

**Suggestion:**
- Implement the recommended **"install every published package from the registry and
  import every export subpath" CI gate** (the exact check run manually this engagement:
  130/130). This is the guard that would have caught the F-4/F-5 packaging defect class
  automatically; it is the single highest-value CI addition.

---

## Documentation Assessment

**Findings:**
- Per-package READMEs: 54/54 present.
- Site is searchable and has a versioning surface + support matrix (prior work).
- CHANGELOG is consistent through `[1.1.4]`; migration doc exists for the
  `@streetjs/core` → `streetjs` rename.

**Suggestions:**
- Add a top-level ARCHITECTURE.md (package graph + the "which package do I need"
  guidance) — the governance/security docs are thorough, but a single architectural
  entry point is missing.
- Document the plugin test-coverage locality (central offline harness) so contributors
  don't mistake the 6 HTTP plugins as untested.

---

## Technical Debt Register

| ID | Item | Type | Impact | Priority | Est. effort |
|----|------|------|--------|:--------:|-------------|
| TD-1 | Duplicated resilience primitives (2× CircuitBreaker, ~7× retry/backoff) | Tech debt | Low — maintenance/consistency | P2 | 3–5 days (extract shared module + migrate callers, keep public re-exports) |
| TD-2 | 6 HTTP plugins + compat shim lack local `test` script (covered centrally) | Tech debt | Low — contributor clarity | P2 | 0.5 day (thin delegating scripts) |
| TD-3 | `release-inputs.json` not generated in CI (enforcement job fails by design) | Operational | Medium — blocks release-enforcement job on dispatch | P1 | 1–2 days (derive from Scorecard API + coverage artifact + `npm audit`) |
| TD-4 | Hardcoded backoff ladders in secret-providers (`[1000,2000,4000,8000,10000]`) | Tech debt | Low | P3 | folded into TD-1 |
| TD-5 | `@streetjs/core` compat shim retained | Planned deprecation | Low | P3 | remove in 2.0 after migration telemetry |

No verified defect exists. Missing provider credentials are **not** debt.

---

## Future Roadmap (P0–P4)

### P0 — Production issues
- **None.** No reproducible production or engineering defect exists as of `55a2581a`.

### P1 — High-value enhancements
- **P1-1** Registry install-and-import-every-subpath CI gate (prevents the F-4/F-5
  packaging defect class). *(from CI Assessment)*
- **P1-2** Close the `release-inputs.json` CI-generation gap (TD-3) so release
  enforcement passes on real dispatch without a hand-placed file.
- **P1-3** Redis Cluster + PostgreSQL-HA **client capability** (not just tests):
  `RedisClientOptions`/`PgConnectOptions` currently accept a single endpoint only
  (OUTSTANDING-ACTIONS #30). This is the highest-value production capability gap for
  enterprise deployments.

### P2 — Developer experience
- **P2-1** Extract `@streetjs/resilience` and migrate the ~7 duplicated call sites
  (TD-1).
- **P2-2** Per-plugin delegating `test` scripts + documented coverage locality (TD-2).
- **P2-3** `street doctor` first-run diagnostics; top-level ARCHITECTURE.md + package
  map.

### P3 — Ecosystem expansion
- **P3-1** Additional transports/databases/plugins (new official plugins under the
  signed-manifest model).
- **P3-2** Keyless (Sigstore/OIDC) or KMS/HSM plugin signing to reach SLSA L3 and
  remove the long-lived key (#12).
- **P3-3** OSS-Fuzz onboarding (#18) — external submission.
- **P3-4** Multi-version browsable docs.

### P4 — Long-term research
- **P4-1** Edge/serverless-first runtime profile (the `@streetjs/edge` package as a
  first-class deploy target with a trimmed core).
- **P4-2** Pluggable consensus/coordination for multi-node stateful features.
- **P4-3** Formal-methods expansion of the property-based test suite into more of the
  transport and database wire layers.

---

## StreetJS 2.0 Vision (12–24 months)

A realistic 2.0 is defined less by rewrites and more by **capability depth and
ecosystem trust**:

1. **HA by default.** Redis Cluster and PostgreSQL failover/replica-aware clients
   (P1-3) become the headline capability, turning StreetJS from single-endpoint-correct
   into topology-aware. This is the largest gap between "certified framework" and
   "enterprise default."
2. **Zero-long-lived-key supply chain.** Migrate plugin signing to keyless/OIDC (P3-2),
   so provenance + signatures require no operator-held secret and the framework can
   claim SLSA L3 end-to-end.
3. **Consolidated core primitives.** A single resilience layer (P2-1) and a documented
   public "vertical package" contract, letting the dating/social/commerce verticals and
   third parties build on stable, shared building blocks.
4. **Deprecation cleanup.** Retire the `@streetjs/core` compat shim (TD-5) in the 2.0
   major once migration telemetry supports it — simplifying the published surface to a
   single `streetjs` + scoped plugins model.
5. **Edge-native profile.** Promote `@streetjs/edge` to a first-class, trimmed runtime
   target for serverless/edge deploys (P4-1), broadening where StreetJS apps can run.
6. **Self-guarding CI.** The registry subpath-import gate (P1-1) plus derived release
   evidence (P1-2) make the release pipeline self-verifying, so future releases can't
   silently regress packaging or provenance.

None of the above is required for current correctness; all are growth directions.

---

## Final Project Status: **STABLE → MATURE**

**Classification: MATURE** (with active, non-defect roadmap work ongoing).

**Evidence-based justification:**
- **Not "Active Development" (in the unstable sense):** the public API is stable and
  additive-only across the 1.1.x line; no production defect exists; releases are
  provenance-signed and reproducible.
- **Beyond "Stable":** the project has a complete certification record, 0 open security
  alerts, full CI coverage (44 workflows green), signed releases, per-package docs, and
  a guarded dependency graph — the hallmarks of a mature codebase.
- **Not "Maintenance Mode":** there is a substantive, prioritized enhancement roadmap
  (HA clients, keyless signing, resilience consolidation) representing real forward
  development, not just upkeep.

The framework has **exited the certification phase**. Future work should proceed under
the normal software development lifecycle against the P0–P4 roadmap above. Re-entry into
certification is warranted only if new code changes introduce new risk.
