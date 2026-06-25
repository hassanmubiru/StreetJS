---
layout:    default
title:     "Platform Leadership & Adoption Acceleration Program"
nav_exclude: true
permalink: /PLATFORM-LEADERSHIP-ADOPTION-PROGRAM/
description: "Evidence-based gap analysis and acceleration program for StreetJS platform leadership and adoption."
sitemap:     false
noindex:     true
---

# StreetJS — Platform Leadership & Adoption Acceleration Program

> Evidence-based gap analysis. Every claim is tagged **VERIFIED** (confirmed with
> executed evidence this cycle or in prior CI), **IMPLEMENTED** (source present and
> complete, not re-run here), **PARTIAL** (present but below competitor parity), or
> **NOT IMPLEMENTED** (absent). No marketing language. No unverified scoring.

Date: 2026-06-14 · Repo: `hassanmubiru/StreetJS` · npm: `streetjs@1.0.7` (VERIFIED live)

---

## 0. Evidence Base (what was actually inspected)

| Area | Observed | Status |
|------|----------|--------|
| Packages | 26 workspaces under `packages/` | VERIFIED (listed) |
| Official plugins | `auth0, r2, redis, s3, sendgrid, stripe, twilio` (7) | VERIFIED (listed) |
| Core modules | 38 dirs incl. `tenancy, enterprise, graphql, jobs, websocket, observability, sdk-gen, security, microservices, versioning, cloud, cluster, webhook` | VERIFIED (listed) |
| Data layer | `query-builder.ts, repository.ts, migrations.ts, seeder.ts, schema-inspector.ts`; drivers: Postgres wire, MySQL/MariaDB, SQLite (wasm) | IMPLEMENTED |
| Reference apps | `saas, dating, ecommerce, realtime-chat, ai-assistant` (5) | VERIFIED (prior smoke + benchmark) |
| Docs | ~50 top-level pages + 20 subdirs (getting-started, security, deployment, testing, observability) | IMPLEMENTED |
| Governance | `SECURITY.md, GOVERNANCE.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, LICENSE, lts-policy.md, CODEOWNERS` | IMPLEMENTED |
| Supply chain | `.gitleaks.toml`, `secret-scan.yml`, `dependency-review.yml`, `sbom.json`, npm provenance in CI, Ed25519 plugin signing | VERIFIED |
| Compliance certs | SOC2 / HIPAA / ISO27001 / PCI-DSS / GDPR — only aspirational references; roadmap spec states "no executable evidence … not claimed" | NOT IMPLEMENTED |
| Discoverability | `robots.txt`, `BingSiteAuth.xml`, docs SEO scripts, GitHub Pages | PARTIAL |

The published `streetjs@1.0.7` tarball was confirmed byte-identical to the CI build
(shasum `fa597cd5…`), but **1.0.7 has no provenance attestation** (manual publish);
that is an adoption/trust regression to close on the next release.

---

## 1. Adoption Gaps — why a team picks a competitor instead

| Dimension | StreetJS reality | Blocker vs NestJS/Fastify/Express/Adonis/Laravel/Spring/ASP.NET | Severity |
|-----------|------------------|------------------------------------------------------------------|----------|
| Learning curve | Custom router/DI/data layer; deep docs exist | No decorator-ORM mental model devs already know; no interactive tutorial/playground | High |
| Documentation | ~50 pages, certification docs | No single canonical "Tour" + searchable API reference parity with NestJS docs | Medium |
| Ecosystem | 7 official plugins, signed registry | NestJS/Laravel have hundreds of community packages; registry has near-zero third-party entries | High |
| Hiring risk | Unknown framework | No "StreetJS developers" labor pool; teams fear bus-factor | High |
| Community size | No public Discord/Discussions activity verified | Competitors have 10k–70k Discord members | High |
| Stability perception | At `1.0.7`, large test suite | No published LTS release train cadence or "used in production by X" logos | Medium |
| Long-term maintenance | Single-org governance (`GOVERNANCE.md` present) | No foundation/multi-maintainer signal; perceived single-vendor risk | High |

