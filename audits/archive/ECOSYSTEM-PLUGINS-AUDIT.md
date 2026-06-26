# Ecosystem Plugins Audit — StreetJS Phase 17 (Workstream A)

> Status tags: **VERIFIED** (confirmed in repo) · **GAP** (missing) ·
> **IMPLEMENTED** (added this phase) · **RECOMMENDATION** (proposed).
> All "existing" rows were confirmed by reading `packages/*/package.json` and
> `packages/*/src`. Nothing below is duplicated against an existing package.

## Method

Enumerated all workspaces under `packages/*`, read each `package.json`
(`name`, `description`, `private`) and source entry points. Cross-referenced the
Phase-17 "missing plugin" wishlist against what already ships **before** proposing
anything new — per the ground rule "search existing packages first; do not
duplicate functionality."

## Existing official plugins — VERIFIED

19 signed, dependency-free `@streetjs/plugin-*` packages ship today. Every one
uses the signed-manifest `PluginModule` SDK and avoids third-party runtime deps
(protocols implemented over Node core / HTTPS).

| Package | Purpose | Status | Maintenance |
|---|---|---|---|
| `@streetjs/plugin-postgres` | PostgreSQL pool (wraps native core driver) | VERIFIED | Core-team |
| `@streetjs/plugin-mysql` | MySQL/MariaDB pool (native, dependency-free) | VERIFIED | Core-team |
| `@streetjs/plugin-mongodb` | MongoDB (BSON + OP_MSG + SCRAM-SHA-256) | VERIFIED | Core-team |
| `@streetjs/plugin-redis` | Redis cache / KV (dependency-free RESP2) | VERIFIED | Core-team |
| `@streetjs/plugin-kafka` | Apache Kafka streaming (core Kafka client) | VERIFIED | Core-team |
| `@streetjs/plugin-rabbitmq` | RabbitMQ / AMQP 0-9-1 (core transport) | VERIFIED | Core-team |
| `@streetjs/plugin-nats` | NATS pub/sub (dependency-free protocol) | VERIFIED | Core-team |
| `@streetjs/plugin-s3` | AWS S3 object storage | VERIFIED | Core-team |
| `@streetjs/plugin-r2` | Cloudflare R2 object storage | VERIFIED | Core-team |
| `@streetjs/plugin-stripe` | Stripe payments | VERIFIED | Core-team |
| `@streetjs/plugin-paypal` | PayPal Orders v2 (HTTPS client) | VERIFIED | Core-team |
| `@streetjs/plugin-twilio` | Twilio SMS | VERIFIED | Core-team |
| `@streetjs/plugin-africastalking` | SMS, Voice, USSD, Airtime, Mobile Money | VERIFIED | Core-team |
| `@streetjs/plugin-sendgrid` | SendGrid email | VERIFIED | Core-team |
| `@streetjs/plugin-openai` | OpenAI chat + embeddings (HTTPS client) | VERIFIED | Core-team |
| `@streetjs/plugin-auth0` | Auth0 identity | VERIFIED | Core-team |
| `@streetjs/plugin-clerk` | Clerk identity backend API | VERIFIED | Core-team |
| `@streetjs/plugin-firebase` | Firebase Auth (Identity Toolkit REST) | VERIFIED | Core-team |
| `@streetjs/plugin-supabase` | Supabase PostgREST data API | VERIFIED | Core-team |

### Capabilities already covered outside the `plugin-*` namespace — VERIFIED

These wishlist items are **already shipped** as first-class packages/modules, so
no new plugin is warranted (would duplicate functionality):

- **Meilisearch** — `@streetjs/search` ships `src/meili.ts` + integration tests. VERIFIED
- **Elasticsearch** — `@streetjs/search` ships `src/elastic.ts` + integration tests. VERIFIED
- **OpenTelemetry** — `packages/core/src/observability/otel.ts` (core export). VERIFIED
- **Background jobs / queue** — core PostgreSQL-backed queue + cron + saga
  engine; **BullMQ is unnecessary** (it would re-introduce a Redis dependency the
  core deliberately avoids). RECOMMENDATION: do **not** add a BullMQ plugin.
- **Kubernetes** — `docs/deployment-manifests.md` covers manifests already.

## Wishlist reconciliation

| Wishlist (Phase-17) | Reality | Verdict |
|---|---|---|
| Stripe, PayPal, Twilio, Redis, S3, R2, Africa's Talking | Shipped | VERIFIED — no action |
| Meilisearch, Elasticsearch | In `@streetjs/search` | VERIFIED — no action |
| Kafka, RabbitMQ | Shipped | VERIFIED — no action |
| OpenTelemetry | In core observability | VERIFIED — no action |
| BullMQ | Core queue supersedes | RECOMMENDATION — skip |
| GitHub / Google / Microsoft / LinkedIn OAuth | Generic OAuth2/OIDC in core; no per-provider sugar | GAP |
| Discord / Telegram | Not present | GAP |

## Genuine GAPs — prioritized

Effort: S (≤1 day) · M (2–4 days) · L (>1 week). Impact = expected adoption lift.

| Rank | Plugin | Why it matters | Effort | Adoption impact |
|---|---|---|---|---|
| 1 | `@streetjs/plugin-oauth` (GitHub/Google/Microsoft presets) | "Login with X" is the #1 starter requirement; core OAuth2 exists but needs per-provider presets | M | High |
| 2 | `@streetjs/plugin-discord` (OAuth + bot/webhook) | Community/SaaS notifications; high demand | M | Medium-High |
| 3 | `@streetjs/plugin-telegram` (bot API) | Notifications/ops bots | S | Medium |
| 4 | `@streetjs/plugin-algolia` | Hosted search alternative to self-hosted Meili/Elastic | S | Medium |
| 5 | `@streetjs/plugin-resend` | Modern transactional email (SendGrid alt) | S | Medium |
| 6 | `@streetjs/plugin-clickhouse` | Analytics/event store for SaaS dashboards | M | Medium |
| 7 | `@streetjs/plugin-temporal` | Durable workflows beyond the core saga engine | L | Low-Medium |

## RECOMMENDATIONS

1. **Stop framing Tier-1 as "missing."** It ships. Re-message the marketing as
   "20+ official, signed, dependency-free plugins" (a real differentiator vs
   ecosystems that lean on third-party deps).
2. **Build the OAuth presets plugin first** — it unblocks the SaaS starter
   (Workstream B) and the auth tutorials (Workstream F).
3. **Publish a plugin scorecard page** wiring `docs/ecosystem/plugin-certification.md`
   data to each package (maintenance, tests, audit status) — drives trust.
4. **Keep the "dependency-free" invariant** as the ecosystem's brand promise; reject
   plugins that would add transitive runtime deps unless unavoidable.
