# Content Roadmap — StreetJS (Phase 18, Workstream F: Content Engine)

> **Editorial principle:** every scheduled piece maps to a strength that is
> **VERIFIED in the repo today**. No vaporware, no marketing claims without
> evidence, no fabricated benchmarks or adopters. Numbers are only published when
> they are **MEASURED** in the repo. This document supersedes and folds in the
> prior roadmap plus `CONTENT-DRAFTS.md`, `docs/_marketing/content-backlog.md`,
> and `docs/blog/`. Findings are tagged **VERIFIED / GAP / RISK / RECOMMENDATION**.

---

## 1. Topic verification ledger

Each candidate topic was checked against in-repo source before being scheduled.
Only **VERIFIED** topics are scheduled below. **GAP** topics are explicitly held
back (out of scope for content until the backing exists).

| # | Candidate topic | Status | Evidence (path) |
|---|---|---|---|
| 1 | **Native drivers** (no `pg`/`mysql2`/vendor SDKs) | ✅ **VERIFIED** | `docs/blog/native-postgres-driver.md`; `packages/plugin-postgres/`; `packages/plugin-mysql/src/index.ts` (native MySQL protocol, "no `mysql2`"); `packages/plugin-mongodb/src/` (BSON + OP_MSG + SCRAM-SHA-256, see `dist/index.d.ts`); `packages/plugin-redis/src/index.ts` (RESP2 over `node:net`); `packages/plugin-kafka/src/index.ts` (from-scratch Kafka protocol, "no vendor SDK") |
| 2 | **Building SaaS apps** (`--starter saas`) | ✅ **VERIFIED** | `packages/cli/src/commands/create.ts` → `TEMPLATES.saas`: orgs/memberships/invitations/RBAC/audit/api-keys/settings migrations (`migrations/001_saas.sql`–`003_settings.sql`), `OrgService`, `MembershipService`, `InvitationService`, `ApiKeyService`; `docs/starters.md`; in-repo `SAAS.md` template |
| 3 | **HTMX + TypeScript** (`--frontend htmx`) | ✅ **VERIFIED** | `packages/plugin-htmx/`; `docs/htmx/` (getting-started, forms, partials, rendering-views, realtime, authentication, deployment); `create.ts` `FRONTENDS = ['none','react','next','htmx']` + `scaffoldHtmx()`; SaaS dashboard renders htmx views (`ctx.htmx.view/.partial`) |
| 4 | **Multi-tenant architecture** | ✅ **VERIFIED** | `create.ts` `src/middleware/tenant.ts`: `tenantResolver` (membership gate → 401/403) and `orgScopedRepo` (org_id-stamped reads/writes, cross-tenant 403); `MembershipService.resolveActiveOrg` membership gate |
| 5 | **MarzPay integration** (`--with-marzpay`) | ✅ **VERIFIED** | `packages/plugin-marzpay/`; `docs/integrations/marzpay/` (getting-started, payments, subscriptions, webhooks, saas-billing, security, htmx/next/react examples); `create.ts` `flagPackages['with-marzpay']` + `migrations/004_marzpay_billing.sql` + `.env.marzpay.example` + React/Next overlays |
| 6 | **Realtime applications** (`--starter realtime`) | ✅ **VERIFIED** | `create.ts` `TEMPLATES['realtime-chat']` (channels, presence, typing; `migrations/001_realtime.sql`, `REALTIME.md`); core `StreetWebSocketServer` (`packages/core/src/websocket/server.ts`, `maxConnections: 10_000`, heartbeats); `ChannelHub` (`packages/core/src/websocket/channels.ts`); SSE (`websocket/sse.js`); `docs/realtime/` |
| 7 | **Dependency-light architecture** | ✅ **VERIFIED** | `packages/core/package.json` (3 runtime deps: `reflect-metadata`, `ws`, `zod`); `docs/blog/why-2-dependencies.md`; dependency-free plugins (redis/kafka/mongodb/mysql comments); `docs/sustainability/README.md` |
| — | **Named customer case studies** | ⚠️ **GAP** | `docs/case-studies/` contains only **templates** (`README.md`, `template-benchmark.md`, `template-deployment.md`, `template-migration.md`) — no real adopters. **NOT scheduled as real case studies.** See §5. |
| — | **Performance benchmark posts** | ✅ **VERIFIED (conditional)** | `~5,700 req/s` and `~30 KB/WebSocket` are **MEASURED** per `docs/blog/self-hosting-cost.md` + budget guide. **RISK:** only publish figures reproducible from the repo's benchmark harness; never estimate. |

