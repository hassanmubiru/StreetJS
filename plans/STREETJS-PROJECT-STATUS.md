# StreetJS — Project Status & Direction

**Single consolidated report.** Supersedes and replaces the separate
`PROJECT-TRANSITION-REPORT.md`, `PROJECT-STRATEGY-REVIEW.md`, and
`PROJECT-EXECUTION-REPORT.md` (folded in here). Forward-looking plans remain in
`PROJECT-EXECUTION-ROADMAP.md` and `STREETJS-2.0-PLAN.md`; the certification record
is `docs/audits/2026-07-11-streetjs-final-engineering-certification.md`.

**Date:** 2026-07-15 (UTC) · **Repo:** `hassanmubiru/StreetJS` @ `main` `6c3e5ac0`
(local == origin) · **npm:** `streetjs`/`@streetjs/core`/`@streetjs/cli` = **1.2.7**
(provenance); **45 new `@streetjs/*` packages published (1.0.0; `context` 1.1.0; `ai` 1.1.0; `media` 1.1.0; `commerce` 1.1.0; `config` 1.1.0; `security` 1.1.0) with SLSA provenance**
(8 foundation + 21 extracted core modules + `@streetjs/database` aggregate + `@streetjs/media` + `@streetjs/notifications` + `@streetjs/ai-router` + `@streetjs/client-offline` + `@streetjs/integrations` + the 8 vendor connectors `slack`/`github`/`discord`/`gitlab`/`jira`/`linear`/`notion`/`teams` + `@streetjs/flags` + `@streetjs/i18n`);
**core-monolith split underway** via
dependency inversion — core re-exports each extracted package as the single source of
truth, keeping framework-coupled layers (`xssMiddleware`, `UploadGuard`,
`telemetryMiddleware`) in core · **CI:** green (all workflows on `main` HEAD, incl.
Publish Backend Packages, street CI/CD + Docker Build, Runtime Certification, CodeQL, and
all security/policy gates; tag `v1.2.7`).

**Evidence discipline:** every ✅ is backed by a command/CI run this engagement.
Items needing external infra or owner decisions are marked ◑ with the reason —
never simulated, never overstated.

---

## 0. Published `@streetjs/*` Package Inventory (this engagement)

All at **1.0.0**, npm + SLSA provenance, zero/curated deps, strict-TS + ESM, DI token,
docs (README/ARCHITECTURE/CHANGELOG/LICENSE) + runnable example, ≥90% coverage
(integration-heavy packages carry documented, lower branch floors).

**Foundation packages (8) — new capabilities:**

| Package | Purpose | Tests |
|---|---|---|
| `@streetjs/config` | typed, schema-validated, immutable config (env/JSON/YAML/TOML/custom) | 34 |
| `@streetjs/logging` | structured level logging, child loggers, transports, secret redaction | 68 |
| `@streetjs/metrics` | Prometheus Counter/Gauge/Histogram + registry + exposition | 49 |
| `@streetjs/health` | liveness/readiness/startup registry, IETF `health+json` | 23 |
| `@streetjs/tracing` | spans + W3C `traceparent` propagation + samplers/exporters | 27 |
| `@streetjs/http-client` | typed fetch client: retries, timeouts, interceptors | 29 |
| `@streetjs/webhooks` | generic HMAC sign/verify/deliver library | 24 |
| `@streetjs/testing` | spies, fake clock, deferreds, waitFor, fetch mock | 21 |

**Extracted core modules (21) — dependency inversion, core re-exports each:**

| Package | Core subpath | Tests |
|---|---|---|
| `@streetjs/exceptions` (typed HTTP exception hierarchy, zero-dep) | `streetjs/exceptions` | 7 |
| `@streetjs/container` (DI/IoC + `@Injectable`) | (internal `core/container`) | 11 |
| `@streetjs/context` (HTTP request/response context; **1.1.0** adds `MiddlewareFn`) | (internal `core/context`) | 18 |
| `@streetjs/diagnostics` (structured error reporter, zero-dep) | (internal `diagnostics/reporter`) | 9 |
| `@streetjs/store` (KV/counter/rate-limit backing stores, zero-dep) | (internal `security/store`) | 12 |
| `@streetjs/ratelimit` (sliding-window limiter + scopes + Redis store) | `streetjs/ratelimit` | 20 |
| `@streetjs/router` (compiled-regex router + pipeline + validation) | `streetjs/router` | 21 |

**Aggregate meta-package (1):** `@streetjs/database` re-exports the full data layer
(`postgres` + `pool` + `schema-inspector` + `migrations` + `repository`) under one
import — no logic of its own; 6 tests, 100% coverage. Not consumed by core.

