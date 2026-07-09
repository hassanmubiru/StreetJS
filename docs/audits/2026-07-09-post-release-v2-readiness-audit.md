---
layout: default
title: "StreetJS — Post-Release Excellence & v2 Readiness Audit"
nav_exclude: true
description: "Independent principal-engineer audit of StreetJS post-v1.1.1: architecture, performance, API design, security, testing, DX, docs, build system, and plugin ecosystem, with a prioritized roadmap toward v2."
sitemap:     false
noindex:     true
---

# StreetJS — Post-Release Excellence & v2 Readiness Audit

**Date:** 2026-07-09
**Repository:** `hassanmubiru/StreetJS`
**Baseline:** v1.1.1, shipped and verified per `docs/audits/2026-07-08-release-report-v1.1.1.md` and the consolidated `docs/audits/2026-07-09-full-engagement-report.md`. Every item marked VERIFIED there is treated as established history and not re-audited unless new evidence contradicted it.
**Method:** Evidence-only. Every claim below is backed by an executed command, direct source inspection with file:line citations, a measured benchmark, or an explicit `NOT VERIFIED`. Regressions were checked against prior fixes before any new finding was accepted. No result is inferred from green CI alone, and no skipped test is counted as passing.
**Role assumed:** Independent principal engineer + release architect evaluating v1.1.1's foundation for a long-lived v2, not preparing another release.

---

## Executive Summary

StreetJS v1.1.1 is a genuinely mature, dependency-free TypeScript framework: hand-written wire protocol clients for Postgres/MySQL/Redis, a real plugin signing and provenance pipeline, and a testing culture that — in its best packages — uses property-based tests with real formula-level assertions rather than smoke checks. The framework does **not** need a rewrite. It needs targeted hardening in a small number of places where the same debt pattern repeats across otherwise-excellent packages: hand-duplicated resilience primitives (five independent backoff formulas), a real and measured O(n²) performance bug in the two most commonly used database wire clients, a gap in TLS coverage for those same two clients, and a genuine SSRF finding in the gateway's forwarder. None of these are architectural failures — they are the kind of debt that accumulates when many packages are built to the same high standard independently, without a shared foundation layer to enforce consistency.

**Repository health:** Good, trending toward Excellent once the Immediate-tier items below are closed.

| Dimension | Score (1-10) | Basis |
|---|---|---|
| Technical debt | 6 | Concentrated, well-understood, self-documented in code comments — not sprawling or hidden |
| Maintainability | 7 | Strong within-package consistency; weak cross-package consistency (errors, backoff, timeouts) |
| Architecture | 7 | Clean package boundaries (verified, no cross-package deep imports); duplicated resilience primitives pull this down from 8-9 |
| Performance | 6 | Measured O(n²) buffer accumulation in the two most-used DB clients is a real, fixable regression risk under load; everything else measured was fast |
| Security | 6 | One measured-live SSRF finding (gateway), one real TLS coverage gap (Postgres/MySQL); everything previously fixed remains fixed, no regressions found |
| Developer experience | 7 | CLI first-run and `doctor`/`defineConfig` error quality are genuinely excellent; two doc/reality mismatches (Node version, DLQ hook) undercut first impressions |
| Release maturity | 8 | Real signing, provenance, SBOM, CI-verified plugin examples, honest-skip testing culture throughout |

**What changed since the last audit round:** two new, previously-unreported security findings (Postgres/MySQL TLS gap; gateway absolute-path SSRF), one previously-suspected performance issue now measured and confirmed with real numbers (O(n²) buffer accumulation), and one documentation defect serious enough to break a first-time user's build (`queue.onDeadLetter()` documented but does not exist).

---

## Findings

Each finding includes ID, severity, category, evidence, root cause, recommended fix, estimated effort, risk, and expected impact.

### F-P1 — O(n²) buffer accumulation in the PostgreSQL and MySQL wire clients (measured)
**Severity:** High **Category:** Performance
**Evidence:** `packages/core/src/database/wire.ts` `_connect()`'s socket `data` handler (`this.buffer = Buffer.concat([this.buffer, chunk])`) and the identical pattern in `packages/core/src/database/mysql/wire.ts` `_onData()`. A targeted repro benchmark (written and executed this session, then deleted after capturing results) measured the exact pattern — repeatedly `Buffer.concat`-ing an incoming 16KB TCP chunk onto a growing accumulator — against a single-concat-at-drain-time alternative:

| Total bytes | Chunks | Current pattern | Single-concat alternative | Ratio |
|---|---|---|---|---|
| 1,000,000 | 62 | 14.3 ms | 0.5 ms | 30.0x |
| 10,000,000 | 611 | 1,183.8 ms | 6.9 ms | 171.1x |
| 50,000,000 | 3,052 | 27,734.3 ms | 15.2 ms | 1,820.1x |

