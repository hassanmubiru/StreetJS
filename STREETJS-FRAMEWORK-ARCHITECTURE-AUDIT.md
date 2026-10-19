# StreetJS Framework Architecture Audit

**Audit date:** 2026-10-19  
**Repository:** `streetJS`  
**Scope:** StreetJS only. StreetStudio is not an architecture target and is mentioned nowhere in the design recommendations.

## Method and evidence boundary

This audit is based on the repository as it exists, not on package names or README claims alone. The review covered:

- the root manifest and lockfile;
- all `packages/*/package.json` manifests and package directories;
- package exports, TypeScript/build configuration, source, tests, generated `dist`, and representative READMEs;
- root architecture/contribution documentation, RFCs, changelog, examples, CI workflows, Docker/release configuration, and publishing scripts;
- runtime source for routing, client authentication, configuration, DI, errors, security, plugins, queues, workflows, events, and observability;
- executable checks for the client and router packages.

The repository contains **99 package directories** under `packages/*`. All are currently publishable according to their manifests; this does not mean all have the same maturity or should be learned by application developers.

### Checks executed during the audit

```text
npm test --workspace @streetjs/client       # 31 passed, 0 failed
npm run lint -w packages/client             # passed
npm test -w packages/router                 # 21 passed, 0 failed
npm run lint -w packages/router             # passed
npm test                                    # failed: packages/core/dist/tests/integration.test.js is missing
git diff --check                             # passed
```

The root test failure is a real repository contract problem: the default command points at a generated integration artifact that is absent in the checked-out tree. It is not reported as a framework test pass.

---

## 1. Executive summary

StreetJS is an ambitious TypeScript backend framework with a strong low-level foundation: a Node-native HTTP runtime, compiled routing, DI, configuration, security primitives, database clients, queues, workflows, realtime, observability, a CLI, and a signed plugin ecosystem. The package count is not itself the architectural defect. The repository already expresses a plausible one-framework model through `streetjs` as the consumer entry point and specialized packages as optional capabilities.

The principal problem is that the repository's **implementation maturity is ahead of its framework contract**. Many capabilities exist, but the rules that make them feel like one framework are incomplete or inconsistent:

1. Route trailing-slash semantics are strict in the core router but not defined consistently across router layers and gateway matching.
2. `@streetjs/client` intentionally does not store tokens, but login, refresh, logout state, and token lifecycle are not defined as a portable contract.
3. Plugin event registrations are not uniformly owned and disposed during unload.
4. The DI container is process-global, has no scopes, and discards instances without disposal.
5. JWT claim types are trusted at compile time without equivalent runtime shape validation.
6. Capability packages sometimes depend on the broad `streetjs` facade, weakening dependency direction.
7. Root build/test commands do not represent the whole workspace; the default root test is currently broken.
8. Reproducibility and release metadata are inconsistent: no root runtime pin, no root Makefile/Dockerfile contract, stale package counts, and conflicting Node version claims.

The right response is **not** to merge 99 packages into one implementation package. StreetJS should retain modular internals while introducing a smaller set of canonical framework contracts: application-scoped lifecycle, resource ownership, path normalization, structured errors, configuration, and public facade boundaries.

### Overall status

| Area | Status | Meaning |
|---|---|---|
| Core HTTP/runtime | PARTIAL | Real implementation exists, but cross-layer contracts are incomplete. |
| Routing | PARTIAL | Core routes intentionally omit trailing slashes; equivalent request behavior is undefined/inconsistent. |
| Client token acquisition | VERIFIED | `getToken()` is awaited per request and attached as a bearer header. |
| Client token storage | MISSING by design | No persistence is performed; this is a boundary, not an accidental write bug. |
| Client refresh lifecycle | MISSING | No refresh/retry/single-flight contract exists. |
| Configuration | VERIFIED | Precedence, validation, immutability, reload, and redaction are well covered. |
| DI | PARTIAL | Resolution works, but global state, scopes, and disposal are missing. |
| Plugin lifecycle | PARTIAL | Dependency ordering and middleware cleanup exist; event/resource cleanup is incomplete. |
| Security/JWT | PARTIAL | Strong algorithm/signature checks, incomplete runtime claim validation. |
| Queues/workflows | VERIFIED with caveats | Bounded shutdown and timeout behavior exist; lifecycle state/failure signaling is incomplete. |
| Observability | PARTIAL | Several good implementations, no single framework-wide registration contract. |
| Testing | PARTIAL | Many meaningful package tests, but stale-dist risk, skipped integrations, and broken root default. |
| Reproducibility | PARTIAL | Lockfile and CI exist; runtime/build/test contract is not unified at root. |

---

## 2. Framework identity

### What StreetJS is today

StreetJS is a **Node.js/TypeScript application framework** rather than merely a router or a package collection. Its strongest identity claims are:

- Node-native runtime and minimal third-party dependency surface;
- a single application runtime in `streetjs`;
- typed first-party modules for data, security, messaging, jobs, realtime, and observability;
- signed plugins for external providers;
- a CLI that scaffolds and operates applications.

That identity is supported by the minimal application example in the root README, the lockstep `streetjs`/CLI/core-compat release line, and the core exports.

### Target identity

StreetJS should present as:

> **One application framework with a small public vocabulary and modular capability packages.**

Application developers should primarily learn:

1. `streetjs` application bootstrap and HTTP APIs;
2. the application/module lifecycle;
3. configuration and dependency injection;
4. the canonical error and request-context model;
5. optional capability modules (`@streetjs/queue`, `@streetjs/storage`, `@streetjs/workflow`, etc.);
6. the CLI workflow.

They should not need to understand the difference between several competing lifecycle, error, provider, or observability conventions.

### Public surface rule

- `streetjs` is the default application-facing facade.
- Domain/capability packages are public when they provide a complete, independently useful capability.
- Low-level implementation packages remain public only where direct use is an intentional extension point.
- Plugin SDK types and foundation contracts are public; internal host details are not.
- UI adapters and vendor integrations are optional ecosystems, not part of the core framework vocabulary.
- The deprecated `@streetjs/core` shim remains compatibility-only and should not influence new API design.

---

## 3. Complete package inventory

The following inventory covers all 99 `packages/*` manifests. “Public” reflects current package metadata; “recommendation” is the architectural role, not an immediate deletion instruction.

### Core runtime and platform capabilities