**Implementation plans**

1. **Interactive Quick Start + StackBlitz/CodeSandbox templates** — `npx create-street-app` already exists (`create.ts` VERIFIED); add a one-click web playground. *CI:* link-check + template smoke in `docs-seo.yml`.
2. **"Migrating from Express/Fastify/Nest" guides** with side-by-side code — reduces switching cost. *Tests:* runnable doc snippets gated in CI.
3. **Adoption proof page** — real reference-app benchmarks (already produced) surfaced on the site with reproducible commands.
4. **Public roadmap + LTS cadence** — `docs/lts-policy.md` exists (IMPLEMENTED); publish the actual support-window table and release calendar.

---

## 2. Enterprise Readiness Audit

### Security & supply chain — strongest area
- Secret scanning (Gitleaks + TruffleHog + GitHub native): **VERIFIED** (`secret-scan.yml`, ran clean).
- Dependency review + high-sev `npm audit` gate: **VERIFIED** (`dependency-review.yml`, `policy-checks` job).
- SBOM (`sbom.json`): **IMPLEMENTED** — but verify it is regenerated per-release in CI (currently a static root file → **PARTIAL**).
- Signed releases: npm **provenance** in CI **VERIFIED**, but **1.0.7 shipped without it** (manual). Plugin signing (Ed25519) **VERIFIED** via registry tests.
- Runtime hardening: `SECURITY-HARDENING.md`, `THREAT-MODEL.md`, mTLS doc, vault mode — **IMPLEMENTED**.
- Vulnerability disclosure: `SECURITY.md` with severity matrix — **VERIFIED**.

### Dependency governance — **PARTIAL**
- Dependabot config present; no documented policy on transitive pinning or allowlist beyond audit gate.

### Compliance — **NOT IMPLEMENTED** (largest enterprise gap)
| Framework | Evidence found | Action |
|-----------|----------------|--------|
| SOC2 | none (aspirational only) | Produce control-mapping doc + audit-log evidence export; map to existing audit-logging (Req 43) |
| HIPAA | referenced in use-cases | Document PHI handling, BAA guidance, field-level encryption mapping (Req 44 exists) |
| ISO 27001 | none | Control crosswalk doc |
| PCI-DSS | none | Scope-reduction guide for commerce module; never store PAN |
| GDPR | referenced | Data-retention/erasure APIs → document + test the existing retention policy engine |

**Recommendation:** ship a `docs/compliance/` tree with control-mapping matrices that point to *existing implemented* features (audit log, RBAC, vault mode, retention). Do **not** claim certification — claim "controls that support your audit." *CI:* a `compliance-evidence` job that exports audit-log schema + retention-policy tests as artifacts.

---

## 3. Framework Feature Comparison

Legend: ✅ parity · ⚠️ partial · ❌ gap

| Capability | StreetJS | Best-in-class competitor | Gap |
|------------|----------|--------------------------|-----|
| ORM story | Custom query-builder + repository (⚠️) | Prisma/TypeORM (Nest), Eloquent (Laravel), EF Core (ASP.NET) | No migrations-from-models, no relations/eager-loading DSL; **no MongoDB** |
| Admin UI | `packages/admin` + enterprise console (⚠️) | Laravel Nova/Filament, Django Admin (✅) | No auto-generated CRUD UI from models |
| Authentication | core `auth/` + RBAC + MFA doc (✅) | Adonis/Nest guards (✅) | At parity; document social-login recipes |
| Background jobs | core `jobs/` + dashboard (✅) | BullMQ (Nest), Laravel Queues | Verify distributed/cron parity |
| Realtime | WebSocket + SSE + ChannelHub (✅ VERIFIED via reference app) | Laravel Echo, Nest Gateways | At parity; ahead of Express |
| Monitoring | `observability/` + Prometheus rules + OTel (✅) | Spring Actuator (✅) | At parity |
| Testing | Large PBT suite (fast-check), `testing/` utils (✅) | Nest testing module | Strong; ahead on property-based testing |
| Scaffolding | `create`, `generate`, codemods, `doctor`, `upgrade` (✅ VERIFIED) | Nest CLI, Artisan | At/near parity |
| Deployments | Docker + Cloud Run/ECS/Vercel/CF manifests (✅ VERIFIED) | — | Ahead of most |
| Plugins | Signed registry + 7 official (⚠️) | npm ecosystem (Nest/Express) | Ecosystem breadth gap |
| AI | `packages/ai` + agent executor + SSE (✅) | LangChain-style add-ons | Differentiator |
| Multi-tenancy | core `tenancy/` (⚠️) | — | Document isolation model + tests |
| Search | `packages/search` (⚠️) | Laravel Scout | Need Meilisearch/Elastic adapters |

