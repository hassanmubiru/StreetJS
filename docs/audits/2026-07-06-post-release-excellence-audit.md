---
layout: default
title: "Post-Release Excellence Audit — 2026-07-06"
nav_exclude: true
description: "Evidence-based post-1.0 audit of StreetJS identifying the highest-value engineering work for v1.1/v2.0: architecture, performance, DX, security, testing, ecosystem, and packaging."
sitemap:     false
noindex:     true
---

# StreetJS — Post-Release Excellence Audit & Roadmap

**Commit:** `2c3e987f` (`main`)
**Scope:** All 54 packages under `packages/*`. This is **not** a release-readiness
audit — it assumes 1.0 shipped and asks what's worth building next.
**Method:** Evidence-only. Every finding below cites a file:line, an executed
command's real output, or a confirmed absence (grep/file_search returning zero
matches). Claims from prior engagement reports were treated as unverified until
re-checked in this pass; several were re-confirmed directly, none were
contradicted, but they were not taken on faith.

---

## Executive Summary

StreetJS's core engineering discipline is genuinely strong: clean package
layering (verified — no circular architectural dependencies), a real fuzz
harness, hard-fail-on-missing-secret patterns three layers deep, zero
`npm audit` findings, and a tree-shake-friendly named-export barrel. The
framework is not held back by sloppy fundamentals.

What it's held back by, after 1.0:

1. **A real path-traversal vulnerability in the storage package** (Critical, verified, no fix pattern applied despite one existing in core).
2. **Two genuine O(n²) buffer-handling bugs** in the PostgreSQL and Redis wire-protocol clients that will cause real latency cliffs under large payloads/messages.
3. **A misleading benchmark number** (64MB "memory usage" vs Fastify's 6MB) that is actually one-time barrel-import cost, not a runtime characteristic — this is actively hurting adoption perception and is fixable.
4. **6 published plugins with zero tests**, including payment (Stripe) and auth (Auth0) integrations.
5. **Duplicated TLS/connection-option boilerplate** across 5 database/queue plugins with no shared base type, despite the pattern existing elsewhere in core.
6. Two dead public abstractions (CQRS bus, in-core CircuitBreaker) that add API surface with zero real consumers.

None of this is "the architecture is wrong." It's targeted, fixable debt in a codebase that otherwise made good decisions. The roadmap below is sequenced so the highest-ROI items (mostly Critical/High, mostly Quick/Medium effort) come first.

---

## Strengths (verified, not assumed)

- **Package layering is clean.** Direct inspection of all 54 `packages/*/package.json` dependency lists found no plugin depending on a framework package or vice versa; cross-pillar dependencies are `peerDependencies`, not hard deps.
- **No circular dependencies.** `node scripts/audit/repo-wide-checks.mjs` — 0 cycles across 880 files in the full-depth-checked scope.
- **`npm audit --omit=dev` at repo root: "found 0 vulnerabilities"** (executed this session).
- **Secrets have no hardcoded fallback.** Traced the hard-fail path three layers deep: `config/index.ts:44-48` (required) → `security/vault.ts:73-82` (throws if unset/empty) → `security/jwt.ts:26-29` (throws if <32 chars) → `security/session.ts:21-35` (throws if not 64-char hex, rejects low-entropy keys).
- **The fuzz harness is real.** `packages/core/tests/system/fuzz-testing.test.ts` (1015 lines, read in full) runs real generators against real production classes (`JwtService`, `SessionManager`, `LruCache`, `PgPool`) with meaningful invariant assertions — not a placeholder.
- **TLS defaults are secure.** DB/queue plugins default `rejectUnauthorized ?? true`; `webhook/dispatcher.ts:243-263` never forwards `rejectUnauthorized` at all, enforced by a regression test (`webhook-tls-validation.test.ts:21-40`).
- **`core/src/index.ts` uses exclusively named re-exports** (zero `export *`, confirmed via grep) — genuinely tree-shake-friendly, a real packaging strength most frameworks get wrong.
- **CLI error messages are actionable**, not generic — e.g. `migrate.ts:45-48` tells the user the exact recovery step; `generate.ts:59-61` prints usage + valid types + a worked example.

---

## Top findings by area

### 1. Security

**[CRITICAL] Path traversal in `LocalStorageDriver`.**
`packages/storage/src/drivers/local.ts:314` (`objectPath`) and `:319` (`metaPath`)
resolve the on-disk path via bare `path.join(this.root, key)` with **no
containment check anywhere in `packages/storage/src`** (verified: grep for
`resolveContained`/`../`/traversal-guard patterns across the entire package
returns zero hits outside this finding). A key of `../../../../etc/passwd`
resolves outside `this.root`. This is exploitable wherever `key` is influenced
by user/tenant input, which is the driver's documented use case. Core already
has the correct fix pattern at `packages/core/src/platform/plugins/registry.ts:55-68`
(`resolveContained()`, used for plugin-tarball extraction) — it was simply
never applied to storage.
*Impact: Critical. Effort: Quick win (<1 day — port `resolveContained`, add a
regression test with `../` keys). Suitable for: v1.0.x (security patch, should
not wait for a minor).*

**[MEDIUM] Unguarded `JSON.parse` on raw request bodies.**
`packages/core/src/http/server.ts:186` and `packages/core/src/microservices/http2.ts:177`
call `JSON.parse(raw)` on the HTTP body with no prototype-pollution guard,
unlike the hardened zod-based parse already used at
`platform/plugins/registry.ts:182`. No downstream unsafe-merge sink was found
(searched for `deepMerge`/unguarded `Object.assign` patterns against the parsed
result), so real exploitability is **NOT VERIFIED**, but the missing defense-in-depth
is real and cheap to add.
*Impact: Medium. Effort: Quick win. Suitable for: v1.0.x.*

**[VERIFIED CLEAN] No `eval()`/`new Function()`, no injection-vector command execution.** Confirmed via repo-wide grep across `packages/*/src`; CLI's `spawn` calls use fixed argv, not user-influenced shell strings (5 calls unnecessarily set `shell: true` with static args — cosmetic, not exploitable).

### 2. Performance

**[HIGH] O(n²) buffer accumulation in both the Postgres and Redis wire clients.**
Verified directly:
- `packages/core/src/database/wire.ts:500` — `this.buffer = Buffer.concat([this.buffer, chunk])` on every incoming TCP chunk during normal operation (a 64KB cap exists but only during the `authenticating` state, per the comment at :486-488 — post-auth traffic is unbounded).
- `packages/core/src/transports/resp.ts:28` — identical pattern in the Redis RESP2 parser (`this.buf = Buffer.concat([this.buf, chunk])`).

Both re-copy the entire accumulated buffer on every chunk rather than reading
into a growable/ring buffer or tracking an offset. Measured by the investigating
sub-agent: doubling payload size roughly quadruples processing time in both
cases — classic quadratic scaling. This will show up as real latency cliffs on
large query result sets or large Redis values/pub-sub messages, which is
exactly the kind of thing that doesn't show up in a "return `{status:ok}`"
benchmark but does in production.
*Impact: High (silent tail-latency/CPU cliff under realistic payloads). Effort:
Medium (1-3 days — replace with an offset-tracked buffer or a proper
ring-buffer read pattern per connection; needs the existing wire-protocol test
suites to stay green). Suitable for: v1.1.*

**[HIGH] The published memory-usage benchmark number is real but misleading, and is actively hurting adoption perception.**
`benchmarks/results.md` (last updated 2026-06-13, still current) shows StreetJS
at 64.11MB vs Fastify 6.43MB / Hono 10.15MB / Express 5.27MB for a route that
just returns `{"status":"ok"}`. Verified this is **one-time bootstrap cost, not
a per-request leak or runtime characteristic**: heap stayed flat (11.1MB→12.4MB)
across 5000 requests in a direct re-measurement. Root cause: `benchmarks/compare/servers.mjs`
imports the entire `dist/index.js` barrel to serve one static route, and
`packages/core/src/index.ts` eagerly re-exports ~600 lines spanning
auth/jobs/graphql/kafka/rabbitmq/enterprise/observability/etc. A bare
`import(dist/index.js)` alone was measured to cost ~29.8MB RSS before any
server or app object is even created. This means every comparison shown in the
public benchmarks table — the one thing prospective adopters actually look
at — makes StreetJS look 6-12x heavier than competitors for a reason that has
nothing to do with per-request behavior.

Two independent fixes, both worth doing:
- **(a) Fix the benchmark methodology** to measure only the subsystems the
  compared route actually uses (or add a "minimal app" comparison row), so the
  published numbers reflect reality.
- **(b) Reduce eager barrel cost** — evaluate whether heavy, rarely-used
  subsystems (kafka/rabbitmq/graphql/enterprise) can be lazily imported behind
  their own subpaths (several already have dedicated `exports` subpaths, e.g.
  `./cluster`, `./telemetry` — the barrel doesn't need to re-import them at
  root-import time for users who only import the subpath).

*Impact: High (adoption-perception, not correctness). Effort: (a) Quick win
<1 day; (b) Medium, 2-4 days, needs care to avoid breaking the "one import
gets everything" DX some users rely on. Suitable for: (a) v1.0.x doc/benchmark
fix immediately; (b) v1.1 as an opt-in lazy-loading pass.*

**[MEDIUM] Storage upload validation silently defeats streaming.**
`packages/storage/src/facade.ts:846-869` falls back to fully buffering the
entire upload via `collectStream()` (`facade.ts:1198`) whenever a validation
pipeline is configured — even though `LocalStorageDriver.putStream`/`getStream`
are genuinely streaming (`drivers/local.ts`, verified via `fs` pipeline, never
buffers full file). This defeats streaming for the single most common
production case: validating an upload before accepting it. Large-file uploads
with any validation rule configured will load the whole file into memory.
*Impact: Medium-High for anyone uploading large files with validation enabled.
Effort: Medium (2-4 days — needs a streaming validator interface, e.g.
chunk-wise magic-byte/size checks, rather than collect-then-validate).
Suitable for: v1.1.*

**[LOW] Router route-matching is O(n) over registered routes.**
`router.ts:139-153` — measured 2µs/dispatch at 10 routes vs 440µs/dispatch at
5000 routes. Regexes are correctly precompiled at registration time (not a
per-request cost), so this only matters for apps with thousands of routes,
which is uncommon. Not worth prioritizing now, but worth a radix-tree/trie
rewrite if a future large-scale user reports it.
*Impact: Low today. Effort: Large (radix tree rewrite touching route
resolution + middleware ordering). Suitable for: v2.0, only if real usage
data shows apps with >1000 routes.*

**[LOW] Load-testing suite doesn't assert latency/throughput budgets.**
`packages/core/tests/system/load-testing.test.ts` collects timing data but only
asserts success-rate/status-code/data-integrity. A 10x latency regression
(e.g. reintroducing the O(n²) buffer bug above) would pass this suite
undetected.
*Impact: Medium as a safety net for the fixes above. Effort: Quick win (add
p95/p99 budget assertions using data the suite already collects). Suitable
for: v1.1, bundled with the buffer-handling fix so the fix has a regression
guard.*

### 3. Testing

**[HIGH] 6 published plugins have zero tests, including payment and auth integrations.**
Verified directly (not taking the earlier "30 of 54" sub-agent claim at face
value — re-ran the check myself with a broader test-file glob and got a
different, smaller number): `core-compat`, `plugin-auth0`, `plugin-r2`,
`plugin-s3`, `plugin-sendgrid`, `plugin-stripe`, `plugin-twilio` have zero
files matching `*test*` anywhere under their package directory (excluding
`node_modules`/`dist`). Of these, `core-compat` is a pure re-export shim
(low risk — its whole job is to re-export `streetjs` unchanged). The other
six are real concern: **Stripe (payments)** and **Auth0/Twilio (auth/2FA
delivery)** ship with no test coverage at all, in contrast to `plugin-redis`,
`plugin-mongodb`, `plugin-kafka`, etc., which do have tests (2-6 files each).
This is inconsistent with the `docs/plugins/webhook-verification.md` guide,
which documents constant-time webhook verifiers for exactly these providers —
the verifiers exist and are documented, but (per this check) aren't covered
by tests inside `plugin-stripe`/`plugin-twilio` themselves (the earlier
engagement's webhook-verifier tests live in `packages/core`, not in the
plugin packages).
*Impact: High (payment/auth code with zero regression coverage). Effort:
Medium (1-3 days for all 6, mostly config-validation + webhook-verify smoke
tests, following the existing pattern in `plugin-redis`/`plugin-mongodb`).
Suitable for: v1.0.x/v1.1 — this is bug-prevention, not a feature.*

**[MEDIUM] `packages/core`'s own `coverage` npm script is broken.**
Ran `npm run coverage -w packages/core` — it failed, reporting "All files | 0 | 0 | 0 | 0". The script hardcodes 9 specific `dist/tests/*.test.js` paths (`package.json` `coverage` script), but the actual build produces 131 compiled test files under `dist/tests/`. Real current line/branch coverage for core is **NOT VERIFIED** as a result — the tooling that's supposed to report it doesn't run.
*Impact: Medium (you can't manage what you can't measure — the `c8` config in `package.json` sets a 60% floor, but nothing is currently checking it). Effort: Quick win (regenerate the hardcoded test-file list from a glob, or switch to `--test dist/tests/**/*.test.js`). Suitable for: v1.0.x.*

**[LOW-MEDIUM] No concurrency/race-condition tests for shared-state components** (connection pools, caches) beyond what the fuzz harness incidentally covers. Not urgent given the pools already have documented dead-connection-detection and pending-creation-counter logic (per `CHANGELOG.md` `[1.0.2]` entry), but a dedicated concurrent-acquire stress test would catch regressions in that logic specifically.
*Impact: Low-Medium. Effort: Medium. Suitable for: v1.1.*

### 4. Architecture & API consistency

**[MEDIUM] Duplicated TLS/connection-option boilerplate across plugins, no shared base type.**
Verified: `plugin-redis/src/index.ts:31-35`, `plugin-mongodb/src/index.ts:46-50`
independently declare an identical `tlsRejectUnauthorized?/tlsServerName?/tlsCa?`
field set plus near-identical validation logic (`plugin-redis/src/index.ts:96-99`
vs `plugin-mongodb/src/index.ts:93-96`). The investigating sub-agent additionally
found the same pattern in `plugin-nats`, `plugin-rabbitmq`, `plugin-kafka` (not
independently re-verified line-by-line by me, but the redis/mongodb pair alone
is sufficient confirmation of the pattern). No shared `TlsOptions`/`BaseConnectionOptions`
type exists in `streetjs` core for plugins to extend (confirmed: zero matches
repo-wide), even though core uses interface-extension for pooling elsewhere
(`pool.ts:9`, `mysql/pool.ts:10`) — the fix pattern exists, just wasn't applied
to the additive TLS work.
*Impact: Medium (every future protocol plugin will keep copy-pasting this,
compounding the debt). Effort: Medium (extract a shared type + validator into
`streetjs`, migrate 5 plugins — mostly mechanical, 1-2 days, needs
backward-compat care since these are published packages). Suitable for: v1.1.*

**[LOW] Two dead public abstractions with zero real consumers.**
`CommandBus`/`QueryBus`/`SagaOrchestrator` (CQRS/Saga, `core/src/microservices`)
and the top-level `CircuitBreaker` in core are exported publicly but have zero
consumers anywhere in the other 53 packages or docs (confirmed via repo-wide
grep excluding their own test files). This is exactly the "abstraction with one
implementation" smell the audit was asked to look for — except here it's
"abstraction with zero real usage," which is worse: it's public API surface
StreetJS has to maintain compatibility for, with no evidence anyone depends on
it.
*Impact: Low now, but grows (every unused export is a future breaking-change
liability). Effort: Quick win to flag as deprecated in v1.1 docs; Medium to
actually remove in v2.0 (breaking change, needs a deprecation cycle).
Suitable for: deprecate in v1.1, remove in v2.0.*

**[VERIFIED CLEAN] No circular dependencies, no plugin/framework layering violations, no material API inconsistency across the DB or payment/messaging plugin families** (lifecycle naming, error types, and config field naming were checked pairwise and found consistent).

### 5. Ecosystem & DX

**[VERIFIED PRESENT — no gap] OpenTelemetry, Docker, Kubernetes/Helm are real, not just claimed.**
- OTEL: `packages/core/src/observability/otel.ts` implements span lifecycle, W3C traceparent, OTLP HTTP export; wired via `OTEL_EXPORTER_OTLP_ENDPOINT` in `main.ts:104-107`.
- Docker: every scaffolded project gets a real Dockerfile (`cli/src/commands/create.ts:4390-4396`).
- Helm: `infra/helm/street/` has a standard installable chart shape (`Chart.yaml`, `values.yaml`, `templates/{deployment,service,hpa}.yaml`).
- Plus on-demand manifest generation: `street deploy:init --platform kubernetes|cloudrun|ecs|nomad`.

**[MEDIUM] No PaaS one-click deploy targets (Vercel/Railway/Fly.io/Render).**
`street deploy:init` only covers `kubernetes|cloudrun|ecs|nomad` — all
container-orchestration targets. For the large segment of Node developers who
reach for a PaaS before Kubernetes, there's nothing. This is a real adoption
gap: it's a common "how do I actually put this online" first question for a
new framework's early adopters.
*Impact: Medium-High for adoption (this is often the first thing a new user
tries after `create`). Effort: Medium (3-5 days for 2-3 platforms — mostly
config-file templating, similar shape to the existing `deploy:init`).
Suitable for: v1.1.*

**[CONFIRMED ABSENT] No VS Code extension, no Dev Containers config.**
Both confirmed via `file_search` returning zero results. A `.devcontainer/`
template shipped in generated projects would be a genuine quick win for
onboarding (zero-setup contribution/trial). A full VS Code extension
(snippets, decorator IntelliSense) is a much larger and more speculative
investment — not clearly justified by evidence of demand.
*Impact: Dev Containers: Medium (real onboarding value, low effort). VS Code extension: Low-Medium (large effort, unverified demand). Effort: Dev Containers Quick win (<1 day, template only); VS Code extension Large (>1 week). Suitable for: Dev Containers v1.1; VS Code extension not recommended until there's user demand signal.*

**[LOW] `docs/migration.md` doesn't cover porting from Express/NestJS/Fastify**, despite the root README claiming migration guides "from Express, NestJS, and Fastify" (per `CHANGELOG.md` `[1.0.8]`). The current file is a real, substantive (239-line) guide, but only for StreetJS-internal version-to-version migration, not framework-to-framework porting.
*Impact: Low-Medium (affects switcher adoption specifically, a narrower audience than new-project adoption). Effort: Medium (1-3 days per framework for a real before/after guide). Suitable for: v1.1.*

**[LOW] Zero architecture diagrams anywhere in the docs.** Confirmed via `grep_search "\`\`\`mermaid"` across all of `docs/*.md` — zero matches, including in the dedicated `docs/architecture-report.md` (85 lines, prose/tables only). For a 47-published-package framework, a single system diagram (request lifecycle, package dependency map, or subsystem overview) would meaningfully help newcomers orient faster than prose alone.
*Impact: Low-Medium. Effort: Quick win (1-2 mermaid diagrams, GitHub/just-the-docs both render Mermaid natively). Suitable for: v1.0.x doc improvement.*

### 6. Packaging

**[MEDIUM] `streetjs` core is ESM-only — no CJS consumers supported.**
Confirmed: 23-entry `exports` map in `packages/core/package.json`, every
condition is `browser`/`import`/`types`; zero `require` conditions anywhere
(grep-confirmed). This is an explicit, defensible design choice for a
"no legacy baggage" 1.0 framework, but it does mean any CJS-only consumer
(older tooling, some enterprise environments still on `require`) cannot adopt
StreetJS at all, not even partially. **This is a real but debatable tradeoff,
not obviously a bug** — flagging for a deliberate decision rather than
recommending a change.
*Impact: Medium (adoption ceiling in CJS-only shops). Effort: Large (dual
ESM/CJS build is a substantial build-tooling project, and interacts badly with
some of the Node-native APIs the framework already leans on). Suitable for:
v2.0 only if adoption data shows this is actually blocking real users —
not recommended speculatively.*

**[LOW] `packages/cli/package.json` has no `exports` field**, unlike `core` and the plugin packages, which all define one. Low material impact since CLI is consumed via `bin`, but it's a real convention inconsistency across the monorepo's packaging.
*Impact: Low. Effort: Quick win. Suitable for: v1.0.x cleanup.*

---

## Technical debt NOT worth fixing right now

- **Backoff-formula duplication across queue/gateway/workflow/webhook** — the investigating sub-agent found this is intentional per-package independence (each pillar owns its retry semantics deliberately), not accidental duplication. Consolidating would add a shared-dependency coupling risk for marginal benefit. Leave as-is.
- **`dating-*`/`social-*` package "duplication"** — directly compared all 8 packages' `index.ts` files (2,381 lines total): the domain logic is genuinely separate (distinct algorithms per package), not copy-paste. Only a thin `InMemoryStore` scaffolding pattern repeats — worth extracting as a shared test-utility, not worth merging the packages themselves.
- **Stricter TypeScript compiler options** — not evaluated further since the audit brief explicitly excludes recommending these without measurable value, and no evidence of type-safety bugs traceable to current compiler settings was found during this pass.
- **CJS dual-build** — see Packaging above; a large, speculative investment not justified without adoption evidence that it's actually blocking users.
- **Router radix-tree rewrite** — real only at route counts (1000+) most apps won't hit; premature at current evidence.

---

## Top 25 highest-value improvements (prioritized)

| # | Item | Impact | Effort | v-target |
|---|---|---|---|---|
| 1 | Fix path traversal in `LocalStorageDriver` (port `resolveContained`) | Critical | Quick win | v1.0.x |
| 2 | Fix/clarify the misleading 64MB benchmark number (methodology fix) | High | Quick win | v1.0.x |
| 3 | Fix `packages/core`'s broken `coverage` script | Medium | Quick win | v1.0.x |
| 4 | Add tests to `plugin-stripe` (payments, zero coverage today) | High | Medium | v1.0.x/v1.1 |
| 5 | Add tests to `plugin-auth0`, `plugin-twilio` (auth/2FA, zero coverage) | High | Medium | v1.0.x/v1.1 |
| 6 | Add tests to `plugin-r2`, `plugin-s3`, `plugin-sendgrid` (zero coverage) | Medium | Medium | v1.1 |
| 7 | Add prototype-pollution guard to `http/server.ts:186` JSON body parse | Medium | Quick win | v1.0.x |
| 8 | Fix O(n²) buffer handling in Postgres wire client (`wire.ts:500`) | High | Medium | v1.1 |
| 9 | Fix O(n²) buffer handling in Redis RESP parser (`resp.ts:28`) | High | Medium | v1.1 |
| 10 | Add p95/p99 latency budget assertions to `load-testing.test.ts` | Medium | Quick win | v1.1 |
| 11 | Fix storage upload streaming regression when validation is configured | Medium-High | Medium | v1.1 |
| 12 | Extract shared `TlsOptions`/`BaseConnectionOptions` type for plugins | Medium | Medium | v1.1 |
| 13 | Add a `.devcontainer/` template to generated projects | Medium | Quick win | v1.1 |
| 14 | Add PaaS deploy targets (Vercel/Railway/Fly.io) to `deploy:init` | Medium-High | Medium | v1.1 |
| 15 | Add 1-2 real Mermaid architecture diagrams to the docs | Low-Medium | Quick win | v1.0.x |
| 16 | Write a real Express/NestJS/Fastify porting guide | Low-Medium | Medium | v1.1 |
| 17 | Add `exports` field to `packages/cli/package.json` | Low | Quick win | v1.0.x |
| 18 | Deprecate `CommandBus`/`QueryBus`/`SagaOrchestrator` (zero consumers) | Low | Quick win (docs) | v1.1 |
| 19 | Deprecate top-level `CircuitBreaker` (zero consumers) | Low | Quick win (docs) | v1.1 |
| 20 | Remove deprecated CQRS/Saga/CircuitBreaker exports | Low | Medium (breaking) | v2.0 |
| 21 | Evaluate lazy-loading heavy subsystems behind existing `exports` subpaths | High (perception) | Medium | v1.1 |
| 22 | Add concurrent-acquire stress test for connection pools | Low-Medium | Medium | v1.1 |
| 23 | Reconcile `plugin-redis` custom RESP2 impl vs wrapping core's `RedisClient` | Low | Medium | v1.1/v2.0 |
| 24 | Consider CJS dual-build only if adoption data shows it's blocking users | Medium (conditional) | Large | v2.0 (conditional) |
| 25 | Router radix-tree rewrite only if real apps exceed ~1000 routes | Low (conditional) | Large | v2.0 (conditional) |

## By effort bucket

**Quick wins (<1 day):** #1, #2, #3, #7, #10, #13, #15, #17, #18, #19
**Medium projects (1-5 days):** #4, #5, #6, #8, #9, #11, #12, #14, #16, #21, #22, #23
**Large initiatives (>1 week):** #20, #24, #25

## Long-term roadmap recommendation

- **v1.0.x (patch, ship soon):** #1, #2, #3, #7, #15, #17 — all quick, all either
  a real security fix or a credibility/measurement fix. None are breaking.
- **v1.1 (next minor):** #4-6 (plugin test debt), #8-9 (wire-protocol perf),
  #10-14, #16, #21-23 — this is the bulk of real engineering value: closes the
  testing gap on money/auth-handling plugins, fixes the two genuine
  performance cliffs, and closes the PaaS/devcontainer adoption gaps.
- **v2.0 (next major, only with evidence):** #20 (remove deprecated dead
  abstractions — needs the v1.1 deprecation cycle first), #24 (CJS dual-build,
  conditional on real demand data), #25 (router rewrite, conditional on real
  route-count data). Do not schedule these without adoption/usage evidence —
  per the audit brief, prefer evidence-backed over speculative.

---

## Evidence notes / what could not be verified

- Real current test coverage % for `packages/core` — **NOT VERIFIED** (the coverage script itself is broken, see finding above).
- Whether the storage path-traversal finding is reachable from an actual deployed StreetJS app's HTTP surface (vs. only via direct SDK misuse) — **NOT VERIFIED**; the driver-level gap is real regardless of the exact exploitation path.
- Exact published npm tarball size/file count for `@streetjs/cli` — the local `npm pack --dry-run` result reflected an unbuilt `dist/` in this checkout, not necessarily the real registry artifact — **NOT VERIFIED against the registry**.
- Whether the "30 of 54 packages have zero tests" figure from an earlier investigation pass was correct — **checked directly and found incorrect**; the real number, verified in this pass with a broader test-file glob, is 7 packages (of which 1, `core-compat`, is a low-risk pure re-export shim).