| Package | Purpose | Layer/status | Dependencies/API evidence | Tests | Recommendation |
|---|---|---|---|---|---|
| `core` / `streetjs` | Application runtime, HTTP, DI integration, DB/security/realtime exports | Core runtime / public | Broad explicit subpath exports; typed ESM | Extensive, but root default artifact missing | KEEP as facade; narrow internals over time |
| `core-compat` / `@streetjs/core` | Deprecated re-export shim | Compatibility / public-deprecated | Generated compatibility surface | No own test script | DEPRECATE; keep until planned 2.0 removal |
| `container` | Dependency injection container | Runtime foundation / public | Typed API | Tests/coverage | REFACTOR to application-scoped, token-aware container |
| `context` | Request/application context | Runtime foundation / public | Typed API | Tests/coverage | KEEP; make canonical context contract |
| `exceptions` | Typed HTTP/framework exceptions | Runtime foundation / public | Typed API | Tests/coverage | PROMOTE as shared error contract |
| `config` | Configuration providers, merge, validation, reload | Runtime foundation / public | Typed API | Strong tests/coverage | KEEP as canonical configuration |
| `router` | Compiled HTTP router and middleware | Web / public | Typed API | 21 tests passed | REFACTOR around one path policy |
| `gateway` | Gateway routing, policies, retries, circuit breaking | Web/infrastructure / public | Separate router semantics | Strong suite | ADAPT to shared routing/error contracts |
| `websocket` | WebSocket/SSE/channel foundation | Web / public | Typed API | Tests/coverage | KEEP; align lifecycle and context |
| `multipart` | Streaming multipart parsing | Web / public | Typed API | Tests/coverage | KEEP |
| `http-client` | Outbound fetch client, retries, interceptors | Infrastructure / public | Typed API | Tests/coverage | KEEP; align errors/cancellation |
| `edge` | Edge/serverless runtime surface | Runtime adapter / public | Typed API | Tests | KEEP as adapter; document limitations |
| `cluster` | Cluster coordination/runtime support | Runtime infrastructure / public | Typed API | Tests/coverage | KEEP optional |
| `diagnostics` | Runtime inspection/diagnostics | Tooling/runtime / public | Typed API | Tests/coverage | KEEP; integrate with `street doctor` |
| `testing` | Spies, clocks, deferreds, fetch mocks | Developer tooling / public | Typed API | Tests/coverage | KEEP as canonical test primitives |
| `devtools` | Developer diagnostics/tooling | Developer tooling / public | Typed API | Tests | KEEP; avoid overlap with diagnostics |

### Data and persistence

| Package | Purpose | Layer/status | Dependencies/API evidence | Tests | Recommendation |
|---|---|---|---|---|---|
| `database` | Composed database abstraction | Data / public | Typed API | Tests/coverage | KEEP as data facade |
| `postgres` | Native PostgreSQL wire client | Data adapter / public | Typed API | Tests/coverage | KEEP as low-level adapter |
| `pool` | Bounded pool/transactions/health | Data infrastructure / public | Typed API | Tests/coverage | KEEP; adopt lifecycle contract |
| `repository` | Typed PostgreSQL CRUD repository | Data module / public | Typed API | Tests/coverage | KEEP; clarify ORM/repository boundary |
| `migrations` | SQL migrations/schema diff | Data tooling / public | Typed API | Tests/coverage | KEEP; align CLI |
| `schema-inspector` | Multi-database schema inspection | Data tooling / public | Typed API | Tests/coverage | KEEP optional |
| `orm` | Entity/relation ORM/query planner | Data module / experimental | 0.x API | Tests/coverage | KEEP experimental; do not duplicate repository contract |
| `cache` | In-memory cache primitives | Infrastructure / public | Typed API | Tests/coverage | KEEP; define scope/eviction contract |
| `store` | Key-value/counter/rate-limit stores | Infrastructure / public | Typed API | Tests/coverage | KEEP as narrow storage protocol |
| `storage` | Object storage abstraction/drivers | Infrastructure / public | Many subpaths | Large suite | KEEP; depend on narrow foundation |

### Security, identity, and application infrastructure

| Package | Purpose | Layer/status | Dependencies/API evidence | Tests | Recommendation |
|---|---|---|---|---|---|
| `security` | JWT, AES-GCM, encryption | Security / public | Typed API | Strong tests/coverage | KEEP; add runtime claim validation |
| `session` | Encrypted stateless sessions/CSRF | Security / public | Typed API | Tests/coverage | KEEP; align error envelope |
| `xss` | Sanitization/escaping | Security / public | Typed API | Tests/coverage | KEEP |
| `ratelimit` | Sliding-window limiter/middleware | Security / public | Typed API | Tests/coverage | KEEP; align store contract |
| `webhooks` | Signed webhook delivery/verification | Infrastructure/security / public | Typed API | Tests/coverage | KEEP |
| `webhook-dispatcher` | SSRF-hardened outbound webhook queue | Infrastructure/security / public | Typed API | Tests/coverage | KEEP; lifecycle contract |
| `events` | Event bus/pub-sub | Infrastructure / public | Observability hooks | Large suite | KEEP; distinguish business events from telemetry |
| `queue` | Jobs, retries, scheduling, DLQ | Infrastructure / public | Redis subpaths | Large suite | KEEP; explicit lifecycle state |
| `workflow` | Durable orchestration | Infrastructure / public | Redis/testing subpaths | Large suite | KEEP; use shared lifecycle/errors |
| `realtime` | Rooms/presence/broadcast | Infrastructure / public | Redis subpaths | Large suite | KEEP; narrow facade dependency |
| `notifications` | Channel-agnostic notification dispatch | Infrastructure / public | Typed API | Tests/coverage | KEEP |
| `i18n` | Catalogs/locale/Intl formatting | Application module / public | Typed API | Tests/coverage | KEEP optional |
| `flags` | Feature flags/evaluation | Application infrastructure / public | Typed API | Tests/coverage | KEEP optional |
| `media` | FFmpeg/FFprobe abstraction | Integration/infrastructure / public | Typed API | Tests/coverage | KEEP optional; document external binary requirements |

### Observability

| Package | Purpose | Layer/status | Dependencies/API evidence | Tests | Recommendation |
|---|---|---|---|---|---|
| `logging` | Structured logs/redaction/transports | Observability / public | Typed API | Tests/coverage | KEEP as canonical logging API |
| `metrics` | Prometheus counters/gauges/histograms | Observability / public | Typed API | Tests/coverage | KEEP |
| `telemetry` | In-process bounded metrics/latency | Observability / public | Typed API | Tests/coverage | REFACTOR overlap with metrics; define roles |
| `tracing` | Trace propagation/exporters | Observability / public | Typed API | Tests/coverage | KEEP |
| `health` | Liveness/readiness/startup registry | Operations / public | Typed API | Tests/coverage | KEEP; integrate lifecycle |

### Domain modules

