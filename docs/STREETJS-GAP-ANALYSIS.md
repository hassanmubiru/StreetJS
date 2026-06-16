---
layout:    default
title:     "Gap Analysis & Roadmap Audit"
nav_exclude: true
permalink: /STREETJS-GAP-ANALYSIS/
description: "Brutally honest, evidence-based competitive gap analysis of StreetJS for a skeptical CTO, security auditor, and OSS maintainer."
---

# StreetJS — Final Gap Analysis & Roadmap Audit

> Brutally honest, evidence-based. Written for a skeptical CTO, security auditor,
> and OSS maintainer. Evidence tiers: **VERIFIED** (executed proof this session) ·
> **IMPLEMENTED** (in repo, exercised by CI, not independently re-run) ·
> **PARTIAL** · **NOT IMPLEMENTED** · **UNKNOWN** (no evidence either way).
> Generated 2026-06-15 against `main`. No score is inflated; deductions are explained.

## How to read this

This audit does **not** take the feature checklist at face value. Where I executed
proof this session it is marked VERIFIED; where a feature exists in source and is
covered by green CI but I did not independently re-run it, it is IMPLEMENTED; where
I found no evidence it is NOT IMPLEMENTED or UNKNOWN. Performance claims are
**UNKNOWN** — no comparative benchmark was run, and the stability report
deliberately published no headline req/s numbers.

---

## 1. Platform Maturity Score

Scores are out of 100, judged against the named incumbents (NestJS, Fastify,
Express, Laravel, Django, ASP.NET Core, Spring Boot).

| Dimension | Score | Basis / deduction |
|-----------|:----:|-------------------|
| Architecture | **88** | VERIFIED: 46 packages, clean module boundaries, 0 circular deps repo-wide, native drivers, additive frontend layer. The former `@streetjs/core` cold-build wart is **resolved** — dependents migrated to `streetjs` and the shim is now workspace-buildable; **import-smoke 46/46, 0 skips**. |
| Security | **80** | VERIFIED: 18/18 Ed25519-signed plugins, provenance, SBOM, CodeQL/secret-scanning green, JWT/MFA/RBAC/vault/mTLS in source. Deduction: compliance is **documentation-only** (no audit); DAST has a workflow but **no execution evidence** seen; multi-tenant isolation not penetration-tested. |
| Reliability | **78** | VERIFIED: runtime cert 9/9, PG/MySQL/SQLite lifecycle + clean teardown, chaos **recovery** (~1s). PARTIAL: full soak (only 30s locally; 30/60-min scheduled), 10k-WS (only 1k locally), chaos matrix (only PG restart). No DR tooling. |
| Performance | **UNKNOWN (est. 70)** | No comparative benchmark executed. Native Node-core HTTP + native PG driver are *architecturally* favorable; 5k req @ ~5.7k rps / 1k WS @ 100% delivery were VERIFIED locally, but **no head-to-head vs Fastify/Express** exists. Treat as unproven. |
| Developer Experience | **70** | IMPLEMENTED: CLI scaffolding (`street create --frontend`), OpenAPI gen, typed client + React/Vue/Next/Nuxt hooks + UI kits, codemod/upgrade assistant, devtools package. Deduction: **no VS Code extension, no interactive API playground, no visual route/dep explorer verified**; tutorials 6/100 of target. |
| Documentation | **74** | VERIFIED: 130 doc pages, Jekyll site builds green, tutorials + 5 comparison pages + migration guides. Deduction: breadth ≫ depth; many advanced features lack standalone tutorials; **discoverability/SEO unproven** (new site, no traffic data). |
| Ecosystem | **62** | VERIFIED: 18 official signed plugins + a registry **server** (publish/verify/search REST API). Deduction: **zero third-party/community plugins**, no plugin **marketplace UI**, no plugin analytics, no published SDK generators. |
| Enterprise Readiness | **55** | IMPLEMENTED: RBAC/MFA/audit/mTLS/vault, enterprise + compliance docs, procurement FAQ. Deduction: **no certification/audit, no third-party production references, no SLA/support org, no DR**. Documentation ≠ attestation. |
| Open-Source Readiness | **80** | VERIFIED: MIT, GOVERNANCE + Steering Committee, RFC process (2 RFCs), CODEOWNERS, CoC, contributing, SBOM, provenance, security policy. Deduction: governance exists but is **untested by real external contributors**. |
| Adoption Readiness | **30** | The hard truth. **Community ≈ zero** (no verifiable external contributors, stars, Discord/Discussions activity), **single maintainer**, no hiring pool. Process is ready; people are not. |
| Long-Term Maintainability | **58** | VERIFIED: green CI across 29 workflows, runtime cert, dependency-light. Deduction: **bus factor = 1** is the dominant risk; large surface (46 packages) for one maintainer; some build-graph debt. |
| Market Competitiveness | **48** | Technically credible, but competing with NestJS/Django/Spring is won on **ecosystem, community, proof, and hiring** — all near-zero here. Engineering alone does not move this number. |

