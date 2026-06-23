---
layout: default
title: Adoption & Go-To-Market Roadmap
nav_order: 72
permalink: /adoption/go-to-market-roadmap/
description: "Evidence-based execution roadmap to move StreetJS from technically mature to widely adopted — adoption, community, production proof, ecosystem, benchmarks, enterprise trust, positioning, and risk."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Adoption</span>
<h1>Adoption & Go-To-Market Roadmap</h1>
<p>The work that remains is people, proof, and positioning — not features. This is the execution plan.</p>
</div>

## Executive Summary

StreetJS is, by its own evidence-tiered audit, **technically mature and
adoption-poor**: composite ~**62/100** with engineering dimensions in the 80s but
**adoption 30, market competitiveness 48, enterprise readiness 55**
(`STREETJS-GAP-ANALYSIS.md`). It is published with provenance, 18 signed plugins,
a first-party ORM, runtime certification (9/9), reproducible 46/46 workspace
build, and green CI across 31 workflows. The binding constraints are **bus-factor
1, community ≈ 0, zero third-party production proof, no head-to-head benchmark,
and documentation-only compliance.**

The strategic error to avoid is **shipping more code**. Every objective below moves
a *social/market* metric. The single highest-leverage action in the next year is
**onboarding a second maintainer** (bus factor 1→2); the second is **landing the
first 10 real production users** and converting 3 into named case studies.

**One-line positioning:** *"The integrated TypeScript backend you can
self-host for the price of a coffee — auth, realtime, jobs, and a database driver
in one signed, ~64 MB dependency-light runtime."* Compete on **total cost of
ownership + supply-chain integrity + cohesion**, not on ecosystem size.

---

## SWOT Analysis (evidence-based)

**Strengths** — dependency-light core (3 runtime deps); **measured** low footprint
(~64 MB idle, ~94 MB +SQLite, ~5.7k req/s, ~30 KB/WS); supply-chain integrity
(provenance + SBOM + Ed25519 signing, 18/18 verify, 0 open ReDoS); cohesion
(auth/realtime/jobs/cache/ORM in one); reproducible build + runtime cert in CI;
strong governance/RFC scaffolding.

**Weaknesses** — bus factor 1; community ≈ 0; **no comparative benchmark**;
frontend packages pre-1.0; compliance documentation-only; tutorials early (6/100);
no hiring pool; discoverability unproven (name collisions).

**Opportunities** — "self-host on a budget" niche (the [budget guide](/deployment/budget/)
is a wedge); supply-chain-conscious teams (post-xz/npm-attack era); cost-fatigue
with Vercel/Auth0/Pusher bills; AI-assisted scaffolding moment; Node teams wanting
NestJS ergonomics without the dependency weight.

**Threats** — incumbents' ecosystems + hiring pools; "another framework" fatigue;
solo-maintainer continuity risk scaring adopters; a single security incident with
no response team; perception that 1.x version ≠ 1.x maturity.

---

## Adoption Roadmap (real users over more code)

### 30 days — "make it findable and trustworthy"
- Publish the comparative **benchmark suite** (see Benchmark Strategy) — the single
  most-shared artifact for a new framework.
- Ship 3 "wow in 5 minutes" runnable demos (Todo+auth, realtime chat, budget SaaS)
  with one-click deploy + a 90-second screencast each.
- Fix discoverability: canonical site SEO, a clear README hero, a "Why StreetJS"
  page anchored on the budget + supply-chain story.
- Open GitHub Discussions; seed 10 honest Q&A threads; add "good first issue" labels.
- **KPIs:** benchmark repo public; 3 demos live; ≥50 GitHub stars; ≥5 Discussions threads; site indexed.