**StreetStudio readiness audit — P0 gaps closed:**
- `@streetjs/media` (**1.1.0**) — ffmpeg/ffprobe abstraction: probe, transcode, thumbnail,
  HLS manifest builders; injectable command runner (fully testable without ffmpeg).
  **1.1.0 (additive) adds WebVTT caption building (`buildWebVtt`/`formatVttTimestamp` from
  timed `TranscriptCue`s — maps onto `@streetjs/ai` transcribe segments) and waveform peak
  extraction (`buildWaveformArgs` PCM-decode argv + pure `computeWaveformPeaks` reducer →
  normalized `WaveformPeaks`), the two review-player gaps from the final architecture review.**
  34 tests, 100% line coverage. Not consumed by core.
- `@streetjs/ai` (1.1.0) — added speech-to-text: `TranscriptionProvider` contract,
  optional `AiProvider.transcribe`, deterministic `FakeAiProvider.transcribe`, and a
  real `OpenAiProvider.transcribe` (Whisper) via an injectable multipart fetch. 26 tests.

**StreetStudio readiness audit — P1 progress:**
- `csrfMiddleware` now exported from core's public index (was implemented but internal).
- `@streetjs/notifications` (1.0.0) — unified multi-channel dispatcher: pluggable
  `NotificationChannel`s, `{{var}}` template rendering, per-recipient channel/category
  preferences (mandatory categories), resilient per-delivery results. Zero-dep, 15 tests,
  100% line coverage. Not consumed by core.
- `@streetjs/ai-router` (1.0.0) — `ModelRegistry` + a routing `AiProvider` (chat/embed/
  transcribe) selecting by pinned model / `ordered` / `cheapest` with automatic fallback.
  Depends on `@streetjs/ai`. 13 tests, 100% line coverage. Not consumed by core.
- `@streetjs/client-offline` (1.0.0) — offline-first client primitives: `OfflineCache`
  (TTL + stale-on-error) and a durable, ordered `MutationQueue` outbox (retry/drop/
  re-entrancy guard) over a pluggable `OfflineStore`. Zero-dep, 14 tests. Not consumed by core.

**StreetStudio readiness audit — secrets:**
- `@streetjs/config` (**1.1.0**, additive) — dynamic secret resolution + rotation on top of the
  existing static config + secret masking. `SecretStore` resolves across ordered, pluggable
  `SecretProvider`s with caching, TTL (injectable clock), `rotate()` cache invalidation +
  `onRotate` listeners, and an `onAccess` audit hook. Built-in `envSecretProvider` /
  `memorySecretProvider` / `fileSecretProvider`, plus a bridge that flows resolved secrets into
  typed config. Zero-dep, not consumed by core (standalone foundation). 47 tests. Closes the
  review's `secrets` hardening item (extend-config, not a new package).

**StreetStudio readiness audit — localization:**
- `@streetjs/i18n` (1.0.0) — localization foundation: typed message catalogs with `{var}`
  interpolation and `Intl.PluralRules`-backed pluralization (CLDR category maps), locale
  negotiation (`Accept-Language` parsing + subtag fallback chains + `negotiateLocale`), and
  locale-bound number/date/list formatting via built-in `Intl`. `I18n` facade with graceful
  missing-key degradation (returns key + `onMissing` hook). Zero-dep leaf (built-in `Intl`
  only), edge/browser-safe, not consumed by core. 25 tests, 100% line coverage. Closes the
  review's `i18n` gap.

**StreetStudio readiness audit — feature gating:**
- `@streetjs/flags` (1.0.0) — feature-flag foundation: typed boolean/multivariate `FlagDefinition`
  with a kill switch, ordered attribute **targeting rules** (AND/array/catch-all), and deterministic
  **percentage rollouts** with sticky per-subject bucketing (pure FNV-1a; no `node:crypto`, edge/
  browser-safe). `FlagRegistry` evaluates synchronously; pluggable `FlagStore` (+ `InMemoryFlagStore`)
  hydrates definitions; `evaluateFlagDetailed` exposes the decision `reason`. Zero-dep leaf, not
  consumed by core. 15 tests, 100% line coverage. Closes the review's `flags` gap (plan-gating,
  staged rollouts for StreetStudio).

**StreetStudio readiness audit — billing (subscriptions & seats):**
- `@streetjs/commerce` (**1.1.0**, additive) — recurring subscriptions + seat management via a
  self-contained `SubscriptionService` with its own pluggable `SubscriptionStore` (in-memory
  default) so the existing `CommerceStore`/Postgres surface is untouched (backward compatible).
  Reuses the commerce `PaymentGateway` contract. Plans (`month`/`year`, seat allowance incl.
  unlimited, trials), `subscribe`/`renew` (charge + period advance; `past_due` on decline),
  `cancel` (end-of-period or immediate), `changePlan` (next-period; proration intentionally not
  approximated), and seat assign/release with `SeatLimitError`. Injectable clock + `FakeGateway`
  → fully deterministic offline. 37 tests (18 new subscription/seat cases). Closes the second
  review-flagged framework gap ("subscription/seat billing" for StreetStudio plans).