| Package | Purpose | Layer/status | Recommendation |
|---|---|---|---|
| `admin` | Admin/domain backend capabilities | Domain / public optional | KEEP optional; not core vocabulary |
| `ai` | Provider-neutral AI primitives | Domain / public optional | KEEP optional |
| `ai-router` | AI routing over `ai` | Domain / public optional | KEEP; clarify boundary |
| `commerce` | Payments/orders/subscriptions | Domain / public optional | KEEP optional |
| `search` | Provider-based search | Domain / public optional | KEEP optional |
| `dating-auth` | Dating authentication | Product domain / public | KEEP only as domain package; not core |
| `dating-messaging` | Dating messaging | Product domain / public | KEEP optional; mark domain-specific |
| `dating-moderation` | Dating moderation | Product domain / public | KEEP optional; mark domain-specific |
| `dating-profiles` | Dating profiles | Product domain / public | KEEP optional; mark domain-specific |
| `social-comments` | Comments/reactions/mentions | Product domain / public | KEEP optional |
| `social-feed` | Posts/timelines | Product domain / public | KEEP optional |
| `social-notifications` | Social notifications | Product domain / public | KEEP optional |
| `social-users` | Follow graph/relationships | Product domain / public | KEEP optional |

### Integrations and adapters

| Package | Purpose | Layer/status | Recommendation |
|---|---|---|---|
| `integrations` | Shared connector/webhook foundation | Integration foundation / public | KEEP; narrow contracts |
| `slack`, `github`, `gitlab`, `jira`, `linear`, `notion`, `discord`, `teams` | Vendor API/webhook connectors | Integrations / public optional | KEEP as independent adapters |
| `client` | Framework-neutral HTTP/WS SDK | Client tooling / public | KEEP; document no storage and lifecycle gap |
| `client-offline` | Offline cache/mutation primitives | Client tooling / public | KEEP separate from auth storage |
| `react`, `vue`, `next`, `nuxt` | Frontend framework adapters | UI adapters / public optional | KEEP; not core runtime |
| `auth-ui`, `ai-ui`, `admin-ui` | UI components | UI/product adapters / public optional | KEEP optional; not core |
| `registry-server` | Plugin registry API | Developer/infrastructure / public | KEEP; separate operational product surface |

### Official plugins (21)

| Group | Packages | Classification | Recommendation |
|---|---|---|---|
| Databases | `plugin-postgres`, `plugin-mysql`, `plugin-mongodb` | Provider adapters | KEEP; signed plugin contract |
| Messaging/cache | `plugin-redis`, `plugin-kafka`, `plugin-nats`, `plugin-rabbitmq` | Provider adapters | KEEP; signed plugin contract |
| Storage | `plugin-s3`, `plugin-r2` | Provider adapters | KEEP |
| Identity | `plugin-auth0`, `plugin-clerk`, `plugin-firebase`, `plugin-supabase` | Provider adapters | KEEP |
| Payments | `plugin-stripe`, `plugin-paypal`, `plugin-marzpay` | Provider adapters | KEEP |
| Communications | `plugin-twilio`, `plugin-sendgrid`, `plugin-africastalking` | Provider adapters | KEEP |
| AI/UI | `plugin-openai`, `plugin-htmx` | Provider/view adapters | KEEP; clarify `htmx` classification |

All 21 plugin directories have plugin-oriented manifests and signed-manifest flows. They are not a reason to merge vendor integrations into the core runtime.

---

## 4. Capability map and maturity

| Capability | Evidence | Status | Contract gap |
|---|---|---|---|
| Application bootstrap | `streetApp`, CLI scaffolding, core runtime | PARTIAL | Bootstrap/lifecycle is spread across runtime and operational helpers. |
| HTTP server/context | `packages/core/src/http`, context package | PARTIAL | Strong implementation; shutdown/readiness semantics need one contract. |
| Routing | core router, `@streetjs/router`, gateway | PARTIAL | Trailing slash and cross-router semantics are undefined. |
| Middleware | core/router/plugin host | PARTIAL | Plugin-added middleware cleanup exists; all resource types lack ownership. |
| Validation/serialization | Zod and router/core paths | PARTIAL | No single framework-wide boundary/error envelope. |
| Dependency injection | container/core integration | PARTIAL | Global singleton, no scopes, no disposal. |
| Module/plugin system | plugin host/SDK, signed manifests | PARTIAL | Dependency/order checks are good; disposer ownership incomplete. |
| Configuration | `@streetjs/config` | VERIFIED | Empty-prefix strict mode needs a documented policy. |
| Errors | exceptions, router, workflow, client | PARTIAL | Multiple envelopes and class-based detection. |
| Database/transactions | database/postgres/pool/repository/migrations/ORM | PARTIAL | Several valid layers; boundaries and lifecycle need explicit canonical path. |
| Cache/store | cache/store/rate limit/plugins | PARTIAL | Scope, persistence, and provider semantics vary. |
| Jobs/queues | queue | VERIFIED with caveats | Start failure and dispatch-after-close behavior need explicit results. |
| Workflows | workflow | VERIFIED with caveats | Plugin bridge cleanup good; shared lifecycle contract absent. |
| Events | events/core plugin events | PARTIAL | Business and telemetry events are not clearly separated; listener teardown gap. |
| Realtime | realtime/websocket/client | PARTIAL | URL semantics are tested in client, server policy is not shared. |
| Auth/sessions | security/session/plugins | PARTIAL | Server primitives exist; client token lifecycle lacks refresh/storage contract. |
| Authorization | router/RBAC/security | PARTIAL | Multiple policy surfaces need canonical authorization context. |
| Webhooks | webhooks/dispatcher/plugins | VERIFIED with caveats | Security foundation strong; lifecycle alignment needed. |
| Observability | logging/metrics/telemetry/tracing/health/diagnostics | PARTIAL | Good modules, overlapping metric concepts and registration APIs. |
| CLI/DX | `@streetjs/cli`, examples/docs | PARTIAL | Commands exist, but root package/test/build contracts are misleading. |
| Testing | package suites, system/integration suites | PARTIAL | Root default broken; many tests run against checked-in/stale dist or skip external services. |
| Operations | Docker, CI, health, shutdown helpers | PARTIAL | No single reproducible root contract; builder/runtime Node mismatch. |

---

## 5. Runtime contract and behavioral audit

This section records behavior verified from source/tests rather than inferred from declarations.

### 5.1 Routing and trailing slashes — PARTIAL / UNDEFINED cross-layer policy

The core HTTP path parser preserves the incoming pathname. Controller registration normalizes registered paths and removes a trailing slash. The compiled core router uses anchored matching. Consequently, a route registered as `/users` matches `/users` but not `/users/`.

The gateway router has different matching categories: static routes are exact, prefix routes accept descendants with a slash boundary, and wildcard routes require a remaining segment. Existing tests do not establish one policy across core HTTP, the standalone router, gateway, mounted routers, middleware, or generated API documentation.

**Current contract:** core route definitions are canonicalized to no trailing slash; incoming paths are not canonicalized. `/users` and `/users/` are distinct in core.  
**Status:** PARTIAL.  
**Impact:** equivalent URLs can produce different results depending on the routing layer.

The framework must choose and document one policy before changing behavior. The least surprising framework contract is usually one of:

- strict canonical paths: only `/users` matches and `/users/` is a 404;
- equivalent paths: normalize once at the HTTP boundary, before matching;
- redirect: issue a 308 from non-canonical to canonical paths.

Whichever is selected must cover `/`, static paths, parameters, nested paths, wildcards, mounted routers, query strings, encoded segments, and gateway matching.

### 5.2 Client URL behavior — VERIFIED

`@streetjs/client` removes all trailing slashes from the base URL, adds exactly one separator, and performs the same normalization for realtime URL construction. Tests cover ordinary cases, multiple slashes, relative browser bases, and a 100,000-slash input. This is a client URL-joining contract and does not define server route matching.

### 5.3 Client authentication lifecycle — PARTIAL

`StreetClientConfig.getToken` is a synchronous or asynchronous callback. It is awaited for every request and, when truthy, becomes an `Authorization: Bearer ...` header. The client does not use `localStorage`, `sessionStorage`, cookies, IndexedDB, or another token store. The new regression test explicitly verifies that no browser storage writes occur.

This is a valid security boundary, not a defect. However:

- `auth.login()` only sends credentials and returns the response;
- no token is installed into client state;
- no refresh method or refresh-token rotation contract exists;
- no 401 retry or single-flight refresh exists;
- logout does not clear application-owned token state;
- token provider failure is not mapped to a framework-wide error code.

**Status:** acquisition VERIFIED; storage MISSING by design; refresh MISSING; complete auth lifecycle PARTIAL.

The correct extension is an opt-in, platform-neutral auth adapter, not implicit browser storage in the base client. It should define `TokenStore`, refresh triggers, retry limits, single-flight refresh, replay/idempotency rules, and logout clearing behavior.

### 5.4 URL encoding, query, and request behavior — PARTIAL

Resource identifiers are `encodeURIComponent`-encoded. Query values use `URLSearchParams`, skipping null/undefined. Request bodies are JSON except raw `BodyInit` values. These paths have useful unit coverage. A framework-wide contract is still needed for repeated query keys, arrays, malformed encodings, raw body content types, and cancellation/timeouts.

### 5.5 Lifecycle and resource management — PARTIAL / HIGH RISK

Positive evidence exists: queue workers stop polling and await in-flight work; queue facades close worker/scheduler/driver in order; workflow plugin unload detaches bridges and closes the engine; core shutdown closes the HTTP app and configured closeables.

The plugin path is incomplete. `SandboxedApp.on()` registers handlers on a shared event emitter, but the unload path does not retain and invoke disposers for those handlers. Reloading a plugin can therefore duplicate callbacks and retain plugin closures. Middleware cleanup is more deliberate than event, timer, health, metric, or socket cleanup.

**Required contract:** every framework-owned resource registration returns or records a disposer, and an application/plugin scope closes resources deterministically before unload/shutdown. Startup failure, shutdown failure, cancellation, and close races need explicit semantics.

### 5.6 Configuration — VERIFIED with one caveat

`@streetjs/config` implements provider precedence, deep merge, schema validation, immutable defaults, atomic reload after validation, and secret masking. The caveat is that an empty environment prefix maps all process environment variables; strict mode can then fail on unrelated variables. Production guidance should require or strongly recommend an explicit prefix.

### 5.7 Errors and diagnostics — PARTIAL

HTTP exceptions, client errors, and workflow errors are each useful locally, but they do not share one serializable error envelope or stable code taxonomy. `isStreetException()` relies on `instanceof`, which is fragile across package duplication, worker boundaries, and realms. Unknown router errors are masked, but the mapping policy is not shared by all packages.

The framework needs a stable boundary shape such as:

```ts
interface StreetErrorEnvelope {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
  correlationId?: string;
}
```

### 5.8 Security/JWT — PARTIAL

Algorithm enforcement, timing-safe signature comparison, expiry/`nbf`/`iat`, issuer, audience, malformed-token, and tampering checks are present and tested. However, parsed JSON is cast to `JwtPayload` without runtime validation. A correctly signed payload without a string `sub`, or with malformed claim types, can pass verification.

Required correction: validate `sub` as a non-empty string and validate optional numeric claims and string-array claims at runtime before returning an identity payload. This is a security boundary and should not rely on TypeScript types.

### 5.9 DI/container — PARTIAL / HIGH RISK

The container resolves constructor metadata and detects cycles, but it is process-global, retains singleton instances until `reset()`, accepts classes without enforcing `@Injectable()`, lacks token-based interface registration as a first-class API, and discards instances without disposal hooks.

The target is an application-scoped container with explicit tokens, singleton/request/transient scopes, deterministic disposal, and a compatibility path for legacy global calls.

### 5.10 Queue, workflow, events, observability — VERIFIED with caveats

Bounded worker concurrency, cooperative attempt timeouts, shutdown draining, and workflow engine closure are implemented. Queue driver readiness failures can stop a worker without an explicit failure result because startup is synchronous. Dispatch-after-close behavior is not a documented shared contract. Event listener errors are swallowed in telemetry-oriented paths; business-critical event handling needs a distinct policy.

### 5.11 Testing behavior — PARTIAL

Client/router/security/config tests exercise meaningful boundaries. However, many package tests execute checked-in `dist` output, which can become stale without a build gate. External-service tests skip when PostgreSQL/Redis/brokers are unavailable, so a green local run is not equivalent to integration verification. The root `npm test` covers only core and currently fails before executing the expected integration test.

---

## 6. Dependency architecture

### Current dependency shape

The repository uses npm workspaces, with `streetjs` as a broad facade over many first-party packages. This is convenient for consumers, but several capability packages import the umbrella package for shared public types/observability rather than narrow contracts. Examples include queue, events, workflow, and storage observability paths.

This is not necessarily an npm dependency cycle: core does not directly depend on every capability package. It is an **architectural direction problem** because high-level capabilities depend on a broad facade that also represents the application runtime.

### Target dependency direction

```text
Applications / CLI / adapters
              ↓
        streetjs facade
              ↓
       framework modules
              ↓
 foundation contracts + lifecycle + errors + context
              ↓
    platform abstractions and providers
              ↓
     Node.js / external services
```

Capability packages should depend on foundation contracts or narrow subpath exports, not on the whole `streetjs` facade, wherever practical. Vendor plugins depend on capability/provider contracts. UI packages depend on the client contract, not server internals.

### Duplication findings