**Unweighted mean ≈ 65.** A reasonable adoption-weighted mean (weighting
community/ecosystem/proof heavily, as the market does) lands **lower, ~60**.

---

## 2. Missing Technical Features

### Backend
| Capability | Status | Evidence |
|------------|:------:|----------|
| ORM relations | **VERIFIED** | `@streetjs/orm` 0.1.0 published; relations + eager loading + 29 offline/5 live-PG tests |
| Model-first migrations | **VERIFIED** | `Orm.makeMigration` diff → up/down SQL; round-trip test |
| CQRS | **IMPLEMENTED** | `packages/core/src/microservices/cqrs.ts` (not re-run this session) |
| Event sourcing | **PARTIAL** | event bus + `platform/event-streaming.ts` exist; **no dedicated event store / aggregate replay** found |
| GraphQL ecosystem maturity | **PARTIAL** | `graphql/` + WS subscriptions in core; **not a mature ecosystem** (no codegen/federation evidence) |
| Workflow engine | **IMPLEMENTED** | `jobs/workflow.ts` |
| Service-mesh integration | **PARTIAL** | `cloud/runtime.ts` references mesh/istio; depth UNKNOWN |
| Distributed tracing depth | **IMPLEMENTED** | OpenTelemetry in source; **end-to-end trace depth unverified** |
| Secrets-management integrations | **IMPLEMENTED** | `security/secret-provider.ts`, vault mode; specific cloud-KMS adapters UNKNOWN |
| Multi-region deployments | **PARTIAL** | `platform/replication.ts`; **no live multi-region verification** |

### Developer Experience
| Capability | Status |
|------------|:------:|
| Visual route explorer | **NOT IMPLEMENTED** (no evidence) |
| Interactive API playground | **NOT IMPLEMENTED** (OpenAPI JSON emitted, but no bundled playground UI verified) |
| Dependency-graph visualizer | **PARTIAL** (devtools has a depgraph PBT test; UI UNKNOWN) |
| Framework DevTools | **IMPLEMENTED** (`packages/devtools` + docs) |
| VS Code extension | **NOT IMPLEMENTED** |
| AI-assisted code generation | **NOT IMPLEMENTED** |
| Upgrade assistant | **IMPLEMENTED** (`devx/upgrade.ts`, codemods, `verify:codemods`) |

### Operations
| Capability | Status | Evidence |
|------------|:------:|----------|
| Chaos testing automation | **PARTIAL** | harness + scheduled CI added this session; only PG-restart recovery VERIFIED |
| DAST execution evidence | **PARTIAL** | `dast.yml` exists; **no run evidence reviewed** |
| Kubernetes production verification | **PARTIAL/UNKNOWN** | manifests + `deploy-verify.yml`; **no real-cluster proof** |
| Disaster-recovery tooling | **NOT IMPLEMENTED** |
| Blue/green deployments | **NOT IMPLEMENTED** (no evidence) |
| Canary releases | **NOT IMPLEMENTED** (no evidence) |