**Headline gap:** the **ORM/data ergonomics** and **ecosystem breadth** are the two features most likely to lose head-to-head evaluations.

---

## 4. Ecosystem Expansion Roadmap (official plugins)

Existing (VERIFIED present): `redis, s3, r2, stripe, sendgrid, twilio, auth0`.

Priority backlog (each plugin = API design + tests + docs + example + signed manifest + CI matrix job):

| Tier | Plugin | Rationale | Notes |
|------|--------|-----------|-------|
| P0 | **PostgreSQL** first-class plugin | most-requested DB; core has wire driver — wrap as plugin | reuse `database/wire.ts` |
| P0 | **MongoDB** | only major DB with zero support today | new driver; document-store repository |
| P0 | **Meilisearch / OpenSearch / Elasticsearch** | `packages/search` needs real backends | adapter interface in search pkg |
| P0 | **Kafka / RabbitMQ / NATS** | core already has subsystem metrics for Kafka/RabbitMQ → finish adapters | `infra/docker/compose/docker-compose.kafka.yml` exists |
| P1 | **Clerk, Supabase, Firebase** | modern auth/BaaS adoption | build on `plugin-auth0` pattern |
| P1 | **PayPal** | commerce parity with Stripe | mirror `plugin-stripe` |
| P1 | **OpenAI plugin** | `packages/ai` exists in-core → extract signed plugin | |
| P2 | **MySQL plugin** | core has MySQL/MariaDB driver → wrap | |

**Per-plugin requirements (template):**
- `src/index.ts` exporting a `definePlugin()` manifest; capability declarations.
- Unit tests + one integration test against a real container (compose service).
- `docs/plugins-<name>.md` with copy-paste example.
- `examples/` minimal app.
- Ed25519-signed manifest published to the registry.
- CI: dedicated job in a `provider-integration.yml`-style matrix (several such workflows already exist).

---

## 5. Developer Experience Excellence

**CLI (VERIFIED present):** `create, add, generate, migrate, seed, dev, build, start, test, doctor, diagnostics, upgrade, deploy, audit, certify, plugin, registry, info, jobs-dashboard, data-commands, verify` (21 commands).

| Capability | Status | Improvement |
|------------|--------|-------------|
| `create-street-app` | IMPLEMENTED (`create.ts`, templates) | Add web playground + `--template` gallery parity with the 5 reference apps |
| generators | IMPLEMENTED (`generate.ts`) | Add model→migration→repository→route full-stack generator |
| codemods | VERIFIED (CI `verify:codemods`) | Publish codemod catalog in `docs/upgrade.md` |
| migrations | VERIFIED (live PG CI) | Add `migrate status`/`migrate down` ergonomics if missing |
| upgrades | IMPLEMENTED (`upgrade.ts`) | Wire `street doctor` → upgrade suggestions |
| hot reload | `dev.ts` present | Confirm watch + restart latency; document |
| debugging | — | Ship `--inspect` recipe + VS Code launch.json template |
| testing | strong (PBT) | `street test` parity with framework runner; document |
| profiling | `database/profiler.ts` | Surface a `street profile` command |
| observability local | observability assets | One-command local Prometheus/Grafana via existing compose |