| Concept | Observed duplication | Canonical direction | Action |
|---|---|---|---|
| Routing | core router, standalone router, gateway matcher | Core path policy + shared matching contract | REFACTOR adapters; do not merge blindly |
| Configuration | core conventions plus `@streetjs/config` | `@streetjs/config` | PROMOTE and remove alternate conventions |
| DI | core integration plus global container | Application-scoped container | REFACTOR with compatibility bridge |
| Errors | exceptions/client/workflow envelopes | Shared code + envelope at boundaries | UNIFY contract; preserve internal subclasses |
| Logging/metrics/telemetry | logging, metrics, telemetry, tracing, diagnostics | Distinct observability roles + shared registration handles | CLARIFY, not merge all |
| Storage | store/cache/object storage/database adapters | Separate key-value, cache, object, relational roles | KEEP; narrow interfaces |
| Plugins/providers | signed plugin host, provider-specific adapters, workflow bridge | One plugin scope/resource model | UNIFY lifecycle ownership |
| Auth | server JWT/session/auth plugins and client callback | Server identity primitives + opt-in client auth adapter | DEFINE contracts; do not add implicit storage |
| Retry | HTTP client/gateway/queue/workflow retries | Policy-specific retries over shared backoff/cancellation primitives | UNIFY primitives, preserve domain policies |

The evidence does not justify merging the packages solely to reduce count. It justifies canonical interfaces and dependency boundaries.

---

## 7. Public API rules

StreetJS should standardize the following rules:

### Naming and construction

- `createX` for configured factories that return usable instances.
- `X` classes only when identity/state/lifecycle is directly meaningful.
- `registerX` for application/module registration, returning a disposer where registration is reversible.
- `start`, `ready`, and `close` for long-lived resources; `close` is idempotent.
- `getX`/`setX` for storage contracts; no hidden persistence.
- Explicit `Provider`, `Adapter`, `Module`, and `Plugin` suffixes where the role matters.

### Async, cancellation, and cleanup

- I/O and lifecycle operations return promises.
- Long-lived operations accept `AbortSignal` where cancellation is meaningful.
- Timers, sockets, listeners, workers, and exporters are owned by an application/resource scope.
- Shutdown is idempotent and waits for accepted work or reports what was abandoned.

### Errors

- Every boundary has a stable error code and serializable envelope.
- `instanceof` may supplement but must not be the only type guard.
- Programmer/configuration/startup errors are distinct from operational/retryable errors.
- HTTP mapping belongs at the HTTP boundary, not in lower-level packages.

### Configuration

- One typed configuration model with explicit provider precedence.
- Secrets are never serialized or logged by default.
- Resolved configuration is immutable; reload is explicit and atomic.

---

## 8. Package architecture recommendations

### KEEP

Keep the package boundaries for core runtime, data adapters, security, queue/workflow/realtime/storage, observability, integrations, UI adapters, and signed vendor plugins. These boundaries represent different deployment/runtime concerns and support tree-shaking and optional dependencies.

### INTERNALIZE selectively

Over time, implementation-only packages that exist solely to support `streetjs` should be hidden behind documented exports or marked internal. Do not remove them until import usage and package consumers are measured. Candidates include low-level glue that has no stable extension contract.

### PROMOTE

Promote `@streetjs/config`, context, exceptions, lifecycle/resource ownership, and testing contracts as the framework's shared vocabulary. They should be the source of truth for other packages.

### REFACTOR

- router/gateway path semantics;
- DI scope/disposal;
- plugin resource ownership;
- JWT runtime claims;
- error envelope/type guards;
- umbrella facade imports from capabilities;
- root build/test/reproducibility commands.

### DEPRECATE

Keep `@streetjs/core` only as the documented compatibility shim. Do not add new APIs to it.

### DO NOT MERGE without evidence

Do not merge all observability packages, all data packages, all integrations, or all domain packages. Their separation is justified when the contract is explicit and dependency direction is clean.

---

## 9. Missing capabilities (evidence-based)

These are missing framework contracts, not necessarily missing code:

1. **Canonical trailing-slash policy** across core router, gateway, mounted routers, middleware, and generated documentation.
2. **Application-scoped lifecycle/resource registry** covering plugins, listeners, timers, sockets, workers, health checks, metrics, and exporters.
3. **Application-scoped DI with scopes and disposal.**
4. **Runtime JWT claim validation** matching the declared payload contract.
5. **Framework-wide error envelope and stable error codes.**
6. **Optional, portable client auth lifecycle adapter** for storage/refresh without implicit browser persistence.
7. **Root workspace verification contract** that builds the relevant packages before tests and distinguishes offline from external-service suites.
8. **Reproducible root runtime/build contract**: runtime pin, canonical Docker path, and one offline test command.
9. **Generated package/release metadata** so counts, plugin lists, exports, and supported Node versions do not drift.

Capabilities such as database access, queues, workflows, tracing, health checks, and CLI generation are not marked missing because substantial implementations exist. Their cross-package contracts are marked partial where evidence requires it.

---

## 10. Developer experience

### Current workflow

The CLI provides scaffolding and commands for development, building, generation, migration, diagnostics, and verification. The root README's minimal application is clear enough to demonstrate the core, and the package README set is broad.

The main DX problem is not absence of commands; it is **which command is authoritative**:

- root `npm run build` builds only core and CLI despite documentation saying “all packages”;
- root `npm test` runs only core and currently references a missing generated integration artifact;
- package tests often consume prebuilt `dist`;
- external-service tests and offline tests are not represented by one obvious root command;
- package counts and plugin counts are stale in the root README;
- Node support is documented as 20 in places while manifests/CI use 22/24.

### Canonical developer path to establish

```text
street create my-app
cd my-app
npm install
street dev
street generate <resource>
street test                 # offline contract tests by default
street test --integration   # explicit external services
street build
street start
street migrate
street doctor
```

The exact CLI names should be derived from existing commands; the important contract is that each maps to an executable, documented, reproducible action.

### DX acceptance criteria

- New application creation works on the pinned Node version without hidden global installs.
- A clean checkout can run the default offline test command without PostgreSQL, Redis, or a network fetch.
- Integration profiles fail loudly when a required service is unavailable; they do not silently imply coverage.
- Build commands state whether they build one package, the core line, or the whole workspace.
- Generated package metadata and docs are checked in or generated deterministically.

---

## 11. Production readiness

### Strengths verified

- CI includes security scanning, provenance-oriented publishing, CodeQL, dependency review, DAST, secret scanning, and runtime verification.
- Queue worker concurrency and shutdown behavior are bounded.
- JWT algorithm confusion defenses and cryptographic operations have meaningful tests.
- Configuration secrets are masked and resolved configuration can be immutable.
- Health, metrics, tracing, logging, diagnostics, and shutdown helpers exist as first-party capabilities.
- Signed plugin manifests and permission/dependency checks are implemented.

### Readiness gaps

| Area | Status | Evidence-based concern |
|---|---|---|
| Lifecycle | PARTIAL | Plugin listeners/resources can survive unload; DI has no disposal. |
| Routing | PARTIAL | Slash policy differs by router layer. |
| Authentication | PARTIAL | Server primitives strong; client refresh/storage contract absent. |
| Error handling | PARTIAL | No shared envelope/code/type guard. |
| Security claims | PARTIAL | JWT payload shape is not validated at runtime. |
| Build reproducibility | PARTIAL | No root runtime pin; Docker builder fetches WASM; root commands are narrow. |
| Test confidence | PARTIAL | Root default broken; stale `dist`; optional infrastructure suites may skip. |
| Release compatibility | PARTIAL | Lockstep core line exists, but package maturity/versioning is uneven and metadata drifts. |