### Ecosystem
| Capability | Status | Evidence |
|------------|:------:|----------|
| Plugin registry service | **IMPLEMENTED** | `packages/registry-server` (signed publish/verify/search REST API) |
| Plugin marketplace (discovery UI) | **NOT IMPLEMENTED** |
| Plugin analytics | **NOT IMPLEMENTED** |
| Community plugins | **NOT IMPLEMENTED** (0 verifiable) |
| SDK generators | **NOT IMPLEMENTED** (typed client is hand-written, not generated from OpenAPI) |

---

## 3. Security Review

| Area | Assessment | Risk |
|------|-----------|------|
| OWASP Top 10 | Partial-by-design: input validation, XSS sanitization, parameterized queries (no string SQL), rate limiting, security headers, CSRF-aware sessions present in source. **No third-party pen-test or OWASP ASVS attestation.** | Medium — unproven, not unaddressed |
| Supply chain | **Strong (VERIFIED):** provenance attestations, per-release SBOM, Ed25519 plugin signing (18/18), pinned Actions, gitleaks/TruffleHog, CodeQL. | Low |
| Secrets management | Vault mode + secret-provider abstraction in source. Specific managed-KMS adapters UNKNOWN. | Medium |
| Runtime protection | Rate limiting, body caps, auth-buffer caps; **no WAF/RASP**. | Medium |
| Secure defaults | Distroless Docker, non-root, security headers, httpOnly/Secure cookies in templates. | Low–Medium |
| Multi-tenant isolation | RBAC + tenancy in source; **isolation not adversarially tested**. | High (for regulated multi-tenant SaaS) |
| Plugin trust model | **Hardened this session:** signing is release-only + key-required; CI asserts build leaves tree clean. 18/18 verify. | Low |

**Top residual security risks (by severity):**
1. **Multi-tenant isolation unverified** (High) — needs adversarial testing before regulated multi-tenant use.
2. **Compliance is documentation-only** (High for regulated buyers) — SOC2/HIPAA/PCI mappings drafted, none audited/certified.
3. **No DAST execution evidence / no pen-test** (Medium-High).
4. **Single maintainer** = security-response bus factor (Medium-High).

---

## 4. Adoption Risk Analysis

| Factor | Status | Evidence |
|--------|--------|----------|
| Bus factor | **1** (critical) | Single primary author across 46 packages |
| Contributor count | **~1 verifiable** | No external contributor signal |
| Hiring availability | **None** | "StreetJS developer" does not exist as a hireable skill |
| Documentation discoverability | **Unproven** | New Jekyll site; no traffic/SEO data |
| Google discoverability | **Unproven/Low** | Name collisions, no backlinks/age |
| Community maturity | **≈ Zero** | No verifiable Discord/Discussions/stars activity |
| Long-term trust | **Low-but-rising** | Provenance + governance help; needs time + people |

**Why technically strong frameworks still fail adoption:** frameworks are adopted
for **ecosystem, hiring pool, longevity proof, and community answers** — not raw
features. A solo-maintained, zero-community framework presents unacceptable
*continuity risk* to teams regardless of code quality. This is StreetJS's single
largest gap, and it is **not solvable by writing more code.**

---

## 5. Enterprise Readiness

**Would a bank / healthcare / government / Fortune 500 adopt StreetJS today?**
**No** for regulated/core systems; **Maybe** for an internal, non-critical service
by an early-adopter team.

- **Technical reasons (No):** no certified compliance, no DR, no multi-region proof, no pen-test, multi-tenant isolation unverified, performance unbenchmarked.
- **Organizational reasons (No):** bus factor 1, no commercial support/SLA, no professional services, no reference customers.
- **Compliance gaps:** SOC2/HIPAA/GDPR/PCI are **mappings, not attestations**; no auditor sign-off.
- **Procurement barriers:** vendor-risk review fails on continuity (single maintainer), support, and references; OSS-only with no backing entity.

---

## 6. Competitive Benchmark