**StreetStudio readiness audit — integrations (vendor connectors):**
- `@streetjs/integrations` (1.0.0) — shared connector foundation: `HttpConnector` base
  (injectable fetch, bearer/header/none auth, query building, JSON parsing, normalized
  `IntegrationError`/`IntegrationRequestError`, idempotent retry/backoff) + webhook
  verification primitives (`verifyHmacSignature`/`hmacHex`/`timingSafeCompare`). 11 tests,
  99% lines / 100% funcs. Not consumed by core.
- `@streetjs/slack` (1.0.0) — first real vendor connector on the foundation: `SlackClient
  extends HttpConnector` (postMessage incl. ephemeral/thread/blocks, updateMessage,
  deleteMessage, addReaction, listConversations, generic `call()` unwrapping Slack's
  `{ok,error}` envelope) + `verifySlackRequest` (v0 signature + replay guard, injectable
  clock). Depends on `@streetjs/integrations`. 11 tests, 100% coverage. Not consumed by core.
- `@streetjs/github` (1.0.0) — `GitHubClient` (issues, comments, pull requests, releases,
  workflow/repository dispatch; GHE `baseUrl`) + `verifyGitHubWebhook` (HMAC-SHA256
  `X-Hub-Signature-256`). 11 tests, 100% lines.