StreetJS should not claim production readiness for a capability merely because its package has tests. A capability is production-ready only when its lifecycle, failure, cancellation, security, observability, compatibility, and deployment contracts are explicit and tested.

---

## 12. Versioning and releases

The repository has a useful lockstep core line: `streetjs`, `@streetjs/core`, and `@streetjs/cli` are released together. CI publishing is split across backend, frontend, and plugin workflows, with provenance and signature verification.

The release model needs a compatibility matrix:

| Line | Current role | Required policy |
|---|---|---|
| `streetjs` + CLI + compat shim | Framework core line | Lockstep major/minor compatibility; shim removal only in documented major. |
| Foundation/capability packages | Modular framework surface | Declare minimum compatible core line and peer/optional dependency rules. |
| `@streetjs/*` UI/client packages | Frontend adapters | Independent semver allowed, but publish compatibility matrix against client/core. |
| Official plugins | Provider adapters | Contract version in manifest; compatibility checked before load/publish. |
| Domain packages | Optional verticals | Independent semver; not part of core stability promises. |

### Release risks

- 99 public manifests make drift possible even with strong CI.
- Root docs claim 47 packages and 19 plugins while the repository has 99 and 21.
- Supported Node versions conflict across README, manifests, CI, and Docker stages.
- CLI is the main manifest outlier without an `exports` map.
- Checked-in generated `dist` increases stale-artifact risk.

### Recommendation

Retain split publishing but add generated release metadata and a compatibility gate that validates every package manifest, export, dependency range, plugin manifest, and supported runtime against one source of truth.

---

## 13. Architectural problems ranked by severity

### P0 — Framework-breaking

No P0 issue was established from repository evidence. The framework has a real runtime and extensive implementation. This is not a claim that every production path is safe.

### P1 — Major architectural issues

1. **Plugin resource leak on unload.** Event handlers registered through the plugin sandbox are not uniformly disposed. Reload can duplicate behavior and retain closures.
2. **Global DI container with no disposal/scopes.** Multiple applications in one process and tests can share state; resources can be discarded without cleanup.
3. **JWT runtime claim validation gap.** A signed but structurally invalid identity payload can pass verification.
4. **Broken default root test contract.** `npm test` fails before running the declared core integration artifact.

### P2 — Important improvements

1. Define a single trailing-slash policy across all routing layers.
2. Define optional client token storage/refresh as a separate portable auth adapter, while preserving the base client's no-storage boundary.
3. Introduce a shared error envelope and stable error codes.
4. Reduce capability-package imports from the broad `streetjs` facade.
5. Add root runtime pin, offline test command, and canonical Docker/build documentation.
6. Make package/export/plugin metadata generated and checked for drift.
7. Define lifecycle state/readiness and dispatch-after-close behavior for queue/workflow/event resources.

### P3 — Nice-to-have

1. Add approved exceptions metadata for package export conventions, including CLI.
2. Standardize minimum package documentation/changelog metadata.
3. Clarify `telemetry` versus `metrics` responsibilities without merging them.
4. Add more cross-layer contract tests for query arrays, encoded paths, and cancellation/timeouts.

---

## 14. Target architecture

```text
StreetJS application
├── streetjs facade
│   ├── Application bootstrap
│   ├── HTTP server/context
│   ├── canonical router + middleware
│   ├── module/plugin registration
│   └── lifecycle/resource scope
│
├── Framework foundation
│   ├── configuration
│   ├── application-scoped DI + scopes
│   ├── error codes/envelopes
│   ├── cancellation/clock/IDs
│   └── observability interfaces
│
├── Web and security
│   ├── routing/path policy
│   ├── validation/serialization
│   ├── authentication/authorization
│   ├── sessions/JWT/CSRF
│   └── WebSocket/SSE
│
├── Data
│   ├── database/pool/transactions
│   ├── repositories/ORM
│   ├── migrations/schema
│   ├── cache/key-value/object storage
│   └── provider adapters
│
├── Application infrastructure
│   ├── events
│   ├── queue/jobs
│   ├── workflows
│   ├── notifications/webhooks
│   └── realtime
│
├── Observability and operations
│   ├── logging/metrics/tracing
│   ├── health/readiness
│   ├── diagnostics
│   └── graceful shutdown
│
├── Developer experience
│   ├── CLI/scaffolding
│   ├── testing/contracts
│   ├── migrations/generation
│   └── build/deploy verification
│
└── Optional ecosystem
    ├── signed vendor plugins
    ├── client/frontend adapters
    ├── integrations
    └── domain modules
```

Dependency direction is downward. The facade composes modules; modules depend on foundation contracts; providers implement contracts. No lower-level capability should need the entire facade merely to access a shared type or metric.

---

## 15. Migration plan

The plan deliberately avoids a destabilizing package merge.

### Phase 0 — Make the current contract truthful

- Correct package/plugin counts and Node version docs.
- Add a runtime pin matching the selected supported baseline.
- Make root commands explicitly scoped or add a documented offline workspace command.
- Fix the root test artifact/build sequencing so `npm test` is meaningful.
- Add manifest/export/plugin drift checks.

### Phase 1 — Establish shared foundation contracts

- Add a lifecycle/resource registry contract with idempotent disposers.
- Add stable framework error codes/envelopes and branded type guards.
- Define application context ownership and cancellation primitives.
- Keep compatibility adapters for existing package-specific APIs.

### Phase 2 — Fix security and runtime boundaries

- Runtime-validate JWT claims.
- Make plugin event/listener/timer/health/metric registrations scope-owned.
- Make DI application-scoped with explicit tokens and disposal; retain a compatibility global only for legacy callers.

### Phase 3 — Unify behavior across layers

- Select and document trailing-slash policy.
- Add cross-layer route contract tests.
- Align gateway/core/router error and context behavior.
- Replace broad facade imports with foundation/narrow contract imports where measured safe.

### Phase 4 — Complete optional auth and operations contracts

- Add an opt-in client auth adapter for storage/refresh/single-flight/retry.
- Define queue/workflow readiness and close-state behavior.
- Separate offline contract tests from external integration profiles.
- Make Docker/build paths offline and runtime-version consistent.

Every phase should be released as small compatible changes where possible, with an ADR for behavior changes and a migration note for breaking changes.

---

## 16. Implementation roadmap