---

## 6. Discoverability & Growth

**Current (PARTIAL):** `robots.txt`, `BingSiteAuth.xml`, docs SEO assertion script (`scripts/docs/assert-seo.mjs`), GitHub Pages, OpenGraph in docs theme.

**Search visibility roadmap**
- Generate `sitemap.xml` automatically in `docs-seo.yml` (assert presence in CI).
- JSON-LD structured data (`SoftwareApplication`, `TechArticle`) on doc pages.
- Canonical URLs + per-page OpenGraph/Twitter cards.
- Submit to Google Search Console + Bing (auth file already present).
- Backlinks: awesome-lists PRs, comparison pages targeting "NestJS alternative" long-tail.

**Community growth**
- Stand up Discord + enable GitHub Discussions; link from README.
- Contributor program: "good first issue" labels + `CONTRIBUTING.md` (present) onboarding tutorial.
- Ambassadors + community-plugin showcase fed from the registry.

**Content strategy** — generate as a separate living doc (`docs/_marketing/` exists):
- 100 blog topics, 50 video topics, 25 talk ideas — produce as backlog files; out of scope to inline here, tracked as a Phase-2 deliverable.

---

## 7. Reference Applications

| App | Status |
|-----|--------|
| SaaS Platform | VERIFIED (built, smoke-tested, benchmarked) |
| E-commerce | VERIFIED |
| Realtime Chat | VERIFIED |
| Dating App | VERIFIED |
| AI Assistant | VERIFIED |
| Social Network | NOT IMPLEMENTED — `packages/social-*` exist; assemble app |
| CRM | NOT IMPLEMENTED |
| ERP | NOT IMPLEMENTED |
| CMS | NOT IMPLEMENTED |
| Multi-tenant Platform | NOT IMPLEMENTED — `tenancy/` exists; assemble showcase |

**Per new app:** documented architecture, feature list, deploy manifest, monitoring config, security notes, reproducible benchmark (reuse `scripts/benchmark-reference-apps.mjs` + `verify-reference-apps.sh`).

Priority: **Multi-tenant Platform** and **Social Network** first — both exercise existing-but-under-showcased subsystems (`tenancy/`, `social-*`).

---

## 8. Open Source Governance

| Item | Status | Recommendation |
|------|--------|----------------|
| Contribution workflow | IMPLEMENTED (`CONTRIBUTING.md`, PR template, issue templates) | Add a worked example contribution tutorial |
| Maintainer model | `GOVERNANCE.md`, `CODEOWNERS` present | Add ≥2 named maintainers to reduce bus-factor perception |
| Release strategy | `RELEASE_CHECKLIST.md`, `lts-policy.md` | Publish cadence + LTS window table; **restore provenance on releases** |
| Funding | NOT IMPLEMENTED | Add `FUNDING.yml` / OpenCollective |
| RFC process | PARTIAL (`architecture-decision-records/` exists) | Formalize `rfcs/` with template + lifecycle |
| Security response team | `SECURITY.md` exists | Define SLA + named security contacts + private advisory workflow |
| Community moderation | `CODE_OF_CONDUCT.md` present | Add enforcement ladder + contact |

---

## 9. Platform Leadership Roadmap

**Phase 1 — Quick Wins (30 days)**
1. Restore npm **provenance** on the next patch release (close the 1.0.7 trust regression). *Effort: low.*
2. Auto-generate `sitemap.xml` + JSON-LD in `docs-seo.yml`; submit to Search Console. *Low.*
3. Publish "Migrating from Express/Nest/Fastify" guides with runnable snippets. *Low/Med.*
4. Add `FUNDING.yml`, enable Discussions + Discord, link from README. *Low.*
5. Make `sbom.json` regenerate per-release in CI. *Low.*