- `@streetjs/discord` (1.0.0) — `DiscordClient` (channel messages/edits/deletes, reactions,
  incoming-webhook execution; bot-token auth) + `verifyDiscordInteraction` (Ed25519 via
  `node:crypto`, since Discord doesn't use HMAC). 8 tests, 100% lines.
- `@streetjs/gitlab` (1.0.0) — `GitLabClient` (projects, issues, notes, merge requests,
  pipeline triggers; `PRIVATE-TOKEN` or OAuth; projects by id or path) + `verifyGitLabWebhook`
  (constant-time `X-Gitlab-Token` compare). 8 tests, 100% lines.
- `@streetjs/jira` (1.0.0) — `JiraClient` (issues, comments, transitions, assignment, JQL;
  Basic email+token auth; plain-text→ADF conversion) + `verifyJiraWebhook` (HMAC-SHA256 for
  signed/hardened webhooks). 8 tests, 100% lines.
- `@streetjs/linear` (1.0.0) — `LinearClient` (GraphQL: viewer, issues, comments, generic
  `query`; unwraps GraphQL `errors`; API-key or OAuth) + `verifyLinearWebhook` (HMAC-SHA256
  `Linear-Signature`). 10 tests, 100% lines.
- `@streetjs/notion` (1.0.0) — `NotionClient` (pages, databases, blocks, search; required
  `Notion-Version` header) + `verifyNotionWebhook` (HMAC-SHA256 `X-Notion-Signature`). 7
  tests, 100% lines.
- `@streetjs/teams` (1.0.0) — Microsoft Teams via three real paths: `TeamsClient` (Graph
  channel/chat messages), `sendIncomingWebhook` (connector-card POST), and
  `verifyTeamsOutgoingWebhook` (base64 `Authorization: HMAC` verification). 10 tests, 100%
  lines. This completes all 8 audit-flagged vendor connectors on the shared foundation.

| `@streetjs/cache` | `streetjs/cache` | 13 |
| `@streetjs/session` | `streetjs/session` | 10 |
| `@streetjs/security` (JWT) | `streetjs/security` | 15 |
| `@streetjs/websocket` (WS+SSE+channels) | `streetjs/websocket`, `streetjs/sse` | 51 |
| `@streetjs/xss` (sanitizers) | `streetjs/xss` | 12 |
| `@streetjs/multipart` (streaming parser) | `streetjs/multipart` | 12 |
| `@streetjs/webhook-dispatcher` (SSRF-hardened sender) | `streetjs/webhook` | 8 |
| `@streetjs/telemetry` (metrics tracker) | `streetjs/telemetry` | 8 |
| `@streetjs/cluster` (worker coordinator) | `streetjs/cluster` | 10 |
| `@streetjs/postgres` (wire driver + HA) | `streetjs/database`, `streetjs/pg-ha` | 100 |
| `@streetjs/pool` (bounded PG connection pool) | `streetjs/pool` | 21 |
| `@streetjs/schema-inspector` (PG/MySQL/SQLite introspection) | (internal `database/schema-inspector`) | 14 |
| `@streetjs/migrations` (SQL runner + schema differ) | `streetjs/migrations` | 16 |
| `@streetjs/repository` (generic CRUD + ledger) | `streetjs/repository` | 19 |

**Split mechanics (reusable, proven across all 21 extractions):** core's `prebuild`/
`prebuild:app` hooks compile first-party deps before core (so every `npm run build -w
packages/core` keeps working untouched); the distroless `infra/docker/Dockerfile` builds
those deps and dereferences the workspace symlinks so the runtime image is
self-contained. Each extraction verified end-to-end: core build + build:app, Docker build
+ runtime packaging, runtime subpath resolution, full CI, then published.

---

## 1. Executive Summary

The engineering roadmap is **substantially complete and released**. StreetJS is a
54-package TypeScript monorepo with a **minimal, curated dependency footprint**, a
signed/provenance-carrying supply chain, HA data clients (Redis Cluster +
PostgreSQL failover, live-verified), a consolidated resilience layer, self-guarding
CI, and task/architecture documentation. The **1.2.0** feature release shipped all of
this to npm.

The project has since run a sustained **"become a consumer" (dogfooding) phase** —
using the published CLI exactly as a new user would, building real apps, and fixing
every hitch at the source rather than working around it. This produced **seven
evidence-driven patch releases (1.2.1 → 1.2.7)**, each fixing a real bug found by
running the framework:

| Release | Fix (found by dogfooding) |
|---|---|
| **1.2.1** | CLI now loads the project `.env`; `migrate:run` gives actionable SQLite-vs-Postgres guidance. |
| **1.2.2** | `realtime-chat` scaffold actually serves WebSockets — core exposes `app.server` (`StreetHttpApp`), scaffold attaches the WS server, gateway speaks the correct StreetSocket envelope (was HTTP 404 on every upgrade). |
| **1.2.3** | `ctx.rawBody` preserved so the shipped webhook verifiers (`verifyStripeWebhook` et al.) actually work for JSON; `street add redis`/`stripe` added. |
| **1.2.4** | Scaffolded apps build in Docker (`@streetjs/cli` added as scaffold devDependency; was `sh: street: not found`); scaffold README gains Docker deploy guidance. |
| **1.2.5** | K8s deploy fixed: scaffold serves `/health/live`+`/health/ready` (matching generated manifests); manifest env no longer silently dropped (indentation) + secrets wired via `envFrom`; `z` re-exported from `streetjs`. |
| **1.2.6** | Postgres wire driver serializes `Date` params as ISO-8601 UTC — previously **any `Date` query parameter failed on a non-UTC host** (a core data-layer correctness bug that only "worked" in UTC). |
| **1.2.7** | Scaffolds expose Prometheus `/metrics` out of the box; root-caused and fixed the intermittent release-abort (a scope-review test racing the version bump, not a Node flake). |

Beyond releases, this phase also produced **honest, reproducible benchmarks**
(`scripts/bench-http.mjs` + `scripts/bench-pillars.mjs` with published numbers and
hardware), **task-oriented guides** (background jobs, observability), a **runtime
benchmark doc**, and a complete **Discord community design** — with the invite added
to the README. Several surfaces (API gateway, CMS, multi-tenancy, cron, observability)
were dogfooded and found **clean** — evidence the core is solid, not just that bugs
were fixed.

The phase has now also begun **building the missing foundation packages**: the first,
**`@streetjs/config@1.0.0`**, is published to npm with SLSA provenance. It is a
generic, typed, schema-validated, immutable configuration system with pluggable
sources (env, JSON, YAML, TOML, custom providers), namespaces, deep-merge precedence,
secret masking, and descriptive aggregated startup errors — **zero runtime
dependencies** (Node core only), designed to be the config foundation every other
StreetJS package (runtime-http, auth, database, cache, jobs, metrics, …) and any
application can build on. 10 acyclic modules, strict-TS + lint clean, 34/34 tests
green, published via the provenance-carrying `publish-backend.yml` workflow.

The dominant risk is no longer technical — it is **organizational** (bus factor = 1,
no active funding) and **adoption** (no evidence of real-world users yet). The
highest-return work now is consumer validation, friction removal, honest benchmarks,
docs, and contributors — **not** more core code.

**Verdict:** Engineering — **MATURE**. Overall project — **STABLE, adoption-gated.**

---

## 2. Repository State (verified)

| Item | State |
|------|-------|
| Branch / sync | `main`, clean, local == `origin/main` `2a71c2ea` |
| Release line | `streetjs`/`@streetjs/core`/`@streetjs/cli` **1.2.7**, npm + SLSA provenance |
| New packages | **`@streetjs/config@1.0.0`** on npm — `dist-tags.latest = 1.0.0`, SLSA provenance v1 attestation present (verified via `npm view … dist.attestations`). **`@streetjs/logging@1.0.0`** — built + verified locally (build/lint clean, 68 tests, 98.5% coverage), added to the `publish-backend.yml` set; publishes with provenance on the next dispatch |
| Signed release | GitHub Release `v1.2.7` — 3 tarballs + 3 cosign bundles + SBOM; every `v1.2.x` release signed |
| Security | 0 open secret-scan / Dependabot / code-scan alerts; `npm audit` 0 |
| CI | 44 workflows; latest run per workflow on `main` HEAD (incl. **Publish Backend Packages** = success) and tag `v1.2.7` = success |
| Packaging | subpath-import gate: **136/136** published subpaths import from npm |
| Leftover artifacts | none tracked (dogfood scratch in gitignored `.tmp/`; removed after each run) |

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
- **Consumer-facing surfaces (validated by dogfooding, this phase):** HTTP + raw-body
  webhooks (`ctx.rawBody`), WebSockets (`app.server` + StreetSocket), background jobs
  (`JobQueue` — enqueue/retry/DLQ on live PG), cron (`CronScheduler`), zod validation
  (`z`/`validate`/`validated`), multi-tenancy (`TenantPoolRegistry` — single-DB and
  DB-per-tenant), and observability (Prometheus `/metrics`, `/health/live`+`/ready`,
  OpenTelemetry tracing with W3C propagation). All exercised against running apps.
- **Docs:** `ARCHITECTURE.md`, `docs/ha-clients.md`, `docs/plugin-authoring.md`,
  `examples/plugin-starter/` (builds + tests 2/2); **new task-oriented guides**
  (`docs/background-jobs.md`, `docs/observability.md`); **reproducible benchmarks**
  (`docs/benchmarks/footprint.md` + `docs/benchmarks/runtime.md` with committed
  `scripts/bench-http.mjs` / `scripts/bench-pillars.mjs`); **community** design
  (`docs/community/discord.md`, invite in README).
- **Release:** CI-driven, provenance + cosign; cadence 1.1.2 → 1.2.0 → **1.2.7**
  (seven dogfood-driven patches). Release process hardened (see TD-6).

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
| **F-DF1** | **CLI ignored project `.env`** — scaffolds ship `.env.example` but the CLI never loaded `.env`, so documented setup silently failed | High (DX) | **FIXED** (dogfood `saas`) — shipped **1.2.1** (`packages/cli/src/env.ts`; loaded for every command except `create`; real env wins) |
| **F-DF2** | `migrate:run` gave a terse error on SQLite projects | Low (DX) | **FIXED** — actionable dialect-mismatch guidance; shipped **1.2.1** (PG path dogfood-verified end-to-end) |
| **F-DF3** | **Scaffolded `realtime-chat` returned HTTP 404 on WS upgrade** — `StreetWebSocketServer` created/registered but never attached; no public API to reach the HTTP server | High (broken template) | **FIXED** (dogfood `realtime-chat`) — core exposes `app.server` (`StreetHttpApp`); scaffold wires `wsServer.attach(app.server, chatConnectionHandler)`; shipped **1.2.2** (verified live WS client) |
| **F-DF4** | Example chat gateway used raw-`ws` idioms, not the StreetSocket `{type,payload}` envelope | Med (broken example) | **FIXED** — rewritten to `socket.on('join'/'message')` + `socket.onClose()` + `chat` broadcasts; shipped **1.2.2** |
| **F-DF5** | **Documented webhook verifiers unusable for JSON** — the HTTP server discarded the raw body, so `verifyStripeWebhook`/`verifySendGridWebhook`/`verifyIncomingWebhook` had no exact bytes to verify | High (broken capability) | **FIXED** (dogfood webhook processor) — `parseBody` preserves `ctx.rawBody` (additive); verified E2E (valid→processed, replay→idempotent, tampered/bad-sig→400); shipped **1.2.3**. |
| **F-DF6** | `street add redis` / `street add stripe` returned "unknown feature" though both ship in the framework | Low (DX) | **FIXED** — added both to the capability map with accurate wiring snippets; shipped **1.2.3**. |
| **F-DF7** | **Every scaffolded app failed `docker build`** — scaffold scripts call the `street` bin but `@streetjs/cli` was not a project dependency (`sh: street: not found`); only worked where the CLI was installed globally | High (deploy blocker) | **FIXED** (dogfood Docker deploy) — `@streetjs/cli` added as scaffold devDependency + `release.sh` lockstep; verified `docker build` + container boot + `/health`; shipped **1.2.4**. |
| **F-DF8** | `docker run` crashed with `JWT_SECRET must be set in production` and no deployment guidance anywhere | Low (docs) | **FIXED** — scaffold README gained a "Deploy with Docker" section (dev compose path + prod run with required secrets); shipped **1.2.4**. |
| **F-DF9** | **Scaffold + deploy manifests disagreed on health probes** — `street deploy:init` probes `/health/live` + `/health/ready`, but the scaffold served only `/health`, so generated K8s/Cloud Run deployments never passed probes | High (deploy blocker) | **FIXED** (dogfood K8s deploy) — scaffold registers `registerHealthRoutes`; verified both probes return 200; shipped **1.2.5**. |
| **F-DF10** | **K8s manifest dropped env vars + missing secrets** — `env:` was misindented under `resources:` (silently ignored by K8s) and no secret wiring, so pods lost `NODE_ENV` and crashed on the missing `JWT_SECRET` | High (deploy blocker) | **FIXED** — corrected env indentation (regression-tested via YAML parse) + `envFrom` secretRef + `kubectl create secret` header; shipped **1.2.5**. |
| **F-DF11** | **`z` (zod) not re-exported** — the `validate`/`validated` helpers need zod schemas, but consumers had to add their own `zod` dep and risk version skew vs. the framework's internal zod | Med (DX) | **FIXED** (dogfood CMS) — `export { z } from 'zod'`; verified a CMS validates bodies via `import { z, validate } from 'streetjs'`; shipped **1.2.5**. |
| **F-DF12** | **`Date` query params broke on non-UTC hosts** — the Pg wire driver bound a `Date` via `String(date)` → `"… GMT+0300 (…)"`, which Postgres rejects for `timestamptz`; broke `JobQueue.enqueue` and any `Date`-param query off-UTC | High (data-layer) | **FIXED** (dogfood job worker) — bind `Date` as `toISOString()`; verified E2E (enqueue→process→retry→DLQ on live PG) + wire regression test; shipped **1.2.6**. |
| **F-DF13** | **Intermittent release abort** — `scripts/release.sh` aborted on a "flaky" CLI test; root cause was `marzpay-scope-review` asserting no `packages/core/` changes while `release.sh` itself bumps `packages/core/package.json` (a race vs. the auto-commit, not a Node flake) | Med (release) | **FIXED** — test now allows a version-only bump to core `package.json` while still flagging real core edits; shipped **1.2.7** (see TD-6). |
| **F-DF14** | `TenantPoolRegistry.getPool` JSDoc said it returns null when a tenant "has no connection_string" — it actually shares the master pool | Low (docs) | **FIXED** — corrected the comment to describe both single-DB and DB-per-tenant models; on `main` (comment-only; rides next functional release). |

No reproducible engineering defect remains. Findings prefixed **F-DF** were surfaced
by the dogfooding phase and fixed at the source (not worked around), per the
"become a product" directive. **F-DF1–F-DF13 are all shipped (1.2.1 → 1.2.7);**
F-DF14 is a comment-only fix on `main`. The API-gateway, CMS, multi-tenancy, cron,
and observability dogfoods were **clean validations** (no functional bug): Prometheus
metrics, OpenTelemetry tracing (W3C traceparent propagation + OTLP export), the
health-check registry, `JobQueue` (retry/DLQ), `CronScheduler`, and per-tenant pool
routing all behaved correctly against running apps — evidence the core is solid, not
merely patched. Scaffolds now wire both health probes **and** `/metrics` out of the
box, so a generated app is observable and deployable with no extra setup.

**Onboarding measurement (Phase 3 DX, local path, this engagement):** cold
`create → install → add auth → add redis → build → boot` ≈ **6.3s active CLI time**
(scaffold 2.85s · warm-cache install 1.26s · add auth 0.17s · add redis 0.22s ·
build 1.54s · cold boot to healthy `/health` 0.30s), zero friction on the happy
path (Node 20 local; engines declare ≥22). The **deployment** path has since been
dogfooded too: `docker build` + container boot verified end-to-end (F-DF7/F-DF8),
and `street deploy:init --platform kubernetes` now produces a deployable manifest
with working probes + wired secrets (F-DF9/F-DF10).

**Published benchmarks (reproducible, this engagement):** `scripts/bench-http.mjs`
on an i7-1255U / Node 20 reports ~1 ms cold start and a ~25–28k req/sec hello-world
*floor* (in-process probe, honestly labeled — not a tuned peak); `scripts/bench-pillars.mjs`
reports in-memory hot-path ops/sec. Method, hardware, and scripts are published in
`docs/benchmarks/runtime.md` with no cherry-picking or framework comparisons.

---

## 5. Technical Debt

| ID | Item | Status |
|----|------|--------|
| TD-1 | Duplicated resilience primitives | ✅ Done — canonical `streetjs/resilience` (RFC 0004) |
| TD-2 | HTTP plugins lacked local test scripts | ✅ Done — offline contract tests |
| TD-3 | `release-inputs.json` not CI-generated | ✅ Done — derived live |
| TD-4 | Hardcoded backoff ladders | ✅ Done — `computeBackoff` |
| TD-5 | `@streetjs/core` compat shim | Deferred to 2.0 (telemetry-gated) |
| TD-6 | Release aborts that forced manual tag recovery | ✅ Done (root-caused) — initially treated as a Node-20 flake and mitigated two ways: (a) `create-boot.integration` binds an OS-assigned free port (`getFreePort`); (b) `release.sh` retries the CLI suite once. That retry then surfaced the **true** cause: `marzpay-scope-review` asserts no `packages/core/` changes, which conflicts with the version bump `release.sh` writes to `packages/core/package.json` (a race vs. auto-commit). Fixed the test to allow a version-only bump (F-DF13, shipped 1.2.7). Correctness stays gated by GitHub CI (Node 22/24). |

No material new debt. The one regression introduced during the engineering phase
(F-6) was caught by CI and fixed same-engagement. Honest note: the release-abort was
misattributed to a Node-20 flake for two releases before the retry gate proved it
was a deterministic test/process conflict — now understood and fixed.

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

**Delivered — "become a consumer" (dogfooding) phase (1.2.1 → 1.2.7):** dogfooded
the `saas`, `realtime-chat`, and `app` templates plus purpose-built webhook,
API-gateway, CMS, background-worker, and multi-tenant apps; fixed every friction at
the source (F-DF1–F-DF14); measured onboarding and deployment; published reproducible
benchmarks and task-oriented guides; hardened the release process; and produced the
community (Discord) design. This is the highest-return work and can continue with more
example apps and guides (auth, Redis cache, PG-HA walkthroughs).

**Release-process notes (learned):** (1) promote the CHANGELOG `[Unreleased]` heading
to the target version *before* running `scripts/release.sh` (the tag-scoped
enforcement gate checks the changelog at the tagged commit); (2) the CLI suite is
retried once and the scope-review/version-bump conflict is fixed, so releases no
longer need manual recovery.

**In progress — "build the missing framework packages" track.** A production prompt
requested ~60 standalone `@streetjs/*` packages so a consumer app can drop compatibility
adapters and depend only on published packages. Ground-truth mapping first: a large
share already ships (`config`, `events`, `queue`, `realtime`, `storage`, `search`, `ai`)
or exists as working code inside `streetjs` core exposed via subpaths (`/http`,
`/database`, `/repository`, `/migrations`, `/security`, `/session`, `/websocket`,
`/webhook`, jobs, observability, tenancy, …). Re-creating those would duplicate logic or
be shims (both forbidden), so the real work is **building the genuinely-missing,
low-dependency foundation packages bottom-up, one at a time, each fully verified** —
exactly how `config` was done. Delivered so far:

- **`@streetjs/config@1.0.0`** — built and **published** (npm + SLSA provenance): typed,
  schema-validated, immutable configuration; pluggable sources (env/JSON/YAML/TOML/
  custom); namespaces, deep-merge precedence, secret masking, descriptive startup
  errors; zero runtime deps, 10 acyclic modules, 34/34 tests. First in the
  `publish-backend.yml` `PKGS` set (leaf/base ordering).
All built as zero-runtime-dependency, interface-first, strict-TS, ESM packages with
acyclic module graphs, a DI token, docs (README + ARCHITECTURE + CHANGELOG + LICENSE), a
runnable example, and ≥90% enforced coverage. Each is wired into `publish-backend.yml`
(leaf-first) and publishes with provenance on the next dispatch (awaiting go-ahead).

- **`@streetjs/logging@1.0.0`** — structured level logging; child loggers + bound context;
  pluggable transports (console JSON/pretty, stream, memory, multi); automatic secret
  redaction before any sink; safe error/circular serialization; timers; `LOGGER` token.
  68 tests, 98.5% line / 95.7% branch.
- **`@streetjs/metrics@1.0.0`** — Prometheus-compatible `Counter`/`Gauge`/`Histogram`;
  strict-validated labels + deterministic series keys; `MetricsRegistry` rendering the text
  exposition format; optional pull-based default process metrics; `METRICS_REGISTRY` token.
  49 tests, 99.7% / 98.6%.
- **`@streetjs/health@1.0.0`** — framework-agnostic health-check registry;
  liveness/readiness/startup; per-check timeouts + criticality; status aggregation (non-
  critical failures degrade to `warn`); IETF `health+json` reporting; `HEALTH_REGISTRY`
  token. 23 tests, 100% / 98.4%.
- **`@streetjs/tracing@1.0.0`** — lightweight distributed tracing; spans with attributes/
  events/status; W3C `traceparent` propagation; async-context active spans; samplers;
  pluggable exporters; `TRACER` token. 27 tests, 100% / 94.6%.
- **`@streetjs/http-client@1.0.0`** — typed outbound client over `fetch`; base URLs, query
  building, JSON helpers, timeouts, idempotent-only retries with backoff + `Retry-After`,
  request/response interceptors, descriptive errors; injectable fetch/sleep; `HTTP_CLIENT`
  token. 29 tests, 97.9% / 95.8%.
- **`@streetjs/webhooks@1.0.0`** — generic HMAC-SHA256 signing + delivery with retries and
  constant-time verification with replay protection; injectable transport; `WEBHOOK_
  DISPATCHER` token. 24 tests, 100% / 93.8%.
- **`@streetjs/testing@1.0.0`** — test-runner-agnostic utilities: spies, a fake clock that
  plugs into every injectable-clock package, deferreds, `waitFor`/`delay`, and a scripted
  `fetch` mock. 21 tests, 100% / 98.8%.

Next candidates (missing, low in the graph): `validation`/`environment` (config-adjacent),
then higher layers. Much of the requested list already ships as `streetjs` core subpaths
(`/http`, `/database`, `/repository`, `/migrations`, `/security`, `/session`, `/websocket`,
`/webhook`, jobs) or existing packages (`events`, `queue`, `realtime`, `storage`, `search`,
`ai`); re-creating those would duplicate logic or be shims (forbidden), so the remaining
work there is a larger extraction decision rather than new foundation code.

**Owner/community track (partly started):** the **Discord community** is now
designed and linked from the README (`docs/community/discord.md`, invite live);
recruit maintainer #2; enable funding; community plugin index + submission flow;
more tutorials/examples/case studies.

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
| Releases | High | npm + provenance + cosign verified through **1.2.7**; process hardened (TD-6) |
| HA | High | live-verified Redis Cluster + PG failover |
| Consumer surfaces | High | jobs/cron/webhooks/WS/validation/tenancy/observability dogfooded on running apps |
| Documentation | High | architecture + task guides (jobs, observability) + reproducible benchmarks; more examples still valuable |
| CI/CD | High | 44 workflows green |
| Operations | None (external) | credentials / org / maintainers unavailable |
| Adoption | Unknown | no usage evidence yet — the key gap |

---

## 9. Recommended Direction (next 6 months)

1. ✅ **Become a consumer** — done and ongoing: 8+ real apps/surfaces dogfooded; 14 findings fixed across 1.2.1→1.2.7.
2. ◑ **Kill friction** — install/onboarding measured (~6s local) and deployment validated (Docker + K8s); keep watching for the next rough edge.
3. ◑ **Task docs & examples** — started (background jobs, observability, runtime benchmark, Discord); next: auth, Redis cache, PG-HA, K8s walkthroughs.
4. ✅ **Honest benchmarks** — `scripts/bench-http.mjs` + `bench-pillars.mjs` with published numbers/hardware/method in `docs/benchmarks/runtime.md` (no screenshots, no cherry-picking).
5. ◑ **Grow contributors** — community server designed + linked; good-first-issues and the contributor path documented. Needs real people next.
6. **Stabilize 1.x** — additive, evidence-driven only; defer 2.0 until adoption data justifies breaking changes. (1.2.1→1.2.7 were all additive/fixes.)
7. **Enable funding + recruit maintainer #2** — still the top organizational unlocks.

**Do not:** add heavy/uncurated core deps · chase parity · rush 2.0 · write more
certification audits · add speculative breadth.

---

## 10. Final Status

**Engineering: complete, released, and consumer-validated (MATURE).** Through 1.2.7,
the framework has been driven the way a real user would: every core surface (HTTP,
webhooks, WebSockets, jobs, cron, validation, multi-tenancy, observability, Docker/K8s
deployment) was dogfooded against running software, and every friction or bug was
fixed at the source — 14 findings, seven signed releases, all CI-green. Reproducible
benchmarks, task-oriented guides, and the community (Discord) design are now in place.

The remaining risk is **organizational and adoption-driven**, not technical: bus
factor = 1, no active funding, and no confirmed production users yet. The most
valuable feedback now will come from **real users**, not further internal
engineering. Treat the roadmap as mostly finished; keep investing in consumers, docs,
examples, and community — and stabilize 1.x with additive, evidence-driven changes
only.

---

## 11. This-Engagement Work Log (dogfooding phase)

| Area | Outcome |
|---|---|
| Releases | **1.2.1 → 1.2.7** (7 signed, provenance-carrying patches), each fixing a dogfood-found bug |
| Findings | **F-DF1–F-DF14** — all fixed; F-DF1–F-DF13 shipped, F-DF14 comment-only on `main` |
| Clean validations | API gateway, CMS, multi-tenancy, cron, observability (metrics/tracing/health) — no bug found |
| Scaffold DX | `.env` loading, WS serving, Docker build, health probes + `/metrics` out of the box, `add redis`/`stripe` |
| Data layer | `ctx.rawBody` for webhook verification; `Date` params fixed for non-UTC hosts |
| Release process | free-port test fix + retry gate + scope-review/version-bump fix (TD-6) |
| Docs | `docs/background-jobs.md`, `docs/observability.md`, `docs/benchmarks/runtime.md` |
| Benchmarks | `scripts/bench-http.mjs`, `scripts/bench-pillars.mjs` — published numbers + hardware + method |
| Community | `docs/community/discord.md` (full server design) + Discord invite added to README |
| New packages | **`@streetjs/config@1.0.0`** — **published** to npm with SLSA provenance (34 tests). Plus **7 foundation packages built + verified** at 1.0.0, wired into `publish-backend.yml` (publish with provenance on next dispatch), 241 tests total, all ≥90% coverage: **logging** (68), **metrics** (49), **health** (23), **tracing** (27), **http-client** (29), **webhooks** (24), **testing** (21). All zero-runtime-dep, interface-first, acyclic, with DI tokens + docs + examples. |
| Verification | every claim above backed by a command/CI run; scratch kept in gitignored `.tmp/` and cleaned |