**Existing assets folded in (VERIFIED present):** `docs/blog/index.md` (3 live
posts + planned list), `CONTENT-DRAFTS.md` (ready-to-post social copy),
`docs/_marketing/content-backlog.md` (100 blog / 50 video / 25 talk ideas). This
roadmap sequences and prioritizes that backlog against verified strengths rather
than replacing it.

---

## 2. Editorial roadmap by horizon

Formats: **blog** (engineering deep-dive), **tutorial** (build-along),
**comparison** (vs Express/Nest/Fastify), **case-study** (reference-app /
template based — see GAP note), **video**, **social**.

Every piece links a **canonical docs URL** (drives indexed referral traffic);
repurpose order is 1 deep article → 1 video → ~5 social posts (atomize).

### Horizon A — 0–3 months (differentiated, defensible, zero new product work)

Lead with the most searchable, most defensible angles that already have published
backing. These convert evaluators and need no engineering.

| # | Title | Format | Verified strength (evidence) | Audience | Dependencies |
|---|---|---|---|---|---|
| A1 | Why StreetJS has so few runtime dependencies | blog (live → amplify) | Dependency-light, 3 runtime deps (`docs/blog/why-2-dependencies.md`, `packages/core/package.json`) | Node/TS backend devs, security-minded leads | None (published) |
| A2 | Talking to PostgreSQL without the `pg` package | blog (live → amplify) | Native PG driver (`docs/blog/native-postgres-driver.md`) | Backend devs, DBAs | None (published) |
| A3 | Self-hosting a full backend on one small VPS | blog (live → amplify) | Cost case, MEASURED (`docs/blog/self-hosting-cost.md`) | Founders, cost-conscious teams | RISK: keep figures MEASURED-only |
| A4 | Build a SaaS backend in one command (`--starter saas`) | tutorial | SaaS starter (`create.ts` `TEMPLATES.saas`, `docs/starters.md`) | SaaS founders, full-stack devs | A1–A2 published first |
| A5 | Multi-tenant data isolation: `orgScopedRepo` + `tenantResolver` | blog | Multi-tenancy (`create.ts` `src/middleware/tenant.ts`) | Senior/architect, SaaS teams | A4 |
| A6 | Server-rendered apps with HTMX + TypeScript (`--frontend htmx`) | tutorial | HTMX plugin (`packages/plugin-htmx/`, `docs/htmx/`) | Full-stack devs avoiding SPA complexity | None |
| A7 | Realtime chat from scratch (`--starter realtime`) | tutorial + video | Realtime (`TEMPLATES['realtime-chat']`, core `StreetWebSocketServer`/`ChannelHub`) | Realtime app builders | None |
| A8 | Launch social pack (X thread, LinkedIn, Reddit r/node) | social | Folds in `CONTENT-DRAFTS.md` copy | Top-of-funnel | A1–A3 |

### Horizon B — 3–6 months (depth + ecosystem breadth)

Deepen the verified strengths and broaden across the native-driver story and the
official plugin ecosystem.