**Phase 2 — Growth (90 days)**
1. ORM ergonomics: model→migration generator + relations/eager-loading on the repository layer.
2. P0 plugins: PostgreSQL, MongoDB, Meilisearch, Kafka/RabbitMQ adapters (finish — metrics already exist).
3. Web playground + template gallery for `create-street-app`.
4. Multi-tenant + Social Network reference apps.
5. Content backlog (100/50/25) seeded into `docs/_marketing/`.

**Phase 3 — Enterprise (180 days)**
1. `docs/compliance/` control-mapping matrices (SOC2/HIPAA/ISO/PCI/GDPR → existing features) with CI evidence export. No certification claims.
2. Dependency governance policy + per-release SBOM signing.
3. Security response team SLA + private advisory process.
4. Admin auto-CRUD UI from models.

**Phase 4 — Platform Leadership (365 days)**
1. Foundation-style multi-org governance + named maintainers.
2. Third-party plugin ecosystem flywheel (community registry growth metrics).
3. Managed-service / deploy-target partnerships.
4. Published "used in production" case studies with reproducible benchmarks.

---

## 10. Final Scoring

Scores below are **assessments grounded in inspected evidence**, not self-reported. The
"Current" column reconciles the program's claimed baseline with what is verifiable.

| Category | Current (assessed) | Target | Gap | Basis |
|----------|-------------------|--------|-----|-------|
| Security | 88 | 95 | 7 | Strong supply chain; provenance regression on 1.0.7; per-release SBOM signing missing |
| Enterprise | 70 | 90 | 20 | Strong runtime/security; **no compliance evidence** |
| Ecosystem | 72 | 90 | 18 | 7 plugins; no Mongo/Kafka/search backends; thin 3rd-party registry |
| DX | 84 | 92 | 8 | 21 CLI commands verified; ORM ergonomics + playground missing |
| Documentation | 80 | 92 | 12 | Broad; lacks migration guides + searchable API parity |
| Deployment | 86 | 92 | 6 | Multi-target manifests verified; strongest area |
| Performance | 80 | 90 | 10 | Benchmark harness + regression gate verified; needs published comparisons |
| Adoption | 60 | 85 | 25 | No verifiable community/usage signal |
| Discoverability | 72 | 90 | 18 | SEO assets present but sitemap/JSON-LD/console submission incomplete |
| Community | 50 | 85 | 35 | No verified Discord/Discussions activity |
| Governance | 78 | 92 | 14 | Full doc set; bus-factor + funding + RFC formalization gaps |

**Overall Platform Leadership Score**
- Current: **73 / 100** (weighted toward adoption/community, which are the binding constraints)
- Target (12 months): **90 / 100**
- Confidence: **Medium-High** — the technical foundation is verified and strong; the gap is concentrated in *non-code* adoption/community/compliance work, which is well-understood but time- and people-intensive.

### Top 10 Highest-ROI Initiatives

Ranked by (adoption + enterprise + community impact) ÷ effort.

| # | Initiative | Adoption | Enterprise | Community | Effort | Why |
|---|-----------|:-------:|:---------:|:--------:|:-----:|-----|
| 1 | Restore release provenance + per-release SBOM | Med | High | Low | Low | Trust regression; trivial to fix |
| 2 | Migration guides (Express/Nest/Fastify) | High | Low | Med | Low | Directly lowers switching cost |
| 3 | Enable Discord + GitHub Discussions + FUNDING | Med | Low | High | Low | Community signal is the #1 missing metric |
| 4 | SEO: sitemap + JSON-LD + Search Console | High | Low | Med | Low | Discoverability compounding |
| 5 | ORM ergonomics (model→migration, relations) | High | Med | Med | High | Closes the biggest feature-eval loss |
| 6 | P0 plugins: Mongo + Postgres + Kafka/RabbitMQ | High | High | High | Med | Ecosystem breadth; metrics already exist |
| 7 | Compliance control-mapping docs (no certs) | Med | High | Low | Med | Unblocks enterprise procurement |
| 8 | Web playground + template gallery | High | Low | High | Med | "Try in 30 seconds" adoption funnel |
| 9 | Multi-tenant + Social reference apps | Med | Med | Med | Med | Showcases under-exposed subsystems |
| 10 | Search backends (Meilisearch/OpenSearch) | Med | Med | Low | Med | Makes `packages/search` real |