The ratio growing roughly 10x for every ~5-10x growth in chunk count is the textbook signature of O(n²) behavior (each `Buffer.concat` re-copies the entire accumulated buffer). A 100MB scenario timed out this session's 120-second execution budget under the current pattern — direct evidence of the blowup at realistic large-result-set sizes.
**Root cause:** Every incoming TCP `data` event triggers a full-buffer copy via `Buffer.concat([this.buffer, chunk])` instead of accumulating chunks in a list and concatenating once when a complete frame is available.
**Recommended fix:** Replace the accumulator with a chunk array (`chunks.push(chunk)`) and only `Buffer.concat(chunks)` when checking for/extracting a complete frame, or adopt a proper ring-buffer/growable-buffer strategy. This is a contained, mechanical change isolated to the socket `data` handlers in both files.
**Estimated effort:** Small (1-2 days incl. tests). **Risk:** Low — the fix is behavior-preserving (same framing logic, different accumulation strategy) and both files already have dedicated wire-protocol test suites to regression-check against.
**Expected impact:** High. Any query returning a large result set (bulk export, reporting, migration) currently pays quadratic cost proportional to the number of TCP chunks received. This directly affects the two most commonly deployed databases for the framework.

### F-S1 — Core PostgreSQL/MySQL wire clients have no TLS option at all
**Severity:** High **Category:** Security
**Evidence:** `packages/core/src/database/wire.ts` `PgConnectOptions` and `packages/core/src/database/mysql/wire.ts` `MysqlConnectOptions` both declare only `{ host, port, user, password, database, connectTimeoutMs }` — no `tls`/`ssl`/`rejectUnauthorized` field. Both connect via bare `node:net.createConnection()` with no `tls.connect()` upgrade path anywhere in either file. This propagates into `@streetjs/plugin-postgres` and `@streetjs/plugin-mysql`, whose config validators accept no TLS option either. Distinct from `plans/OUTSTANDING-ACTIONS.md` item #15 (TLS shipped for redis/mongodb/kafka/rabbitmq/nats only) and item #30 (clustering, not encryption) — Postgres and MySQL were never included in that hardening pass. `mysql/wire.ts` explicitly detects and refuses a cleartext-password request specifically because "this connection is not TLS-encrypted" — the code is self-aware of the gap at that one call site, but nothing prevents deployment over an untrusted network via `mysql_native_password` or any Postgres auth path.
**Root cause:** The TLS hardening pass (item #15) covered the five plugin-wrapped protocols but the two protocols implemented directly in core (Postgres, MySQL) were out of scope at the time.
**Recommended fix:** Add an opt-in `tls`/`rejectUnauthorized`/`ca` surface to both `PgConnectOptions` and `MysqlConnectOptions`, mirroring the pattern already shipped for the five plugins: wrap the socket in `tls.connect()` post-connect for Postgres's `SSLRequest` negotiation, or pre-connect for MySQL's SSL capability flag.
**Estimated effort:** Medium (3-5 days incl. tests for both protocols' TLS negotiation paths). **Risk:** Low-Medium — additive, default-off change; care needed around each protocol's specific TLS negotiation handshake (Postgres's `SSLRequest` byte sequence, MySQL's `CLIENT_SSL` capability flag timing).
**Expected impact:** High. Credentials and all query/row data currently travel in cleartext for the two most commonly deployed database backends.

### F-S2 — Gateway's `httpForwarder`/`proxyWebSocketUpgrade` are vulnerable to absolute-path SSRF (measured live)
**Severity:** Medium-High **Category:** Security
**Evidence:** `packages/gateway/src/proxy.ts`'s `httpForwarder` (`new URL(req.path, target.url)`) and `proxyWebSocketUpgrade` (`new URL(req.url ?? "/", target.url)`) both use the two-argument `URL(input, base)` constructor. Per WHATWG URL semantics, if `input` is itself an absolute URL, `base` is silently ignored. This was verified live this session: supplying `req.path = 'http://127.0.0.1:<other-port>/secret'` caused `httpForwarder` to fetch from the attacker-specified host rather than the configured `target.url`, and the identical bypass was reproduced end-to-end through `proxyWebSocketUpgrade`. Node's `http.IncomingMessage.url` can legitimately carry an absolute-form request-target (RFC 7230 §5.3.2), and no adapter or pipeline stage in `gateway.ts` (CORS → versioning → routing → auth → forward) rejects an absolute-form path before it reaches the forwarder.
**Root cause:** The two-argument `URL()` constructor's base-override semantics were not accounted for when accepting caller-supplied `path`/`url` values.
**Recommended fix:** Before constructing the URL, reject (or strip to path+query only) any `path`/`url` value that parses as absolute or protocol-relative: `if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(path) || path.startsWith('//')) throw new GatewayConfigError(...)`.
**Estimated effort:** Small (1 day incl. tests). **Risk:** Low — a narrow, additive validation check with a clear test case (the exact PoC used to verify this finding).
**Expected impact:** Medium-High for any deployment where the gateway's front-end HTTP server passes `req.url` through unmodified (the single most natural integration pattern) and the gateway is reachable from a less-trusted network segment.

### F-A1 — Five to six independently-maintained, hand-copied exponential-backoff implementations
**Severity:** Medium **Category:** Technical debt / maintainability
**Evidence:** The identical `min(base * multiplier^(attempt-1), cap)` formula is reimplemented separately in: `packages/core/src/jobs/queue.ts:521-526` (inline), `packages/core/src/testing/chaos.ts:109-117` (`retryWithBackoff`), `packages/core/src/webhook/manager.ts:163-169` (`static backoffMs`), `packages/queue/src/retry.ts:41-90` (`computeBackoffDelay`, explicitly commented as "mirrors" core's formula rather than importing it), `packages/workflow/src/backoff.ts:41-70` (`computeBackoff`, comment claims it "reuses the *verified* @streetjs/queue backoff formula exactly" but is actually a hand-copied reimplementation), and `packages/gateway/src/retry.ts:51-59` (`computeRetryDelay`, its own `RetryPolicy` shape). Each carries a slightly different policy interface (`BackoffPolicy` vs `Backoff` vs `RetryPolicy`).
**Root cause:** No shared resilience-primitives layer exists for packages to depend on; each package's author independently ported the formula rather than importing a common utility, and left comments acknowledging the duplication rather than resolving it.
**Recommended fix:** Extract a single canonical `computeBackoffDelay(policy, attempt, rng?)` into `streetjs` core (or a new minimal `@streetjs/resilience` package with zero other dependencies), and have queue/workflow/gateway/webhook-manager import it, keeping their own policy-shape adapters thin.
**Estimated effort:** Medium (1 week including migrating 5 call sites and their existing tests). **Risk:** Low — the formula is simple, already independently tested in 5 places, and consolidation is behavior-preserving by construction if done via extraction rather than reimplementation.
**Expected impact:** Medium. Not a current runtime risk (each copy works and is tested), but any future change to backoff semantics (e.g. full-jitter mode) requires 5+ synchronized edits with no compiler-enforced parity.

### F-A2 — Two duplicate CircuitBreaker implementations, one confirmed dead
**Severity:** Low-Medium **Category:** Design debt
**Evidence:** `packages/core/src/microservices/circuit-breaker.ts` (`CircuitBreaker` extends `EventEmitter`, execute()-wrapping style) is exported from `core/src/index.ts` but has zero usages outside its own test file across every audited package — confirmed dead by cross-package grep. `packages/gateway/src/circuit-breaker.ts` implements a second, live, functionally different CircuitBreaker (per-key, clock-injected, `canRequest`/`onSuccess`/`onFailure` style) actually wired into `gateway.ts` and covered by its own test suite. The core CQRS bus (`packages/core/src/microservices/cqrs.ts` — `CommandBus`/`QueryBus`) is similarly confirmed dead: exported from core's index but the only usage anywhere is its own test file.
**Root cause:** Core's microservices module was built speculatively without a consuming caller; gateway later built its own resilience primitives independently rather than extending core's.
**Recommended fix:** Either wire core's `CircuitBreaker`/`CommandBus`/`QueryBus` into a real consumer, or deprecate and remove them from the public export surface (they are unused, so removal carries minimal breaking-change risk to real consumers — grep confirms none exist in the audited packages).
**Estimated effort:** Small (removal) or Medium (if wiring into a real use case). **Risk:** Low for removal (unused code); flag any external/community usage via a deprecation cycle before removal in case third-party code imports them directly.
**Expected impact:** Low-Medium. Primarily a maintainability and "surface area to understand" cost, not a runtime risk.

### F-API1 — No typed error hierarchy in `packages/queue`, `packages/events`, `packages/realtime`, unlike storage/gateway/workflow
**Severity:** Medium-High **Category:** API design consistency
**Evidence:** `packages/storage`, `packages/gateway`, `packages/workflow` each export a full typed error hierarchy with `cause`-chaining (e.g. `StorageError`/`StorageConfigError`/`NotFoundError`, `GatewayError`/`CircuitOpenError`/`RateLimitExceededError`, `WorkflowError`/`PersistenceError`). By contrast, `packages/queue/src/index.ts` and `packages/events/src/index.ts` export zero custom error classes — confirmed via `export class \w*Error` search returning no matches — and throw plain `Error` for their own failure modes (e.g. `packages/queue/src/facade.ts:498`, `packages/events/src/facade.ts:288`). `packages/realtime` throws a mix of plain `Error` and `TypeError` with no typed `RealtimeError` class at all, so callers cannot `instanceof`-discriminate realtime failures from unrelated bugs.
**Root cause:** Three of seven architecturally-identical "facade + typed options" pillar packages invested in the typed-error convention; three did not, despite otherwise near-identical doc-comment structure and design philosophy.
**Recommended fix:** Add `QueueError`, `EventsError`, `RealtimeError` base classes (reusing the proven `cause`-carrying pattern from storage/gateway/workflow) and convert the cited plain-`Error` throw sites. Non-breaking since `instanceof Error` still passes for the new subclasses.
**Estimated effort:** Small-Medium (2-3 days across three packages). **Risk:** Very low — purely additive.
**Expected impact:** Medium. Improves catch-and-discriminate ergonomics for the three packages most likely to be used together in a real backend (queue+events+realtime are a natural combination).

### F-API2 — Four different field-name pairs for the same "N requests per window" rate-limit concept
**Severity:** Medium **Category:** API design consistency
**Evidence:** `packages/core/src/security/ratelimit.ts` alone has three different shapes across three of its own exported types (`RateLimiterOptions{windowMs,maxRequests}`, `RateLimitDecoratorOptions{requests,window}`, `ScopedRateLimitOptions{requests,window: string|number}`), and `packages/gateway/src/types.ts`'s `RateLimitPolicy{limit,windowMs}` adds a fourth. `packages/queue/src/facade.ts`'s inline rate-limit type matches core's naming but is a structurally distinct type.
**Root cause:** Independent evolution of the rate-limiting concept across four locations with no shared canonical option shape.
**Recommended fix:** Pick one canonical pair (recommend `limit`/`windowMs`, matching gateway) and either alias the others via deprecated re-exports or migrate the decorator/scoped variants.
**Estimated effort:** Small-Medium (deprecation aliases: 1 day; full migration: 3-4 days). **Risk:** Low if done via additive aliasing first.
**Expected impact:** Medium — this is exactly the "one driver takes X, another Y" friction a new user hits immediately when composing rate limiting across core and gateway.

### F-API3 — Inconsistent timeout field naming/semantics across otherwise-parallel plugin configs
**Severity:** Medium **Category:** API design consistency
**Evidence:** `plugin-redis`/`plugin-mongodb` use `timeoutMs` to mean "any operation timeout, including in-flight commands" (verified: redis's `timeoutMs` is consulted inside `command()`, not just at connect). `plugin-kafka`/`plugin-rabbitmq`/`plugin-postgres`/`plugin-mysql` use `connectTimeoutMs` meaning connect-phase only. `packages/gateway/src/types.ts`'s `RoutePolicy.timeoutMs` is a third, distinct semantic (per-request timeout). A user moving a config from postgres to redis would reasonably but incorrectly assume `connectTimeoutMs` still works.
**Root cause:** No canonical timeout-naming convention was established before the plugins were built independently.
**Recommended fix:** Standardize on `connectTimeoutMs` for connection establishment everywhere, and add an explicit separate `commandTimeoutMs`/`operationTimeoutMs` for redis/mongo's per-command timeout rather than overloading `timeoutMs`.
**Estimated effort:** Small (additive alias + deprecation notice: 1-2 days). **Risk:** Low.
**Expected impact:** Medium.

### F-T1 — No property-based/fuzz testing of malformed or fragmented input for the wire protocol parsers
**Severity:** Medium-High **Category:** Testing quality
**Evidence:** `packages/core/src/transports/resp.ts` (RESP parser) has only 2 example-based test cases for incomplete-frame handling (`packages/core/src/tests/roadmap-completion.test.ts:424-441`) and no fast-check coverage despite the project having `fast-check` as a dependency and 100+ PBT files elsewhere. `packages/core/src/database/wire.ts`'s `_parseRowDescription` (bounds-checked per a code comment explicitly citing "prevent OOB reads on malformed packets from a misbehaving or malicious server") and the MySQL wire parser have **no test that feeds truncated, malformed, or TCP-fragment-boundary-split bytes directly into the parser** — the closest test (`core/tests/system/fuzz-testing.test.ts`) only mocks `PgConnection.connect` to fuzz pool *configuration*, never wire *bytes*.
**Root cause:** PBT adoption was applied thoroughly to business-logic invariants (backoff, rate limiting, event matching) but not extended to the protocol-parsing layer, despite that layer explicitly being hardened once already against a known attack class (OOB reads) that fuzzing is specifically designed to catch.
**Recommended fix:** Add fast-check generators producing arbitrary/adversarial byte sequences (including truncated frames, negative lengths, TCP-chunk-boundary splits) fed directly into `RespParser`, `StreetPostgresWireStream`'s row-description/data-row parsers, and the MySQL wire parser, modeled on the existing `matcher.test.ts`/`backoff.property.test.ts` PBT style already used elsewhere in the codebase.
**Estimated effort:** Medium (1 week for all three parsers). **Risk:** Very low — test-only addition.
**Expected impact:** High relative to effort — this is precisely the layer most exposed to a hostile or buggy server, and the codebase already proved (via the cited bounds-check fix) that this attack class is real.

### F-T2 — Hardcoded-sleep synchronization in queue/realtime tests risks CI flakiness
**Severity:** Low-Medium **Category:** Testing quality
**Evidence:** `packages/queue/src/tests/worker-rate-limit.test.ts:57`, `worker-loop.test.ts:73`, `driver-init-failure.test.ts:195`, `lifecycle-events.test.ts:213-216` all use fixed 30-200ms `setTimeout` sleeps with comments like "give the loop a chance to (incorrectly) start" — a negative assertion gated on a fixed sleep, which can false-pass under CI load if the leak is merely slow rather than absent. Most of these files also use a proper `waitFor(predicate, timeout)` polling helper for positive assertions, reserving the fixed sleep only for negative ("prove it did NOT happen") assertions — a legitimate but inherently racy pattern.
**Root cause:** Negative assertions ("this should not have happened yet") are structurally harder to make deterministic than positive ones without a fully injected/virtual clock for the code under test, and the queue worker loop's timing isn't fully clock-injectable in these test paths.
**Recommended fix:** Where feasible, replace the fixed-sleep negative assertions with a `waitFor`-style poll that fails fast on a negative condition remaining false for a generous timeout, rather than sleeping a fixed short duration and checking once.
**Estimated effort:** Small (1-2 days). **Risk:** Low.
**Expected impact:** Low-Medium — reduces a plausible (though not yet observed and reported) source of CI flakiness under load.

### F-DOC1 — `docs/jobs/index.md` documents a `queue.onDeadLetter()` method that does not exist
**Severity:** High **Category:** Documentation accuracy
**Evidence:** The doc's "DLQ Configuration" section shows `queue.onDeadLetter(async (job) => {...})`. `packages/core/src/jobs/queue.ts`'s actual `JobQueue` class has no `onDeadLetter` method (confirmed via exhaustive grep — zero matches); DLQ handling is internal (`_moveToDlq`, private) with the only public DLQ-adjacent API being `pruneDeadLetterQueue()`/`registerDlqPruning()`. The doc's very next code block also queries a table name (`street_jobs_dlq`) that doesn't match the real table (`street_dead_letter_queue`) — a second mismatch in the same section. Additionally, the doc's `@Job` decorator example uses a `run()` method, but `queue.ts`'s own doc comment states the class "must implement `execute(payload, ctx)`" — a third mismatch in the same guide.
**Root cause:** The jobs guide appears to document either an earlier or an aspirational API surface that was never implemented or was later changed without the doc being updated.
**Recommended fix:** Either implement `onDeadLetter()` as a real hook (if intended) or rewrite the doc section to reflect the actual API (`pruneDeadLetterQueue`, `registerDlqPruning`, and direct SQL against `street_dead_letter_queue`), and fix the `run()`→`execute()` method name mismatch.
**Estimated effort:** Small (doc-only fix: half a day; if implementing the hook instead: 1-2 days). **Risk:** None (docs) to Low (if adding the hook).
**Expected impact:** High relative to effort — this is a first-run-breaking documentation defect in a core, prominently-linked guide (`docs/jobs/index.md`), exactly the kind of thing that erodes trust immediately.

### F-DOC2 — README/installation docs state Node ≥20; actual enforced requirement is ≥22
**Severity:** Medium **Category:** Documentation accuracy
**Evidence:** `README.md:18,101` and `docs/getting-started/installation.md:26` both say "Node.js ≥20 / 20.0.0". `packages/core/package.json` and `packages/cli/package.json` both declare `"engines": {"node": ">=22.0.0"}`, and `packages/cli/src/commands/doctor.ts` actively fails `street doctor` (exit code 1) for Node <22.
**Root cause:** The engine requirement was bumped to 22 (per the engagement history's "chore: upgrade Node.js baseline 20 → 22 LTS" commit) without updating the two doc pages.
**Recommended fix:** Update both doc pages to ≥22 to match the enforced requirement.
**Estimated effort:** Trivial (30 minutes). **Risk:** None.
**Expected impact:** Medium — directly undercuts an otherwise excellent first-run experience (DX-1/DX-2 below), since a user following the documented minimum fails `street doctor` immediately after install.

### F-DOC3 — `@streetjs/queue` (the published package) has zero documentation coverage; `docs/jobs/` documents an unrelated, similarly-named in-core system
**Severity:** Medium **Category:** Documentation completeness
**Evidence:** Grep for `@streetjs/queue` and `createQueue` across `docs/**/*.md` returns zero matches. `docs/jobs/index.md` documents only the in-core, PostgreSQL-backed `JobQueue`/`Job`/`CronScheduler`/`WorkflowEngine` system — a completely different package/API from `packages/queue/src/index.ts`'s `createQueue`/`Scheduler`/`MemoryDriver`/testing harness, which ships its own README but no `docs/` presence at all.
**Root cause:** Two independently-named "queue" systems exist (core's PostgreSQL job queue, and the standalone `@streetjs/queue` package) and only one is documented under `docs/`.
**Recommended fix:** Add a `docs/queue/` section for `@streetjs/queue`, and cross-link/disambiguate the two systems explicitly from `docs/jobs/index.md`.
**Estimated effort:** Medium (1-2 days for a proper quick-start page). **Risk:** None.
**Expected impact:** Medium — a real published package is currently undiscoverable through the documentation site.

### F-DOC4 — `docs/storage/index.md` doesn't document `createStorage`, the package's primary public entry point
**Severity:** Medium **Category:** Documentation completeness
**Evidence:** `packages/storage/src/facade.ts` states "application code talks only to the Storage facade returned by `createStorage`," but `docs/storage/index.md` is a two-sentence stub with no code sample and zero mentions of `createStorage` anywhere in the docs tree (confirmed via grep).
**Root cause:** Same class of gap as F-DOC3 — a real, central public API with no corresponding doc page.
**Recommended fix:** Add a `createStorage({...})` quick-start example using the real `StorageConfig` shape.
**Estimated effort:** Small (half a day). **Risk:** None.
**Expected impact:** Medium.

### F-BUILD1 — No shared base `tsconfig.json`; every package hand-duplicates compiler options with observed drift
**Severity:** Low-Medium **Category:** Build system / maintainability
**Evidence:** No root-level shared tsconfig exists (confirmed absent). Nine sampled `tsconfig.json` files (storage, queue, realtime, plugin-redis, plugin-postgres, plugin-stripe, plugin-s3, plugin-twilio, plugin-openai) are all hand-duplicated with no `extends`, and drift was found: storage/queue lack `noUnusedParameters` while realtime and all sampled plugins have it; storage/queue have `experimentalDecorators`+`emitDecoratorMetadata` while realtime and plugins don't.
**Root cause:** No shared base config was ever established; each package's tsconfig was copy-pasted and independently drifted since.
**Recommended fix:** Introduce a root `tsconfig.base.json` with the common options, and have every package's `tsconfig.json` `extend` it plus declare only its genuine deltas (e.g. `experimentalDecorators` only where actually used).
**Estimated effort:** Medium (2-3 days to introduce the base and migrate ~54 packages, mostly mechanical). **Risk:** Low — TypeScript's `extends` merge is well-understood; the main risk is a package silently relying on a currently-drifted flag it needs.
**Expected impact:** Medium — prevents future silent drift and makes intentional per-package differences visible instead of buried in duplicated blocks.

### F-BUILD2 — No dependency caching in any GitHub Actions workflow
**Severity:** Low **Category:** Build system / CI efficiency
**Evidence:** Grep for `cache:` (the `actions/setup-node` cache input) or `actions/cache` usage across all `.github/workflows/*.yml` found no matches (only unrelated Ruby bundler-cache references in docs workflows). The shared composite action `.github/actions/setup/action.yml` calls `actions/setup-node` with no `cache` input, then runs a cold `npm ci` every job, every run.
**Root cause:** Caching was never configured when the composite setup action was created.
**Recommended fix:** Add `cache: 'npm'` to the `actions/setup-node` step in `.github/actions/setup/action.yml`.
**Estimated effort:** Trivial (under an hour). **Risk:** None — this is exactly what the cache input is designed for.
**Expected impact:** Low-Medium — meaningful CI wall-clock/cost savings across dozens of workflows that all run `npm ci` on every dispatch, with essentially zero implementation risk.

### F-PLUGIN1 — HTTP outbound-timeout logic and Ed25519 manifest-signing scripts are copy-pasted verbatim across 9 and 21 packages respectively
**Severity:** Low-Medium **Category:** Plugin ecosystem consolidation
**Evidence:** The `DEFAULT_TIMEOUT_MS = 30_000` + validation + `httpsRequest`+`timeout`+`destroy` pattern (added in a prior engagement, item #8) is structurally identical, independently authored per plugin across all 9 HTTP plugins (verified directly by comparing `plugin-openai/src/index.ts` and `plugin-clerk/src/index.ts` — near byte-identical). Separately, the manifest-signing script (`scripts/sign.mjs` / `scripts/sign-manifest.mjs` — two different filenames, identical Ed25519 sign/verify logic) is duplicated across at least `plugin-clerk`, `plugin-openai`, `plugin-rabbitmq`, `plugin-twilio` and, by the naming pattern, likely all 21 plugin packages.
**Root cause:** Each plugin package was scaffolded independently rather than depending on a shared `@streetjs/plugin-kit`-style helper package.
**Recommended fix:** Extract a small shared internal helper (timeout-enforcing HTTPS client wrapper, and the signing script) into a shared package or a `scripts/plugin-shared/` module every plugin's build imports, rather than a copy per package.
**Estimated effort:** Medium (3-5 days to extract, then update 9-21 call sites — mechanical, low individual risk per site). **Risk:** Low-Medium — must be careful the extraction doesn't accidentally change per-plugin behavior (e.g. a plugin-specific error-message wording).
**Expected impact:** Medium — the current duplication means any future security fix to the timeout logic (as happened once already) or the signing scheme requires 9-21 synchronized edits instead of one.

### F-PLUGIN2 — Version drift across plugin packages; 6 of 21 plugins have zero tests
**Severity:** Low **Category:** Plugin ecosystem maintenance
**Evidence:** 18/21 plugins are at `1.0.3`, but `plugin-marzpay` is `1.1.0`, `plugin-htmx` is `1.0.0`, `plugin-africastalking` is `1.0.1` — unexplained drift with no corresponding functional differences found. Separately, `plugin-auth0`, `plugin-r2`, `plugin-s3`, `plugin-sendgrid`, `plugin-stripe`, `plugin-twilio` have no `test/`/`src/tests/` directory at all (6 of 21 plugins with zero tests), a gap not tracked anywhere in `plans/OUTSTANDING-ACTIONS.md` (which currently only tracks the *examples* claim, item #21, verified accurate at 20/21).
**Root cause:** Ad hoc per-plugin version bumps during unrelated fixes; test coverage was never made a publish gate for plugin packages.
**Recommended fix:** Normalize versions in the next coordinated plugin release; add a minimal smoke-test requirement (at least "config validator round-trips" + "manifest is well-formed") as a CI gate for all 21 plugins before publish.
**Estimated effort:** Small (version normalization: half a day) + Medium (minimal tests for 6 plugins: 2-3 days). **Risk:** Low.
**Expected impact:** Low-Medium.

---

## Prioritized Roadmap

**Immediate (before any further release):**
- F-DOC1 (fix or implement `onDeadLetter`/`execute` docs mismatch — first-run breaking)
- F-DOC2 (Node version doc fix — trivial, undercuts first impression)
- F-BUILD2 (enable npm caching in CI — trivial, real cost savings)

**Next release (v1.2.x):**
- F-P1 (fix O(n²) buffer accumulation in Postgres/MySQL wire clients)
- F-S2 (fix gateway absolute-path SSRF)
- F-DOC3, F-DOC4 (document `@streetjs/queue` and `createStorage`)

**v1.x (within the 1.x line, non-breaking):**
- F-S1 (add TLS to Postgres/MySQL wire clients — additive, opt-in)
- F-A1 (consolidate backoff formulas behind one canonical implementation)
- F-API1 (add typed error hierarchies to queue/events/realtime — additive)
- F-T1 (add PBT/fuzzing to the wire protocol parsers)
- F-PLUGIN1 (extract shared timeout/signing helpers for plugins)
- F-BUILD1 (introduce shared base tsconfig)

**v2 (candidate breaking-change window):**
- F-API2, F-API3 (canonicalize rate-limit and timeout option shapes — could be done non-breaking via aliasing instead, see "Future v2 Opportunities")
- F-A2 (remove or properly wire the dead CQRS bus and core CircuitBreaker)

**Long-term:**
- F-T2 (reduce hardcoded-sleep test flakiness risk)
- F-PLUGIN2 (plugin version normalization and minimum test-coverage gate)

---

## Top 25 Improvements (ranked)

1. **Fix O(n²) buffer accumulation in Postgres/MySQL wire clients** (F-P1) — Impact: High / Difficulty: Low. Measured 30x-1820x slowdown scaling with result-set size; the two most-used DB clients in the framework.
2. **Fix `docs/jobs/index.md`'s `onDeadLetter`/`execute` mismatches** (F-DOC1) — Impact: High / Difficulty: Trivial. Breaks a first-time user's build in the most prominently linked backend-jobs guide.
3. **Fix gateway absolute-path SSRF** (F-S2) — Impact: High / Difficulty: Low. Live-reproduced bypass of the configured upstream target.
4. **Add TLS to core Postgres/MySQL wire clients** (F-S1) — Impact: High / Difficulty: Medium. Closes the last major cleartext-credential gap after the plugin TLS pass.
5. **Add PBT/fuzzing to wire protocol parsers** (F-T1) — Impact: High / Difficulty: Medium. The exact attack class (OOB reads on malformed input) this framework already fixed once, still unguarded by regression tests.
6. **Fix README/installation Node version mismatch** (F-DOC2) — Impact: Medium / Difficulty: Trivial. Immediate first-run failure for a doc-following user.
7. **Enable npm dependency caching in CI** (F-BUILD2) — Impact: Medium / Difficulty: Trivial. Free CI speed/cost win across every workflow.
8. **Consolidate 5-6 duplicated backoff implementations** (F-A1) — Impact: Medium / Difficulty: Medium. Removes a synchronized-edit trap for any future formula change.
9. **Add typed error hierarchies to queue/events/realtime** (F-API1) — Impact: Medium / Difficulty: Low. Brings 3 pillar packages up to the storage/gateway/workflow standard.
10. **Document `@streetjs/queue`** (F-DOC3) — Impact: Medium / Difficulty: Medium. A real published package currently invisible in the docs site.
11. **Document `createStorage`** (F-DOC4) — Impact: Medium / Difficulty: Low. Primary entry point of a pillar package, undocumented.
12. **Canonicalize rate-limit option shape** (F-API2) — Impact: Medium / Difficulty: Low-Medium. Four incompatible shapes for one concept across core+gateway+queue.
13. **Canonicalize timeout field naming/semantics** (F-API3) — Impact: Medium / Difficulty: Low. Silent behavior gap when porting config between plugins.
14. **Extract shared plugin timeout/signing helpers** (F-PLUGIN1) — Impact: Medium / Difficulty: Medium. Removes a 9-21x synchronized-edit multiplier for future plugin security fixes.
15. **Introduce a shared base tsconfig** (F-BUILD1) — Impact: Medium / Difficulty: Medium. Prevents silent compiler-option drift across 54 packages.
16. **Remove or wire the dead core CQRS bus / CircuitBreaker** (F-A2) — Impact: Low-Medium / Difficulty: Low. Confirmed-dead exported surface adding maintenance and comprehension cost.
17. **Reduce hardcoded-sleep flakiness risk in queue/realtime tests** (F-T2) — Impact: Low-Medium / Difficulty: Low. Plausible CI-flakiness source under load, not yet observed but structurally present.
18. **Normalize plugin package versions** (F-PLUGIN2, part 1) — Impact: Low / Difficulty: Trivial. Cosmetic but visible maintenance-quality signal.
19. **Add minimum test coverage gate for the 6 zero-test plugins** (F-PLUGIN2, part 2) — Impact: Low-Medium / Difficulty: Medium.
20. **Add a `codemod` catalog entry for every breaking change tracked in `upgrade.ts`**, not just the current single entry — Impact: Medium (future-facing) / Difficulty: Medium. The real, tested codemod infrastructure (DX-5) is under-populated relative to the framework's 300+-symbol surface.
21. **Apply the storage/`doctor.ts` actionable-error convention to core's descriptive-only errors** (e.g. `tool-registry.ts`, `replication.ts`, `tenancy/provisioner.ts`) — Impact: Medium / Difficulty: Low-Medium. A proven-good pattern exists; it just isn't applied everywhere.
22. **Add an output cursor/`hasMore` to storage's `list()`** — Impact: Low-Medium / Difficulty: Low. Currently accepts a cursor for input but gives no signal whether more results exist; weigh against consistency with ORM/queue/workflow's bare-array convention before changing.
23. **Standardize the `createX` vs `new X()` vs `connectX` construction pattern** across ORM and the DB plugin packages (F from API design sub-agent) — Impact: Medium / Difficulty: Medium. ORM is the only pillar package without a `createOrm()` factory; DB plugins never expose a public factory at all.
24. **Consolidate Backblaze's overload-based `createBackblazeB2Driver` pattern** (single function, two signatures) as the standard for all cloud storage drivers, replacing the current two-functions-per-provider convention — Impact: Low / Difficulty: Medium (touches 5+ driver files).
25. **Add real GCS/Azure emulator wiring to `provider-integration.yml`'s live-round-trip tests** (already-running `fake-gcs`/`azurite` emulators exist in that workflow but aren't connected to the tests that gate on `GCS_BUCKET`/`AZURE_STORAGE_CONNECTION_STRING`) — Impact: Low-Medium / Difficulty: Low. A small wiring gap already identified and partially fixed in `plans/OUTSTANDING-ACTIONS.md` item #32.

---

## Things That Were Better Than Expected

- **The wire protocol implementations themselves** (Postgres SCRAM-SHA-256, MySQL `caching_sha2_password`/`mysql_native_password`, RESP) are genuinely well-built hand-rolled protocol clients with real security awareness baked in — e.g. MySQL's explicit refusal to send a cleartext password over an unencrypted connection, Postgres's SCRAM nonce-substitution and server-signature verification via `timingSafeEqual`. The O(n²) buffer bug (F-P1) and missing TLS (F-S1) are real gaps, but they sit inside an otherwise carefully-reasoned protocol implementation, not a naive one.
- **Property-based testing depth** in the packages that use it (queue's retry/DLQ engine, events' wildcard matcher, workflow's backoff, gateway's rate limiting) is genuinely excellent — exact-formula assertions combined with monotonicity/bound invariants and injected/advanceable clocks for full determinism. `packages/queue`'s `TestHarness` pattern in particular is the best-designed test harness encountered in this audit.
- **The CLI's `doctor`/`defineConfig`/first-run messaging** (DX-1, DX-2, DX-7) sets a genuinely high bar: every validation error names the exact fix (including runnable remediation commands like `openssl rand -hex ${bytes}`), and `defineConfig` collects *all* errors before throwing rather than failing on the first one — a small but real UX investment many frameworks skip.
- **Package boundary discipline** is clean: a full grep for cross-package deep relative imports found zero violations — every cross-package reference goes through the `streetjs` public export, never a relative path into another package's internals.
- **The codemod/upgrade-safety infrastructure** (`packages/core/src/devx/codemods.ts`) is real, tested (including a property-based safety test proving codemods leave source byte-for-byte unchanged on parse failure), not aspirational documentation — a genuinely mature capability that many frameworks only promise.
- **Plugin publish quality**: LICENSE, README, and manifest signing are consistently present and CI-verified (21/21 signature verification) across the plugin ecosystem, and 20/21 plugins ship a genuinely runnable, CI-syntax-checked example — the one prior claim from `plans/OUTSTANDING-ACTIONS.md` this audit independently re-verified and found accurate.

## Things That Should Not Be Changed

- **The `createX(options): X` facade pattern** used consistently across storage, queue, events, realtime, workflow, and gateway — this is the framework's strongest cross-package consistency win and should be the template ORM and the DB plugins converge toward (see Top 25 #23), not something to move away from.
- **The clock-injection pattern** (`Clock`/`systemClock` from `streetjs`, consumed by gateway's circuit breaker and rate limiter, queue's retry engine, workflow's backoff) — this is what makes the framework's time-based logic genuinely deterministic under test, and it's applied consistently everywhere it matters.
- **The "cloud SDKs behind subpath exports" pattern** (storage's `/s3`, `/r2`, `/minio`; queue's `/redis`; realtime's `/redis`) that keeps the base package dependency-free while still supporting optional heavy SDKs — this is a deliberate, well-documented, and consistently-applied design decision, not an accident, and should be extended to any new optional-dependency surface rather than abandoned.
- **The honest-skip testing culture** (tests that explicitly `t.skip()` with a clear reason rather than fabricating a pass when credentials/services are unavailable) — this is a rare and valuable discipline that should be defended as new integrations are added, including any future PBT work on the wire parsers (F-T1).
- **The zero-dependency wire protocol implementations themselves.** The O(n²) buffer bug and missing TLS are real, fixable defects in the implementation, not evidence that hand-rolling the protocols was the wrong call — the depth of protocol-correctness reasoning already present (SCRAM nonce/signature verification, MySQL auth-plugin negotiation) is a genuine asset worth preserving rather than replacing with a third-party driver dependency.

---

## Final Verdict

# Good

**Justification:** StreetJS v1.1.1 has no architectural defect serious enough to warrant a rewrite or major refactor, and several subsystems (the wire protocols' security reasoning, the PBT-covered resilience primitives, the CLI's error-message discipline, package boundary hygiene) are executed at a level that exceeds what "Good" usually implies. What holds this back from "Excellent" is a consistent, identifiable pattern: the same small set of concerns (backoff math, error typing, timeout semantics, TLS coverage) were solved well in some packages and re-solved independently, inconsistently, or not at all in others — because no shared foundation layer enforces the standard the best packages already demonstrate. Combined with one measured, real O(n²) performance defect and one live-reproduced SSRF finding in the gateway, this is a framework that is close to "Excellent" and can get there through the Immediate/Next-release/v1.x tiers of the roadmap above without needing v2 to be a from-scratch redesign. v2, when it comes, should be scoped as a consolidation and API-canonicalization release (Top 25 items #8, #9, #12, #13, #14, #15, #23) rather than a reimplementation — the primitives underneath are sound.