| # | Title | Format | Verified strength (evidence) | Audience | Dependencies |
|---|---|---|---|---|---|
| B1 | The same idea everywhere: native MySQL/Mongo/Redis/Kafka clients | blog | Native drivers (`plugin-mysql/mongodb/redis/kafka` src) | Backend devs evaluating the ecosystem | A2 |
| B2 | SCRAM-SHA-256 by hand: authenticating to Postgres & Mongo | blog | `plugin-mongodb` SCRAM (`scram.ts`), PG driver | Security engineers, protocol nerds | A2, B1 |
| B3 | Accept payments with MarzPay (`--with-marzpay`) | tutorial | MarzPay (`plugin-marzpay`, `docs/integrations/marzpay/`) | SaaS/commerce builders (esp. African mobile-money) | A4 |
| B4 | Subscriptions & billing webhooks with MarzPay | tutorial | `docs/integrations/marzpay/{subscriptions,webhooks,saas-billing}.md`, `migrations/004_marzpay_billing.sql` | SaaS founders | B3 |
| B5 | RBAC without a module graph: `requireRoles` in practice | blog | SaaS RBAC (`create.ts` `src/features/saas.ts`) | Architects | A5 |
| B6 | HTMX + realtime: live fragments over WebSockets | tutorial | `docs/htmx/realtime.md` + core WS | Full-stack devs | A6, A7 |
| B7 | WebSockets at bounded memory: heartbeats, caps, presence | blog | `StreetWebSocketServer` (`maxConnections`, heartbeat), `ChannelHub` | Senior backend devs | A7 |
| B8 | Tokenized invitations & API keys hashed at rest | blog | `InvitationService`, `ApiKeyService` (`create.ts`) | SaaS/security devs | A4, B5 |
| B9 | From Express to StreetJS: a migration walkthrough | comparison + video | `docs/migration-from-express.md` | Express maintainers (migration intent) | A1, A4 |

### Horizon C — 6–12 months (authority, comparisons, program scale)

Establish category authority and scale repeatable formats. Comparisons and the
larger backlog (`docs/_marketing/content-backlog.md`) feed this horizon.

| # | Title | Format | Verified strength (evidence) | Audience | Dependencies |
|---|---|---|---|---|---|
| C1 | StreetJS vs Express / NestJS / Fastify | comparison series (3) | Migration guides exist (`docs/migration-from-{express,nestjs,fastify}.md`) | Teams choosing a framework | B9; honest, measured-only |
| C2 | Implementing the Postgres v3 wire protocol (talk + writeup) | conference talk + blog | Native PG driver | Conference / advanced devs | A2, B1, B2 |
| C3 | Build a multi-tenant SaaS: full series (auth → RBAC → billing → dashboard) | tutorial series | SaaS + MarzPay/Stripe + HTMX dashboard (`create.ts`) | SaaS founders | A4, A5, A6, B3–B5 |
| C4 | The signed plugin model: Ed25519 + provenance + SBOM | blog | `docs/plugin-registry.md`, `docs/trust.md` (verify before publish) | Security/enterprise evaluators | B-series |
| C5 | Reference-app showcase ("built with StreetJS") | case-study (template-based) | `docs/case-studies/template-*.md`, `docs/showcase.md` | Evaluators wanting proof | **GAP-gated** — see §5 |
| C6 | Benchmarking methodology: honest framework comparisons | blog | MEASURED harness (budget guide) | Skeptical senior devs | RISK: MEASURED-only |
| C7 | Video library buildout (create→deploy, auth, realtime, SaaS, drivers) | video series | Backs verified topics A–B | YouTube / TOFU | Horizon A/B shipped |
| C8 | Backlog activation: prioritized cuts from the 100-topic backlog | mixed | `docs/_marketing/content-backlog.md` (verified-feature subset only) | Broad | Ongoing |

---

## 3. Program scorecard — ROI, Adoption Impact, Maintenance Cost

ROI = differentiation × searchability × conversion vs. effort. Adoption Impact =
how directly it moves a developer toward `street create`. Maintenance Cost = how
often the piece must be updated to stay accurate.