| vs | StreetJS stronger | StreetJS weaker | To reach parity |
|----|-------------------|-----------------|-----------------|
| **Express** | Batteries-included, typed, DI, native DB, built-in WS/auth, far fewer deps | Ecosystem, ubiquity, hiring pool, longevity | Community + middleware ecosystem |
| **Fastify** | Integrated platform (DI/ORM/auth/realtime) | Plugin ecosystem, JSON-schema serialization maturity, **proven perf**, community | Run real benchmarks; grow plugins |
| **NestJS** | Lighter deps, native DB driver, no Express/Fastify adapter, integrated realtime | Huge ecosystem, docs depth, courses, hiring pool, maturity | Ecosystem + docs + community + time |
| **Laravel** | TypeScript-native; one language full-stack | Eloquent/Horizon/Forge/Nova maturity, massive community, DX polish | Years of ecosystem + tooling |
| **Django** | TS/Node concurrency; realtime first-class | Django Admin, ORM maturity, packages, community, books | Auto-admin maturity + ecosystem |
| **Spring Boot** | Lightweight, fast start, less ceremony | Enterprise depth, integrations, vendor support, hiring | Enterprise integrations + support org |
| **ASP.NET Core** | Dependency-light, TS-native | Microsoft backing, perf pedigree, tooling, enterprise trust | Corporate backing + proof |

**Cross-cutting parity gap:** every incumbent wins on **ecosystem + community +
proof + hiring**, not on the feature list. StreetJS is at or near feature parity
on paper for many backend capabilities; it is far behind on the social/market moat.

---

## 7. Path to 90 / 95 / 100

### Road to ~90 (highest ROI — engineering/proof, achievable solo)
| Item | Effort | Risk | Δ |
|------|:-----:|:----:|:-:|
| Real comparative benchmark suite (vs Express/Fastify) with published methodology | M | Low | +4 |
| Run full soak (60-min) + 10k-WS + chaos matrix in CI, publish artifacts | M | Med | +3 |
| Fix `@streetjs/core` shim so all 46 cold-build; make `build --workspaces` green | ✅ **DONE** | Low | +2 |
| DAST execution evidence + K8s real-cluster verification in CI | M | Med | +3 |
| Expand tutorials 6→20 + interactive API playground bundling OpenAPI | M | Low | +3 |
| Second active maintainer onboarded (bus factor 1→2) | M | High (people) | +5 |

### Road to ~95 (enterprise-grade — needs org, not just code)
- Independent security pen-test + multi-tenant isolation audit.
- SOC2 Type II (or equivalent) **audit**, not mappings.
- DR tooling + blue/green/canary deploy automation with evidence.
- Commercial support path / backing entity / SLA.
- 3+ verifiable third-party production deployments (case studies with named orgs).

### Road to 100 (near-impossible — ecosystem adoption)
- Self-sustaining community: hundreds of contributors, thousands of stars, active forum.
- Hireable talent pool; third-party books/courses.
- 50+ community plugins + a real marketplace with analytics.
- Multi-year longevity track record.
- These are **emergent**, bought with years and people — not implementable.

---

## 8. Final Verdict

- **Current realistic score: ~62 / 100** (engineering ~80s; adoption/ecosystem/enterprise ~30–55 drag it down).
- **Maturity tier: "Technically production-capable, pre-adoption."** Solid 1.x engineering; ecosystem and proof of a 0.x project.
- **Adoption likelihood (12 mo): Low** without a deliberate community/maintainer push — the binding constraint is people, not code.
- **Enterprise likelihood (regulated/core): Low/No today**; **Maybe** for internal non-critical services by early adopters.
- **Open-source success likelihood: Moderate *if* a community forms** — the engineering, governance, and supply-chain foundations are genuinely strong (top-decile for a project this young); success now depends almost entirely on attracting maintainers, contributors, and real production users.

**Bottom line for the skeptical CTO:** StreetJS is a credibly engineered, signed,
CI-green, broad backend platform with an honest paper trail — but it is
single-maintained, community-less, unbenchmarked head-to-head, and
compliance-unattested. Adopt it today only for non-critical internal workloads
where you accept continuity risk. The remaining gap to the incumbents is
**~80% social/market (community, ecosystem, proof, hiring) and ~20% technical**
(benchmarks, full soak/chaos evidence, the `@streetjs/core` build wart, DR/
deploy-automation, compliance attestation).