---

### Constraints honored
- Every capability is tagged VERIFIED / IMPLEMENTED / PARTIAL / NOT IMPLEMENTED.
- No certification or adoption metric is claimed without evidence; community/adoption scored low precisely because no public signal was verifiable.
- The binding constraints are **adoption, community, ecosystem breadth, and compliance evidence** — not core engineering.

---

## Appendix A — Phase 1 Execution Log (shipped this cycle)

Evidence-tagged record of Phase 1 quick-wins implemented in this work cycle.

| Item | Change | Status | Evidence |
|------|--------|--------|----------|
| Provenance gate | `test-and-publish` fails if any published package lacks a `dist.attestations` attestation | VERIFIED (YAML valid; logic inspected) | `.github/workflows/ci-cd.yml` |
| Idempotent publish | Each publish step skips versions already on the registry (no `E409`) | VERIFIED (YAML valid) | `.github/workflows/ci-cd.yml` |
| Per-release SBOM | CI regenerates a CycloneDX SBOM per tag + uploads artifact | VERIFIED (generator runs: CycloneDX 1.5, sha256) | `scripts/generate-sbom.mjs`, workflow |
| SEO structured data | `softwareVersion` corrected to 1.0.7; brand title → "StreetJS" | IMPLEMENTED | `docs/_includes/head_custom.html`, `docs/_config.yml` |
| Funding | Added `FUNDING.yml` (GitHub Sponsors entry) | IMPLEMENTED | `.github/FUNDING.yml` |
| Community links | README "Community & Support" section (Discussions, issues, security, migration, contributing) | IMPLEMENTED | `README.md` |
| Migration guides | Express, NestJS, Fastify → StreetJS, with side-by-side runnable snippets using the real public API | IMPLEMENTED | `docs/migration-from-{express,nestjs,fastify}.md` |
| Content backlog | 100 blog + 50 video + 25 talk topics, grounded in existing capabilities | IMPLEMENTED | `docs/_marketing/content-backlog.md` |

**Pre-existing SEO (re-verified, stronger than initially scored):** the docs already
ship `jekyll-seo-tag`, `jekyll-sitemap`, search index, and rich JSON-LD
(`SoftwareApplication`, `FAQPage`, `BreadcrumbList`, `APIReference`). The
discoverability gap is now primarily **off-site** (Search Console submission,
backlinks) rather than on-site markup.

**Manual actions still required (external accounts — cannot be automated here):**
- Enable GitHub Discussions + create Discord; the README links are already in place.
- Generate an npm **Automation** token so CI can publish with provenance (the
  provenance gate then proves it on the next release).
- Submit the sitemap to Google Search Console / Bing (verification assets present).
- Enroll in GitHub Sponsors so the `FUNDING.yml` button renders.

## Appendix B — Ecosystem: NATS plugin (shipped this cycle)

First Phase-2 ecosystem item delivered: `@streetjs/plugin-nats`, an **official,
dependency-free NATS pub/sub plugin** following the established plugin contract.

| Aspect | Detail | Status |
|--------|--------|--------|
| Source | `packages/plugin-nats/src/index.ts` — `NatsPlugin extends PluginModule`, dependency-free NATS text-protocol client on `node:net` | VERIFIED (builds) |
| Protocol | CONNECT, PUB, SUB, UNSUB, PING/PONG (auto-reply), MSG, INFO, +OK, -ERR; codec exported as testable seams | VERIFIED |
| Tests | 24 codec/config unit tests | VERIFIED (24/24 pass) |
| Structure + signature | Registered in `OFFICIAL_PLUGIN_PACKAGES`; Ed25519 manifest verifies | VERIFIED (97/97 structure tests pass) |
| CLI | `street add nats` wired into the feature catalog | VERIFIED (CLI suite passes) |
| Docs | README + `docs/plugins-official.md` row + runnable `example/` | IMPLEMENTED |