### 90 days — "first users + first contributor"
- Land **3–5 real production users** (see Production Proof) — even small/internal.
- Convert 1 into a published case study.
- Merge the **first external contributor** PR; onboard a **second maintainer** (top risk mitigation).
- Expand tutorials 6→20; publish the "SQLite→Postgres" + migration-from-Express guides as runnable.
- Submit benchmarks to a neutral aggregator (e.g., TechEmpower-style community runs).
- **KPIs:** ≥3 production users; ≥1 case study; ≥2 maintainers; ≥3 external contributors; ≥250 stars; 20 tutorials.

### 180 days — "credibility + ecosystem"
- **10 production users**, **3 case studies** across 2+ industries.
- Ship the **next 8–10 high-demand plugins** (below); accept the first community plugin via the registry.
- Commission an **independent security review** of core + auth (enterprise wedge).
- Launch a lightweight **plugin marketplace** UI on top of the existing `registry-server`.
- **KPIs:** 10 production users; 3 case studies; 28 plugins (incl. ≥2 community); 1 security review published; ≥750 stars; ≥5 maintainers/regular contributors.

### 365 days — "defensible position"
- 25+ production users; 10 case studies; a recurring contributor base (≥15 active).
- SOC 2 Type I readiness evidence; pen-test report; a commercial-support offering.
- Frontend packages to 1.0; 50 tutorials; 25 example apps; conference talk / podcast circuit.
- **KPIs:** ≥25 production users; ≥10 case studies; ≥2.5k stars; ≥3 corporate adopters; commercial-support pilot; SOC 2 Type I in progress.

> Star counts are **proxy** metrics, not the goal. The real goal is the production-
> user and contributor counts; stars are reported only because they gate discovery.

---

## Community Roadmap (kill bus-factor first)

**Contributor acquisition**
- Curate 30+ **"good first issue"** items from real backlog (tests, docs, examples, small plugins) — not busywork.
- A **mentored-task** program (template already exists) pairing newcomers with the maintainer.
- "Plugin of the week" challenge — the lowest-barrier, highest-value contribution path given the signed-plugin model.

**The contributor ladder (already scaffolded in `docs/community/contributor-path.md`)**
`first-time → recurring contributor → reviewer (triage + review rights) → maintainer (merge rights) → Steering Committee`.
Make the criteria explicit and **time-boxed**: e.g., 5 merged PRs + 1 reviewed PR → reviewer nomination.

**Maintainer onboarding framework**
1. Reviewer access + a documented review checklist.
2. Pairing on releases (the publish workflows are automated + signed — low risk to delegate).
3. Co-ownership of a subsystem (CODEOWNERS entry).
4. Merge rights after a probation window.
5. Steering Committee seat per `GOVERNANCE.md`.

**Bus-factor plan (top organizational risk):** target **2 maintainers in 90 days,
3+ in 180**. Document release runbooks; ensure ≥2 people hold publish secrets;
record a "how releases work" screencast.

---

## Production Proof (the first 10 users)

**Where to find them (highest-propensity first):**
1. **Solo founders / indie hackers** building cost-sensitive SaaS — the budget guide is the hook.
2. **Internal tools / back-office** at small companies — low risk tolerance for a new framework is offset by self-host + supply-chain story.
3. **Realtime-heavy side projects** (chat, dashboards, multiplayer) — built-in WS/channels beats wiring Pusher.
4. **Supply-chain-conscious teams** (fintech-adjacent, gov-adjacent) attracted by provenance/signing/low-dep.

**Acquisition process:**
- Direct outreach: offer **free migration help** + a co-authored case study to 20 candidates → expect ~10 to try, ~3–5 to ship.
- "Built with StreetJS" registry (PR-based) + a showcase page.
- Office-hours / pairing sessions; turn every adopter into a testimonial.