| Priority | Improvement | Affected packages | Evidence/acceptance |
|---|---|---|---|
| P1 | Plugin resource disposal | `core`, plugin SDK, events/health/metrics integration | Reload does not duplicate listeners; unload invokes every disposer exactly once. |
| P1 | Runtime JWT claim validation | `security` | Invalid signed claims reject with stable security error; existing valid tokens remain valid. |
| P1 | Application-scoped DI/disposal | `container`, `core`, context | Two apps are isolated; singleton/request/transient semantics and disposal are tested. |
| P1 | Root test/build contract | root scripts, core build/tests | Clean checkout has one truthful offline command and explicit integration command. |
| P2 | Routing path policy | `core`, `router`, `gateway`, docs | Static/param/prefix/wildcard/mounted routes agree on trailing slash behavior. |
| P2 | Error envelope | `exceptions`, `router`, `client`, workflow | Stable code/status/details/correlation mapping across boundaries. |
| P2 | Narrow dependency boundaries | capability packages, foundation exports | No unnecessary imports from broad facade; dependency graph check passes. |
| P2 | Reproducibility metadata | root, Docker, CI, docs | Pinned runtime, lockfile, offline build/test, documented deploy path. |
| P2 | Optional client auth adapter | `client`, new opt-in module if justified | Storage/refresh policy is explicit and platform-neutral; base client remains no-storage. |
| P3 | Generated metadata/docs | scripts/docs/workflows | Package/plugin counts and support matrix cannot drift silently. |

---

## 17. Acceptance criteria

### Framework-wide

- A new application can use `streetjs` without learning internal implementation packages.
- Every public capability has an explicit contract, canonical implementation, runtime tests, and documentation.
- Long-lived resources expose consistent start/readiness/close behavior and do not leak on unload.
- Errors have stable codes and boundary serialization.
- Configuration behavior is consistent and secrets are not exposed.
- Package dependency direction is checked automatically.

### Routing

- The selected trailing-slash policy is documented.
- Core, standalone router, gateway, mounted routers, middleware, and generated docs agree.
- Tests cover root/static/parameter/nested/wildcard/encoded/query paths.

### Client auth

- The base client explicitly does not persist tokens.
- `getToken` remains per-request and async-capable.
- Any storage/refresh adapter is opt-in, portable, tested for refresh storms, retry bounds, logout, cancellation, and non-idempotent replay.

### Security

- Signed JWTs with invalid claim shapes are rejected at runtime.
- Error details do not leak secrets or internal prompts/configuration.
- Security behavior is tested independently of TypeScript declarations.

### Reproducibility

- The supported Node/npm runtime is pinned.
- The lockfile is retained and clean-machine install works.
- One root offline test command works without external services.
- Docker build does not require an unrecorded network artifact fetch.
- Build/test commands do not rely on stale generated output without first verifying it.

### Release

- All published manifests pass export/types/files/engine checks.
- Core-line compatibility is explicit.
- Plugin manifest compatibility and signatures are verified before publish/load.
- Package counts, plugin counts, and runtime support docs are generated or checked for drift.

---

## Decision summary

StreetJS should **keep its modular package architecture** and improve the contracts between those packages. The highest-value work is not adding more feature packages. It is making existing behavior coherent: resource ownership, DI scope, runtime security validation, route semantics, error boundaries, dependency direction, and truthful build/test/release contracts.

The two reported behaviors fit this conclusion:

- StreetJS server route trailing-slash behavior needs an explicit framework policy; client URL normalization alone is not enough.
- `@streetjs/client` token non-storage is currently correct and intentionally verified. The missing piece is an optional, portable token lifecycle adapter—not implicit browser persistence in the base client.

---

## 18. Phase-1 reconnaissance maps

This section is the implementation baseline for the next phases. It records where the current contracts live and the compatibility surfaces that must be checked before changes.

### 18.1 Package dependency map

```text
Application code / generated projects
              │
              ▼
       streetjs (core facade)
              │
   ┌──────────┼───────────┐
   ▼          ▼           ▼
 router     context     security/session
   │          │           │
   ├──────► exceptions ◄──┘
   │
   ├── database / pool / repository / migrations / schema-inspector
   ├── websocket / multipart / ratelimit / cache / store
   └── telemetry / cluster / diagnostics / platform plugins

Capability packages
  queue / events / workflow / realtime / storage / gateway
       │
       └── currently use some broad streetjs/core exports for shared concerns

Provider plugins and vendor integrations
  plugin-* / slack / github / ...
       │
       └── provider contracts + core/plugin SDK

Client and UI adapters
  client → react/vue/next/nuxt/auth-ui/ai-ui/admin-ui
```

**Boundary conclusion:** the facade is a valid consumer entry point, but capability packages should progressively consume narrow existing contracts (`context`, `exceptions`, `config`, observability interfaces) rather than the entire `streetjs` package. No new foundation package is justified until an existing owner proves insufficient.

### 18.2 Public API map

| Developer concern | Current canonical entry point | Evidence | Compatibility note |
|---|---|---|---|
| Application bootstrap | `streetjs` → `streetApp` | `packages/core/src/http/server.ts`, root README | Preserve existing factory; `createApp` would need an additive alias/ADR. |
| HTTP server | `streetjs` HTTP exports | `packages/core/package.json` exports | Public and widely documented. |
| Router | `streetjs/router`, `@streetjs/router` | core subpath and router package exports | Semantics must converge without removing either entry point. |
| Middleware | `app.use`, router middleware | core/router source | Preserve function signature while adding ownership where needed. |
| DI | core container plus `@streetjs/container` | core/container sources | Global compatibility surface; application scoping must be additive first. |
| Config | `@streetjs/config` and core config usage | config package/tests | Treat config package as canonical. |
| Context | core context and `@streetjs/context` | package exports/source | Narrow contract candidate. |
| Errors | `@streetjs/exceptions`, client/workflow errors | package sources | Preserve specialized classes; standardize boundaries. |
| Plugins | `PluginHost`, `PluginModule`, `SandboxedApp` | core plugin SDK/host | Public extension contract; disposer return is additive-compatible. |
| Client auth | `getToken` callback | `packages/client/src/http.ts` | Base client remains storage-agnostic. |

### 18.3 Lifecycle and resource map

| Resource | Current owner | Current cleanup | Status/risk |
|---|---|---|---|
| HTTP server | `StreetApp` | `app.close()` | Implemented; cross-module ownership needs one convention. |
| Request timeout | request handler | response finish/close | Implemented and bounded. |
| Plugin middleware | `StreetApp` / plugin host | removed on unload | Implemented in core path. |
| Plugin event listeners | `StreetApp` sandbox | disposer/automatic unload cleanup | Improved; needs broader resource registry for timers/health/metrics. |
| Plugin-host listener records | `GatedSandbox` | disposer removes record | Contract now explicit; host integration remains limited. |
| DI singletons | global container | `reset()` only | No deterministic disposal; P1 backlog. |
| Queue worker/scheduler/driver | queue facade | ordered close | Strong local contract; readiness/error state incomplete. |
| Workflow bridge/engine | workflow plugin | detach + close | Strong local contract. |
| DB pools | pool/database callers | package-specific close | Needs application ownership integration. |
| Tracing/metrics exporters | observability packages | package-specific handles | No universal scope registry. |