| Piece(s) | ROI rank | Adoption impact | Maintenance cost | Why |
|---|---|---|---|---|
| A1 Dependency-light (3 deps) | ★★★★★ (1) | High | Low | Most differentiated/defensible; already published; evergreen |
| A2 Native PG driver | ★★★★★ (2) | High | Low | Unique technical angle, high search intent; stable |
| A4 SaaS in one command | ★★★★★ (3) | Very High | Medium | Direct path to `--starter saas`; tracks CLI changes |
| A3 Self-hosting cost | ★★★★☆ (4) | High | Medium | Strong founder hook; **RISK**: re-verify MEASURED numbers each release |
| A7 Realtime chat | ★★★★☆ (5) | High | Medium | Demo-friendly; tracks WS API |
| A5 Multi-tenant isolation | ★★★★☆ (6) | High | Low | Architect credibility; logic is stable |
| A6 HTMX + TypeScript | ★★★★☆ (7) | Medium-High | Medium | Rising-interest niche; tracks htmx plugin |
| B3/B4 MarzPay | ★★★★☆ (8) | Medium-High | Medium | Differentiated for mobile-money/African market; tracks plugin + API |
| B1/B2 Native drivers + SCRAM | ★★★★☆ (9) | Medium | Low | Reinforces the dependency-light thesis at depth |
| B9/C1 Migrations & comparisons | ★★★☆☆ (10) | High | High | High intent but must stay fair + current vs moving competitors |
| C2 Wire-protocol talk | ★★★☆☆ (11) | Medium | Low | Authority/awareness; long shelf life |
| C5 Reference-app case study | ★★☆☆☆ (12) | High *if real* | High | **GAP-gated**; only with real, consented adopters |
| C6 Benchmark methodology | ★★★☆☆ (13) | Medium | High | High trust value; **RISK**: must stay reproducible |
| A8/social + C7 video | ★★★★☆ | High (distribution) | Medium | Amplifies everything; atomized from deep pieces |

---

## 4. Implementation order

1. **Amplify the three live blog posts** (A1, A2, A3) with the ready social copy
   in `CONTENT-DRAFTS.md`. Zero writing cost, immediate distribution.
2. **A4 SaaS tutorial** + **A8 launch pack** — the highest-adoption-impact path
   (`--starter saas`), supported by A1/A2 authority.
3. **A5, A6, A7** — multi-tenancy, HTMX, realtime tutorials (verified, no new
   product work).
4. **B1–B2** native-driver depth, then **B3–B4 MarzPay**, **B5/B8** SaaS RBAC /
   invitations / API keys, **B6–B7** realtime depth, **B9** Express migration.
5. **C1 comparisons**, **C2 wire-protocol talk**, **C3 SaaS series**, **C4 plugin
   trust**, **C6 benchmark methodology**, **C7 video library**, **C8 backlog**.
6. **C5 reference-app case studies** — only after a real, consented adopter
   exists (see §5). Until then, use template-based showcase framing, clearly
   labeled as templates, never as customer stories.

---

## 5. Gaps, risks, and guardrails

- **GAP — Named customer case studies.** `docs/case-studies/` holds only
  *templates* (`template-benchmark.md`, `template-deployment.md`,
  `template-migration.md`, `README.md`). There are no verified adopters in-repo.
  **Do not publish customer case studies or "trusted by" claims** until a real,
  consented user exists. C5 stays GAP-gated; in the interim use reference-app /
  starter showcases explicitly labeled as templates.
- **RISK — Performance numbers.** `~5,700 req/s` and `~30 KB/WebSocket` are the
  only MEASURED figures (`docs/blog/self-hosting-cost.md`, budget guide). Publish
  only numbers reproducible from the repo's benchmark harness; never estimate or
  extrapolate. Re-verify each release before reusing in new content.
- **RISK — CLI/API drift.** Tutorials A4–A7, B3–B6 reference concrete CLI flags
  (`--starter`, `--frontend`, `--with-marzpay`, `--with-billing`) and APIs.
  Add a content review step on `packages/cli/src/commands/create.ts` changes.
- **RECOMMENDATION — Canonical-link discipline.** Every external cross-post sets
  its canonical URL to the docs page so SEO authority accrues to the docs (as
  already practiced in `CONTENT-DRAFTS.md`).
- **RECOMMENDATION — Honest-tradeoff framing.** Keep the "we maintain protocol
  code others delegate" framing from the live posts; it is a credibility asset,
  not a liability.
- **No core framework changes.** This is a content-planning document only.