**Case-study template** already exists (`docs/case-studies/`); add a **standard
intake** (workload, scale, before/after cost, gotchas) and require a named org or
verifiable handle (no anonymous claims — consistent with the project's honesty rule).

**Reference architectures to showcase:** (1) budget SaaS (StreetJS + SQLite/PG +
Caddy on one VPS), (2) realtime app (channels + presence), (3) AI app (RAG + tool
calls via the AI subsystem + `ai-ui`), (4) multi-tenant admin (RBAC + `admin-ui`).

---

## Ecosystem Expansion Plan

The `registry-server` (signed publish/verify/search REST API) already exists — what
is missing is a **marketplace UI + discovery + analytics** and **community plugins**.

**Next 20 plugins, prioritized:**

*High-demand (drive adoption — build first, 8):*
Drizzle/Prisma interop adapter · Resend (email) · Cloudflare KV/D1 · Upstash Redis ·
Better-Auth/Lucia interop · OpenTelemetry exporter presets · Sentry error tracking ·
Tigris/MinIO (S3-compatible self-host storage).

*Enterprise integrations (unlock procurement, 7):*
Okta/Azure AD (SAML/OIDC) · HashiCorp Vault / AWS KMS secrets · Datadog · Snowflake/BigQuery sink ·
LDAP/SCIM provisioning · Kafka Schema Registry · audit-log → SIEM (Splunk) exporter.

*Community-owned (seed the ladder, 5):*
Discord/Slack notifier · Telegram bot · Mailgun/Postmark · Algolia · Prometheus Grafana dashboard pack.

**Marketplace strategy:** a static, build-time site generated from the registry
(verified badge, signature status, download trend, certification level), with a
clear **Official / Verified / Community** trust tier. Keep submission PR-based and
**signature-gated** — trust is the differentiator, do not dilute it.

---

## Benchmark Strategy (credible, manipulation-resistant)

**Targets:** Express, Fastify, NestJS (Fastify adapter). **Methodology:**
- **Identical workloads:** (a) JSON echo, (b) 1-row Postgres read, (c) auth-protected route, (d) WS broadcast fan-out.
- **Same hardware, same Node, pinned versions, same client** (e.g. `wrk`/`autocannon` or `oha`), warm-up + ≥3 runs, report **p50/p95/p99 + RSS + CPU**, not just peak RPS.
- **Fairness requirements:** production config for every framework (no debug logging), same connection pooling, same JSON serializer where applicable; publish each competitor's exact config.
- **Anti-manipulation:** all configs + scripts in the repo; GitHub Actions runner so anyone can re-run; raw result artifacts committed; **invite competitors' maintainers to review the harness before publishing**; publish even where StreetJS loses.
- **Reporting:** a results table + flame-note on caveats; extend the existing `scripts/audit/` harness pattern; re-run on every minor release as a regression gate.

> Honesty rule: if StreetJS is slower on a workload, say so and explain why. A
> benchmark that always wins is correctly distrusted.

---

## Enterprise Roadmap (ranked by ROI)

| Rank | Action | ROI rationale | Effort |
|:----:|--------|---------------|:------:|
| 1 | **Independent security review** of core + auth, publish summary | Highest trust-per-dollar; unblocks procurement conversations | M |
| 2 | **Pen-test** (web + multi-tenant isolation) with remediation log | Directly addresses the top unverified-security gap | M |
| 3 | **SOC 2 Type I readiness** (controls + evidence) → Type II later | Table-stakes for regulated buyers; Type I is the cheap milestone | L |
| 4 | **Commercial support** offering (SLA, paid priority) via a backing entity | Removes the #1 procurement blocker (continuity) and funds maintainers | M |
| 5 | Compliance **evidence** (turn mappings into audited artifacts) | Converts documentation-only into defensible claims | L |

Sequence: 1–2 are achievable within 180 days and yield the most trust; 3–5 require
an organizational/legal entity and follow once revenue or sponsorship exists.

---

## Positioning

**Strongest differentiators (lead with these):**
1. **Total cost of ownership** — self-host a full backend for <$10/mo (measured footprint); replaces Auth0/Pusher/managed-queue bills.
2. **Supply-chain integrity** — provenance, SBOM, signed plugins, ~2 deps; a real answer to dependency-risk anxiety.
3. **Cohesion** — auth/realtime/jobs/ORM/observability that are *designed together*, not assembled.

**Where StreetJS should NOT compete:**
- Not "the fastest" (unproven — don't claim it).
- Not "biggest ecosystem" (it will lose to NestJS/Express for years).
- Not the Laravel/Django/Spring enterprise-incumbent fight head-on.

**Recommended market position:** **"The cost-efficient, supply-chain-safe,
integrated TypeScript backend for teams who want to self-host and own their
stack."** This avoids feature-for-feature war with NestJS/Fastify and targets an
underserved, growing segment (cost-fatigue + dependency-risk).

---

## KPI Dashboard

| Metric | Now (evidence) | 90d | 180d | 365d |
|--------|----------------|----:|-----:|-----:|
| Maintainers | 1 | 2 | 5 | 5+ |
| External contributors (cumulative) | ~0 | 3 | 10 | 25 |
| Production users | 0 verifiable | 3 | 10 | 25 |
| Case studies | 0 | 1 | 3 | 10 |
| GitHub stars (discovery proxy) | low | 250 | 750 | 2,500 |
| Official+community plugins | 18 / 0 | 18 / 1 | 26 / 2 | 30 / 8 |
| Published tutorials | 6 | 20 | 28 | 50 |
| Comparative benchmark | none | published | re-run/release | industry-submitted |
| Security review / pen-test | none | scoped | review published | pen-test + SOC2 Type I |

Track against `docs/adoption/adoption-scorecard.md`; report **measured** signals
only, `n/a (no signal)` otherwise — never estimate.

---

## Top 10 Risks (probability × impact)

| # | Risk | Prob | Impact | Mitigation |
|:-:|------|:----:|:------:|------------|
| 1 | **Bus factor 1** — maintainer burns out/leaves | High | Critical | Onboard 2nd maintainer in 90d; document runbooks; share publish secrets |
| 2 | **No community forms** — project stalls | High | Critical | Demos + benchmarks + good-first-issues + direct outreach; treat DevRel as the job |
| 3 | **No production proof** — adopters wait for others | High | High | Free migration help → first 10 users → case studies |
| 4 | **Benchmark backfires** (slower than claimed) | Med | High | Honest methodology; publish losses; optimize hot paths first |
| 5 | **Security incident, no response team** | Med | Critical | Security review + a 2-person response rota + documented disclosure |
| 6 | **"Another framework" fatigue** | High | Med | Niche positioning (cost + supply chain), not "better NestJS" |
| 7 | **Frontend 0.1.0 churn erodes trust** | Med | Med | Stabilize to 1.0 with a compatibility policy; mark clearly pre-1.0 |
| 8 | **Discoverability/SEO fails** | Med | Med | Canonical naming, comparison/SEO pages, aggregator submissions |
| 9 | **Compliance stays documentation-only** | Med | High (enterprise) | Convert to audited evidence; SOC 2 Type I |
| 10 | **Maintainer can't fund the work** | Med | High | Sponsorship + commercial support to sustain effort |

---

## Final Recommendation

Freeze net-new framework features for two quarters. Run a **DevRel-first** program
whose only success metrics are **maintainers, production users, and case studies**.
Concretely, in order:

1. **Onboard a second maintainer** (kills the #1 risk).
2. **Publish an honest comparative benchmark** (the most-shared trust artifact).
3. **Land + document the first 10 production users** (free migration help → case studies).
4. **Commission a security review** (the cheapest enterprise-trust unlock).
5. **Ship a marketplace UI + 8 high-demand plugins** on the existing registry.

The engineering is done and continuously re-verified in CI. From here, StreetJS
becomes a major framework only through **people, proof, and positioning** — and the
roadmap above is deliberately built so almost none of it requires writing more core
code.