### 18.4 DI usage map

| Usage | Current mechanism | Evidence | Compatibility risk |
|---|---|---|---|
| Core controllers | process-global core container | `packages/core/src/http/server.ts` | High: changing singleton identity can affect existing apps. |
| Decorated classes | metadata plus constructor resolution | core/container sources | Preserve decorators while adding explicit registration. |
| Interface/token dependencies | manual symbols/registrations | security `JWT_SERVICE`, container APIs | Add token API without removing class resolution. |
| Tests | global reset patterns | core/container tests | Application scopes would improve isolation; retain reset bridge. |
| Capability packages | direct construction and plugin providers | queue/workflow/storage sources | Migrate incrementally to app context/resource ownership. |

### 18.5 Router behavior matrix

| Input/route | Core HTTP registration | Standalone router | Gateway | Current conclusion |
|---|---|---|---|---|
| `/users` → `/users` | matches | exact match | static match | Verified canonical form. |
| `/users/` → `/users` | does not match | no cross-layer contract | static behavior differs by matcher | Undefined framework-wide policy. |
| `/users/:id` | parameter extraction | parameter extraction | gateway-specific matcher | Needs equivalent encoded/path tests. |
| `/users/*` | wildcard behavior in router | wildcard behavior | requires remaining segment | Needs one documented wildcard rule. |
| `/` | root handling exists | package-specific | gateway-specific | Needs explicit root test in common matrix. |
| query string | parsed at HTTP boundary | supplied separately | gateway policy | Should not affect path matching. |
| encoded path | URL parser + route matcher | matcher-specific | matcher-specific | Needs encoded-slash/security contract. |
| mounted router | core composition | package API | gateway prefixes | No common contract test. |

### 18.6 Authentication/client behavior matrix

| Concern | Current behavior | Status | Decision boundary |
|---|---|---|---|
| Token acquisition | `getToken()` sync/async per request | VERIFIED | Keep as low-level primitive. |
| Token storage | no local/session/cookie/IndexedDB writes | VERIFIED by regression test | Keep absent from base client. |
| Login | POST credentials, return server response | VERIFIED | Does not establish client-owned state. |
| Refresh | no built-in refresh/retry | MISSING | Optional adapter only after contract design. |
| 401 retry | immediate `StreetApiError` | VERIFIED | Avoid automatic POST replay in base client. |
| Logout | POST endpoint only | PARTIAL | Adapter may clear owned store; base client cannot. |
| Realtime auth | URL/client configuration only | PARTIAL | Needs separate server/client contract review. |

### 18.7 Error taxonomy map

| Error family | Current owner | Boundary representation | Gap |
|---|---|---|---|
| HTTP/framework exceptions | `@streetjs/exceptions` | status/message/details JSON | No stable code/correlation schema. |
| Client errors | `@streetjs/client` | `StreetApiError`/`StreetClientError` classes | Not same envelope as server. |
| Workflow errors | `@streetjs/workflow` | specialized classes/fields | Separate serialization philosophy. |
| Plugin errors | core plugin host | specialized classes | Cross-package type guard concerns. |
| JWT/security failures | security service returns null | null at verification boundary | Correct fail-closed behavior; caller diagnostics vary. |
| Unknown HTTP failures | core router | generic 500 + correlation behavior | Needs shared error policy. |

### 18.8 Root build/test graph

```text
npm run build
  ├── packages/core build
  │     ├── prebuild compiles 20+ foundational workspaces
  │     └── postbuild copies SQLite assets
  └── packages/cli build

npm test
  └── packages/core test
        └── dist/tests/integration.test.js
              ├── offline HTTP/router/container tests
              └── PostgreSQL suites skipped unless PG_HOST is configured
```

Current observed behavior after a local build: root build passes, root test passes with 16 tests and 4 PostgreSQL suites skipped, and root lint passes. On a clean checkout before generated core test output exists, root test fails because it assumes `dist/tests/integration.test.js`. Therefore the command graph is not yet a clean-checkout contract.

### 18.9 Compatibility risk register

| Change area | Risk | Required safeguard |
|---|---|---|
| DI scoping | Existing apps rely on global singleton identity | Additive `createContainer`/app scope, legacy bridge, migration docs |
| Router slash policy | Existing clients may rely on 404 or exact matching | ADR, opt-in/configurable transition, cross-layer tests |
| Error envelope | Consumers may parse existing JSON shapes | Additive fields or versioned boundary, preserve classes |
| Plugin `on()` return type | Existing callers ignore return | Additive return is source-compatible; document disposer ownership |
| JWT validation | Previously accepted malformed signed tokens | Security-hardening release note and explicit rejection tests |
| Client auth adapter | Storage expectations vary by platform | Separate opt-in module/API; no base-client behavior change |
| Root commands | CI/scripts may depend on current narrow scope | Introduce explicit offline/integration commands while preserving aliases |

---

## 19. Implemented contract updates after the audit

The following roadmap items have now been implemented as additive or explicitly
documented changes:

| Contract | Implementation | Evidence |
|---|---|---|
| JWT runtime validation | `@streetjs/security` validates identity and standard claim shapes before returning verified payloads. | 29 security tests pass. |
| Plugin listener ownership | `SandboxedApp.on()` returns a disposer; HTTP plugin unload removes registered listeners. | Core build/lint and 38-test lifecycle suite pass. |
| Application-scoped DI | `createContainer`, explicit token/factory bindings, singleton/transient/scoped lifetimes, child scopes, and idempotent disposal. Legacy global container remains. | 14 container tests pass; core build/lint pass. |
| Root test contract | Node 22 pin, offline default test command builds test artifacts before execution, explicit integration alias. | Cleaned core `dist`, then root `npm test` passed 17 tests with four visible PostgreSQL skips. |
| Error projection | Additive `StreetErrorEnvelope` and `toStreetErrorEnvelope`; existing `toJSON()` remains unchanged. | 9 exceptions tests pass; core exports verified by build/lint. |
| Route paths | Strict no-trailing-slash policy across core/standalone router/gateway; root `/` remains valid; query strings ignored. | Router, gateway property, and core HTTP tests pass. |
| App/container integration | `StreetApp` and HTTP2 accept an optional `Container` and expose the selected controller container; legacy global fallback remains. | Core build/lint and 39-test roadmap suite pass. |
| HTTP error envelope | HTTP and HTTP2 support explicit `errorResponse: 'envelope'`; legacy remains default. | Router 23-test suite and core offline integration pass. |

These changes do not claim the entire framework is complete. Remaining major
contracts are application-container integration into `StreetApp`, broader plugin
resource registries, cross-package error adoption, dependency-direction cleanup,
and an optional client authentication lifecycle adapter.