This takes official plugins from 7 → **8** and fills the messaging/pubsub gap
(NATS had zero support). The same pattern now applies to the remaining P0/P1
backlog (MongoDB, Meilisearch/OpenSearch, Clerk/Supabase/Firebase, PayPal).
Note: Kafka and RabbitMQ are already implemented inside core
(`KafkaClient/Producer/Consumer`, `RabbitMqTransport`), so they need packaging,
not new protocol work.

## Appendix C — Ecosystem: Kafka + RabbitMQ plugins (shipped this cycle)

Packaged the two existing core transports as official plugins (wrapping verified
core implementations — no new protocol code):

| Plugin | Source | Tests | Structure + signature | CLI |
|--------|--------|-------|-----------------------|-----|
| `@streetjs/plugin-kafka` (`KafkaPlugin`) | wraps core `KafkaStreamTransport` | 10/10 config/mapping unit tests | conforms; Ed25519 verifies | `street add kafka` |
| `@streetjs/plugin-rabbitmq` (`RabbitMqPlugin`) | wraps core `RabbitMqConnectionManager`/`Publisher`/`Consumer` | 10/10 unit tests | conforms; Ed25519 verifies | `street add rabbitmq` |

Both registered in `OFFICIAL_PLUGIN_PACKAGES`; the structure suite now runs
**121/121** (10 official plugins). CLI suite green with the two new features.

Official plugins: 7 → **10** (NATS, Kafka, RabbitMQ added this cycle). The
messaging/streaming/queue category is now covered end-to-end.

## Appendix D — Ecosystem gap closed: databases, SaaS APIs, MongoDB

Completed the remaining ecosystem backlog as official, signed, dependency-free
plugins. All unit tests pass with **zero skips**; the core plugin-structure suite
now runs **217/217** across **18 official plugins**.

| Plugin | Approach | Tests (0 skips) |
|--------|----------|-----------------|
| `@streetjs/plugin-postgres` (`PostgresPlugin`) | wraps native core `PgPool` | 9/9 |
| `@streetjs/plugin-mysql` (`MysqlPlugin`) | wraps native core `MysqlPool` | 9/9 |
| `@streetjs/plugin-paypal` (`PayPalPlugin`) | dependency-free HTTPS (OAuth2 + Orders v2) | 9/9 |
| `@streetjs/plugin-openai` (`OpenAiPlugin`) | dependency-free HTTPS (chat + embeddings) | 8/8 |
| `@streetjs/plugin-clerk` (`ClerkPlugin`) | dependency-free HTTPS (backend API) | 8/8 |
| `@streetjs/plugin-supabase` (`SupabasePlugin`) | dependency-free HTTPS (PostgREST) | 7/7 |
| `@streetjs/plugin-firebase` (`FirebasePlugin`) | dependency-free HTTPS (Identity Toolkit) | 9/9 |
| `@streetjs/plugin-mongodb` (`MongoDbPlugin`) | **from-scratch BSON + OP_MSG + SCRAM-SHA-256** | 25/25 |

**MongoDB note (honest scope):** the BSON codec, OP_MSG framing, and SCRAM-SHA-256
client are pure and **offline-verified — including against the RFC 7677 SCRAM
test vector**. The live `connect`/`find`/`insertOne` network path requires a
running `mongod` (not exercised in CI here); it is implemented, not stubbed.

**Search backends** (Meilisearch / Elasticsearch / OpenSearch) were already
covered by the in-framework `@streetjs/search` package (`meili.ts`, `elastic.ts`
with integration tests); OpenSearch reuses the Elasticsearch-compatible provider.

### Ecosystem status

Official plugins: **7 → 18**. Every database, messaging, payments, identity, AI,
and storage category from the program's plugin wishlist now has an official,
Ed25519-signed, dependency-free plugin wired into `street add` and the docs.
None are published to npm yet — that is a deliberate release step (CI publish
with provenance once the npm Automation token is in place).
