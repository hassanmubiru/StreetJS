Street Framework: Production Readiness Gap Analysis
Date: Current
Analyst Roles: Principal Software Architect · Security Engineer · QA Lead · Technical Writer · Framework Maintainer
Evidence Basis: 147 TypeScript source files · 33 test files · 194 passing tests · Full CI/CD pipeline review · Security code audit · Documentation depth assessment

Executive Summary
Street Framework has a strong, well-engineered v1.0 core — a zero-dependency TypeScript backend framework with a genuine PostgreSQL wire protocol implementation, solid security primitives, and a clean architecture. The codebase compiles with zero TypeScript errors and passes 194 tests across unit, integration, system, and memory-safety suites.

However, the framework cannot be shipped to production developers in its current state for four reasons:

Two critical security bugs create authentication and authorization bypass vulnerabilities in v1.4 features (WebAuthn and RBAC).
Roughly 40% of the codebase (v1.4–v3.0) has zero test coverage — auth, tenancy, microservices, enterprise, and platform modules are untested.
Key features are architecturally broken at runtime despite compiling cleanly (RBAC guard never fires; WebAuthn silently skips signature verification on key format errors).
No benchmarks exist despite the roadmap requiring comparison against Express, Fastify, NestJS, Hono, Fiber, and Gin.
The path to production readiness requires three phases over an estimated 8–12 weeks of focused engineering.

Findings Table
SECURITY
ID	Severity	Finding	Risk	Recommended Fix	Effort
S-01	Critical	WebAuthn signature verification bypass. finishAuthentication() catches all Error instances that aren't 'Invalid assertion signature' and silently proceeds — meaning any credential where the stored public key fails DER parsing (e.g., because finishRegistration stored raw authData bytes instead of a parsed COSE key) will authenticate without signature verification.	Unauthenticated access to any WebAuthn-protected resource.	(a) Fix finishRegistration to properly parse and store the COSE public key using node:crypto's JWK import. (b) Remove the test mode catch bypass — never skip cryptographic verification.	2–3 days
S-02	Critical	RBAC guard is architecturally inoperative. rbacGuard() reads ctx.state['routeHandler'] to find decorated method metadata, but the router (router.ts) never sets this field. Every route decorated with @Roles() or @Permissions() is unprotected at runtime.	Complete authorization bypass — any authenticated user can access any role-protected route.	The router must extract route-handler metadata at dispatch time and call Reflect.getMetadata('street:roles', ...) / Reflect.getMetadata('street:permissions', ...) directly, or store handler reference in ctx.state during dispatch.	1–2 days
S-03	High	PKCE verifier not persisted to encrypted session. OAuthManager stores the OAuth2 code_verifier and state in the sessionManager which defaults to null. When no session manager is provided (the default), PKCE state is lost after redirect — making CSRF protection non-functional.	OAuth2 CSRF attacks possible without a configured session manager; silent security degradation.	(a) Make sessionManager required, not optional. (b) Add a startup assertion that throws if OAuth flows are registered without a session manager. (c) Add integration tests for the PKCE round-trip.	1 day
S-04	High	Hand-rolled AWS SigV4 signing in secret-providers.ts is unaudited. Any error in canonical request formatting, HMAC calculation, or header handling can cause silent authentication failures or credential exposure.	Secret retrieval fails silently; credentials potentially logged in error paths.	Add a comprehensive test suite for the SigV4 implementation including known test vectors from AWS's published SigV4 test suite. Consider using @aws-sdk/signature-v4 (a tree-shakeable, audited implementation) as a dev dependency for this specific purpose.	2–3 days
S-05	High	WebAuthn finishRegistration stores raw authData bytes (the full authenticator data buffer) as the credential public key instead of parsing and storing the COSE-encoded EC/RSA public key. This means finishAuthentication will always fail to parse the stored key and fall into the bypass path (S-01).	Every WebAuthn registration produces an unusable credential; combined with S-01, authentication silently succeeds anyway.	Implement a proper COSE key parser: read the credentialPublicKey CBOR map from the attestedCredentialData section of authData, extract kty/crv/x/y (EC) or n/e (RSA), and store as JWK JSON.	2 days
S-06	Medium	Timing side-channel in API key verification. The length check storedHash.length !== computedHash.length before timingSafeEqual leaks the expected hash length (32 bytes for SHA-256) via a timing difference.	Minor information leakage — exploitable only in highly targeted attacks.	Remove the length pre-check; timingSafeEqual throws if lengths differ, so wrap in a try/catch or ensure both buffers are always 32 bytes.	30 minutes
S-07	Medium	StreetSeeder.run() executes raw seed file SQL without sanitization. A compromised or malicious seed file can execute arbitrary DDL/DML.	Supply-chain risk: if a seed file is generated from untrusted input, SQL injection is possible.	Document that seed files must be committed to version control and reviewed like migrations. Add a --dry-run flag to street db:seed.	1 day
S-08	Low	One TODO(otel) comment in pool.ts would be caught by the code-hygiene CI scan and fail the build.	CI build would fail on the enforcement workflow.	Complete the OTel child span instrumentation or remove the TODO comment.	2 hours
S-09	Low	One TODO comment in repository.ts (parameterized queryStream).	Same CI hygiene failure.	Implement parameterized queryStream or remove the TODO.	4 hours
TESTING
ID	Severity	Finding	Risk	Recommended Fix	Effort
T-01	Critical	Zero tests for v1.4 Auth module (api-keys.ts, oauth2.ts, rbac.ts, refresh-tokens.ts, session-store.ts, webauthn.ts). Security-critical code ships untested.	Critical bugs S-01 and S-02 were introduced and remained undetected because there were no tests.	Write a comprehensive auth test suite: at minimum 50 tests covering every public method, error path, and security invariant. Use SqlitePool for storage-backed tests.	5–7 days
T-02	High	Zero tests for v1.7 Tenancy, v2.0 Microservices, v2.2 Enterprise, v3.0 Platform modules (35+ source files).	Regressions in these modules are undetectable.	Write unit tests for all public APIs. Modules with DB dependencies should use SqlitePool for in-memory testing. Minimum 5 tests per file.	8–12 days
T-03	High	Health check test suite has 9 cancelled tests due to a pending-promise event-loop issue. The HealthCheckRegistry timeout behavior and all registerHealthRoutes integration tests are effectively untested.	HealthCheckRegistry timeout path may be broken; HTTP 200/503 response behavior is unverified.	Restructure the timeout test to use a manually-resolvable promise (already partially attempted) and run the integration tests with --test-force-exit.	2 hours
T-04	High	MySQL integration tests are skipped when MYSQL_HOST is not set. No CI job provides a MySQL service.	MySQL driver ships without any real-database validation.	Add a MySQL service container to the GitHub Actions CI/CD pipeline.	4 hours
T-05	High	No benchmarks exist. The roadmap requires throughput and latency comparisons against Express, Fastify, NestJS, Hono, Fiber, and Gin.	Performance claims are unverifiable; Street may be slower than alternatives without anyone knowing.	Create benchmarks/ directory with autocannon scripts for the primary HTTP path. Add a benchmark CI job that records results as artifacts.	3–4 days
T-06	Medium	No tests for WorkflowEngine, the MigrationDiffer, the SDK generators, or the API versioning strategy.	These features may have behavioral bugs that ship undetected.	Add at minimum happy-path + error-path tests for each module.	3 days
T-07	Medium	System test infrastructure.test.ts requires live PostgreSQL but CI may not always have it available.	Intermittent CI failures.	Add PostgreSQL service to all CI jobs that require it, or gate those tests with an env var skip.	2 hours
T-08	Low	No end-to-end test that creates a real Street app from street create, runs migrations, inserts data, and queries it back.	Gap between tested units and real developer experience.	Add one full integration smoke test in the CLI test suite.	1 day
DOCUMENTATION
ID	Severity	Finding	Risk	Recommended Fix	Effort
D-01	High	No documentation for any v1.1–v3.0 features. The docs/ site covers only v1.0 (HTTP, router, DI, PostgreSQL, security basics). Auth, observability, jobs, tenancy, microservices, and enterprise features have no guides.	Developers cannot use 60% of the framework's features without reading source code.	Write feature guides for: Auth (JWT+Session+OAuth2+RBAC), Observability (Logger+Prometheus+Health), Jobs (Queue+Cron+Workflow), and CLI Commands (info/doctor/audit/diagnostics).	5–8 days
D-02	High	No working example applications. The docs/examples/ directory has markdown stubs, but no runnable code in examples/.	Developers cannot learn Street by example — the primary onboarding path for any framework.	Create 3 runnable example apps: (a) basic REST API, (b) authenticated API with JWT + RBAC, (c) background job processing.	3–5 days
D-03	Medium	
api-reference.md
 is 172 lines and covers only v1.0 exports. No API reference for 100+ new exported symbols.	Developers must read TypeScript source code to understand method signatures and options.	Generate API reference from TSDoc comments using typedoc. Add TSDoc to all exported public APIs (currently missing from ~70% of exports).	4–5 days
D-04	Medium	CHANGELOG.md not auto-generated from conventional commits as specified by the roadmap.	Version history is incomplete and manually maintained.	Add conventional-changelog to the release workflow.	4 hours
D-05	Low	README.md does not mention v1.1+ features — no mention of MySQL/SQLite, logging, metrics, health checks, jobs, or auth.	First impressions: the framework appears to have only v1.0 capabilities.	Update README with feature list, quick-start example covering v1.1+ features, and badges for CI/coverage.	4 hours
DEVELOPER EXPERIENCE
ID	Severity	Finding	Risk	Recommended Fix	Effort
DX-01	High	street create scaffolds a project but the generated code doesn't compile unless reflect-metadata is installed separately.	First developer experience is broken: generated project fails npm run build.	Add reflect-metadata as a generated-project dependency. Include a working tsconfig.json that enables experimentalDecorators and emitDecoratorMetadata.	2 hours
DX-02	High	@Encrypt() decorator exists but field-level encryption is not wired into the repository layer. Developers applying @Encrypt() see no encryption occur.	Silent false-sense-of-security: developers believe fields are encrypted when they are not.	Either (a) wire encryption into StreetPostgresRepository's create/update/findById/findAll paths, or (b) mark @Encrypt() as @experimental with a clear warning.	2–3 days
DX-03	Medium	enableVersioning() exists but is not wired into StreetApp's route registration. @ApiVersion('v2') decorators have no effect.	Developers cannot use API versioning despite it appearing in the API.	Integrate enableVersioning() into streetApp()'s registerController() method.	1–2 days
DX-04	Medium	StreetSeeder uses a brittle dual-placeholder detection (? retry → $1 fallback) that breaks on seed files with ? in string literals.	Seed files with SQL like INSERT INTO t VALUES ('what?') will fail.	Detect the pool type (PgPool vs SqlitePool) at construction time and use the correct placeholder style unconditionally.	4 hours
DX-05	Medium	street dev uses require() implicitly via spawn('npx', ['tsc']) — this will fail in npm workspaces or when npx is not available.	Hot reload doesn't work in all environments.	Use node --require or node:child_process.execFile with the local tsc binary path resolved via require.resolve.	2 hours
DX-06	Low	Missing CLI commands: street plugin:install, street plugin:list, street jobs:dashboard, street audit:export, street compliance:report. These appear in source but are not registered in the CLI switch.	Developers who read the roadmap will try commands that don't exist.	Register all commands in the CLI switch, or remove the unregistered source files.	1 day
PERFORMANCE
ID	Severity	Finding	Risk	Recommended Fix	Effort
P-01	High	No benchmark data exists. The roadmap requires performance comparisons against 6 frameworks. The CI enforcement workflow references a benchmark job that was never implemented.	Cannot make performance claims; cannot detect performance regressions in CI.	Create benchmarks/ with autocannon scripts. Establish baseline numbers. Add benchmark CI job that fails if throughput drops >10% vs baseline.	3–4 days
P-02	Medium	Edge runtime adapter (packages/edge/) creates a full HTTP server via app.listen() on an ephemeral port for each incoming request, then makes an HTTP connection to it. This adds ~50–100ms of overhead per edge invocation, defeating the purpose of an edge runtime.	Edge adapter is functionally broken for production use — no request would complete within edge function time limits.	Implement a direct dispatch path: expose an internal app._dispatch(req, res) method on StreetApp and call it without spinning up a real TCP server.	2–3 days
P-03	Medium	GraphQlEngine re-parses the schema on every execute() call. No query parsing cache exists.	High-traffic GraphQL endpoints will have unnecessary CPU overhead for schema validation.	Cache parsed query ASTs by query string using an LruCache.	4 hours
P-04	Low	SchemaInspector batches PostgreSQL queries well, but MySQL introspection uses three sequential queries to information_schema rather than parallel Promise.all().	Slightly slower MySQL schema inspection than necessary.	Already uses Promise.all() — this was confirmed in source review.	None needed
RELIABILITY
ID	Severity	Finding	Risk	Recommended Fix	Effort
R-01	High	WorkflowEngine.resume() has no distributed locking. Two processes calling resume() on the same workflowId simultaneously can execute the same step twice, violating exactly-once step semantics.	Data corruption in multi-instance deployments using WorkflowEngine.	Acquire a DistributedLock on workflowId before executing steps. The DistributedLock class already exists.	4 hours
R-02	High	AuditLogger accumulates flushTimer references. Each call to log() that doesn't reach BATCH_SIZE=100 sets a 5-second setTimeout. If log() is called 1,000 times in 5 seconds, 1,000 timers accumulate.	Memory leak under sustained audit logging load.	Change to a single rolling timer: check if flushTimer !== null before setting a new one (already partially done — verify the guard works correctly).	2 hours
R-03	Medium	CronScheduler has no persistence. If the process crashes, scheduled jobs that were mid-execution or about to fire are lost.	Scheduled work is silently dropped on process restart.	Document this limitation clearly. For production, recommend combining CronScheduler with the JobQueue for durable scheduling.	2 hours (docs)
R-04	Medium	SqlitePool WASM driver uses Emscripten MEMFS — all file I/O is in-process memory, not the real filesystem. Database "files" are lost on process restart.	Developers using SQLite expecting disk persistence will silently lose data.	Improve documentation of this limitation. Provide a compatibility note in CONTRIBUTING.md (partially done). Add a warning log when a non-:memory: path is used.	2 hours
R-05	Low	AgentExecutor history array grows unbounded if the history summarization step itself fails repeatedly (the catch block is empty).	Memory growth under adversarial or API-error conditions.	Add a hard maximum history length (e.g., 50 messages) that evicts oldest entries regardless of summarization success.	1 hour
DATABASE LAYER
ID	Severity	Finding	Risk	Recommended Fix	Effort
DB-01	High	MySQL caching_sha2_password RSA path is unimplemented. When a MySQL server configured to require RSA-encrypted passwords sends a 0x04 auth-more-data packet, the driver sends the cleartext password — which is only safe over TLS. Most managed MySQL services (AWS RDS, GCP CloudSQL) require caching_sha2_password.	Passwords sent in cleartext to managed MySQL services.	Either (a) implement the RSA public key exchange using node:crypto + the server's public key, or (b) reject connections with a clear error message when RSA-only auth is required and TLS is not established.	2–3 days
DB-02	Medium	No MySQL CI job. The MySQL driver has no real-database tests in CI.	Regressions in MySQL protocol implementation go undetected.	Add a MySQL 8.x service container to GitHub Actions. Run mysql.test.ts in CI.	4 hours
DB-03	Medium	StreetSeeder placeholder detection is brittle (see DX-04 above).		(See DX-04)	
DB-04	Low	MigrationDiffer.diff() depends on @Column decorator metadata that is not part of the public API and is not documented.	Developers cannot use street migrate:diff without knowing how to annotate entities.	Document the entity decorator contract and add at least one migration-diff test.	1 day
CI/CD
ID	Severity	Finding	Risk	Recommended Fix	Effort
CI-01	High	The code-hygiene CI job (ci-cd-enforcement.yml) would fail immediately on the current codebase due to two TODO comments in pool.ts and repository.ts.	Enforcement workflow is unusable without fixing the two TODOs first.	Fix both TODO items (see S-08, S-09).	4–6 hours total
CI-02	High	No benchmark CI job exists despite the roadmap requiring it.	Performance regressions are invisible.	Create benchmarks/ directory and benchmark CI job (see P-01).	3–4 days
CI-03	Medium	No MySQL service in any CI job.	(See T-04, DB-02)		
CI-04	Medium	Coverage thresholds in 
package.json
 are set to 85% but the CLI coverage currently likely falls below this for new commands (diagnostics.ts, seed.ts).	CI may be falsely passing or suppressing coverage failures.	Verify CLI coverage with npm run coverage -w packages/cli and fix failing threshold, or add tests for new commands.	2 hours
CI-05	Low	CHANGELOG.md not auto-generated from conventional commits. The release workflow publishes packages but doesn't generate a changelog.	Version history is manual and incomplete.	(See D-04)	
OBSERVABILITY
ID	Severity	Finding	Risk	Recommended Fix	Effort
O-01	High	OTel child span instrumentation for PgPool.query() is a TODO comment only. The roadmap specifies every database query should be traced as a child span.	Distributed traces are missing the most important spans (database calls).	Complete task 11.6: wrap PgPool.query() to create a child span when ctx.state['otelSpan'] is present. The OtelTracer.startSpan() API already supports parent context.	1 day
O-02	Medium	correlationMiddleware generates UUID v4 for correlation IDs but the UUID format is not documented or validated.	Correlation IDs in logs may be difficult to trace if consumers expect a different format.	Document the correlation ID format. Optionally, accept configurable ID generators.	2 hours
O-03	Low	prometheusMiddleware updates process_heap_bytes on every request rather than on a background interval.	Slightly inflated per-request latency from process.memoryUsage() calls on hot paths.	Move heap collection to a setInterval (5s) background task.	1 hour
DEPLOYMENT
ID	Severity	Finding	Risk	Recommended Fix	Effort
DEP-01	High	Edge runtime adapter is functionally broken for production use (see P-02).	Cannot deploy Street apps to Cloudflare Workers, Vercel Edge, or AWS Lambda without fixing the adapter.	(See P-02)	2–3 days
DEP-02	Medium	STREET_READINESS_DELAY_MS env var is specified in the roadmap but not implemented. Kubernetes readiness probes will mark pods ready before the app is fully warmed up.	Under-capacity serving during rolling deploys.	Implement in HealthCheckRegistry.runReadiness(): return down until Date.now() >= startTime + parseInt(process.env.STREET_READINESS_DELAY_MS).	2 hours
DEP-03	Medium	GCP Cloud Run auto-detection (via K_SERVICE/K_REVISION env vars) is specified in the roadmap but not implemented in the Logger.	Logs on Cloud Run won't use GCP's structured JSON format with severity/httpRequest fields.	Add a Cloud Run format check in Logger constructor.	4 hours
DEP-04	Low	generateManifest() generates Kubernetes YAML but doesn't include imagePullSecrets, serviceAccountName, or namespace — required in most production clusters.	Generated manifests require manual editing before use.	Add optional fields. Document required manual additions.	4 hours
Risk Matrix
SEVERITY
  │
C │  S-01 S-02
r │  (WebAuthn (RBAC
i │   bypass)  bypass)
t │
i ├────────────────────────────────────────────────────
c │  T-01       S-03       DB-01
a │  (No auth   (OAuth2    (MySQL RSA
l │  tests)     PKCE bug)  auth)
──┼──────────────────────────────────────────────────
H │  T-04 T-05  P-02       R-01       O-01       CI-01
i │  CI-02 D-01 (Edge     (Workflow   (DB spans  (TODO
g │  D-02       adapter)   no lock)   missing)   blocks CI)
h │
──┼──────────────────────────────────────────────────
M │  DX-01 DX-02 DX-03 DX-04 R-02 DB-02 DEP-02 DEP-03
e │  T-06 T-07 D-03 D-04 CI-04 P-01 P-03 S-04
d │
──┼──────────────────────────────────────────────────
L │  S-06 S-07 S-08 S-09 DX-05 DX-06 T-08 R-03 R-04
o │  R-05 D-05 DB-04 CI-05 O-02 O-03 DEP-04
w │
  └──────────────────────────────────────────────────
           LIKELIHOOD →
        Low    Med    High
Recommended Roadmap
Phase 1: Production Readiness (Weeks 1–4)
Goal: Eliminate all Critical and High security findings, fix broken features, achieve 80% test coverage on core modules.

Week 1 — Critical Security Fixes

Task	Owner Role	Effort
Fix WebAuthn: implement COSE key parsing in finishRegistration (S-05)	Security Engineer	2 days
Fix WebAuthn: remove test mode signature bypass in finishAuthentication (S-01)	Security Engineer	0.5 days
Fix RBAC: wire ctx.state['routeHandler'] or extract metadata in router dispatch (S-02)	Software Architect	1.5 days
Fix OAuth2: make sessionManager required, add PKCE round-trip integration test (S-03)	Security Engineer	1 day
Remove the two TODO comments that break the code-hygiene CI scan (CI-01)	Framework Maintainer	0.5 days
Week 2 — Auth Test Suite

Task	Effort
Write 
auth.test.ts
: 60+ tests covering all auth modules	5 days
Fix health check test (T-03): resolve event-loop cancellation issue	2 hours
Add MySQL CI service container (T-04)	4 hours
Week 3 — Broken Feature Fixes + DX

Task	Effort
Fix edge adapter: implement direct dispatch without TCP server (DEP-01, P-02)	2 days
Fix StreetSeeder placeholder detection (DX-04, DB-03)	4 hours
Wire enableVersioning() into StreetApp (DX-03)	1 day
Implement STREET_READINESS_DELAY_MS (DEP-02)	2 hours
Complete OTel DB span instrumentation (O-01)	1 day
Fix AuditLogger timer accumulation (R-02)	2 hours
Fix API key timing side-channel (S-06)	30 minutes
Week 4 — Benchmarks + CI

Task	Effort
Create benchmarks/ with autocannon scripts (P-01, T-05)	3 days
Add benchmark CI job	4 hours
Verify and fix CLI coverage threshold (CI-04)	2 hours
Register missing CLI commands: jobs:dashboard, plugin:install, plugin:list (DX-06)	1 day
Phase 2: Public Release (Weeks 5–8)
Goal: Complete documentation, working examples, MySQL RSA auth, 85% test coverage.

Week 5–6 — Documentation

Task	Effort
Write Auth guide (JWT, Session, OAuth2, RBAC, API Keys, WebAuthn)	2 days
Write Observability guide (Logger, Prometheus, Health Checks, OTel)	1.5 days
Write Jobs guide (Queue, Cron, Workflow)	1 day
Write CLI reference (all commands with examples)	1 day
Generate API reference with typedoc + add TSDoc to all exports	2 days
Update README.md with v1.1+ features (D-05)	4 hours
Auto-generate CHANGELOG.md (D-04)	4 hours
Week 7 — Example Applications

Task	Effort
Build examples/01-rest-api/ — complete Todo API with PG, migrations, JWT	2 days
Build examples/02-authenticated-api/ — RBAC, sessions, refresh tokens	1.5 days
Build examples/03-background-jobs/ — JobQueue, CronScheduler, health checks	1 day
Week 8 — Database + Testing Completion

Task	Effort
Fix MySQL caching_sha2_password RSA auth (DB-01)	2.5 days
Write tests for WorkflowEngine, MigrationDiffer, SDK generators (T-06)	3 days
Write tenancy module tests (T-02 partial)	2 days
Phase 3: Enterprise Readiness (Weeks 9–12)
Goal: Complete enterprise feature testing, Redis transport, GCP logging, full CI/CD pipeline.

Task	Effort
Redis transport for EventBus and DistributedCache	3 days
GCP Cloud Run structured logging (DEP-03)	4 hours
Implement field-level encryption in repository layer (DX-02)	2 days
Tests for enterprise modules (AuditLogger, FeatureFlags, DataPolicy, Backup)	4 days
Tests for microservices (CircuitBreaker, EventStore, Saga, CQRS)	2 days
AWS SigV4 test vectors for secret providers (S-04)	2 days
WorkflowEngine distributed locking (R-01)	4 hours
gRPC server + proto parser implementation	5 days
street analytics report CLI	1 day
Full npm package audit: verify dist contents, CLI execution, global install	1 day
Measurable Success Criteria
Test Coverage
Module	Current	Phase 1 Target	Public Release Target
packages/core (unit)	135 tests, ~70% of files	200+ tests, 80% of files	300+ tests, 90% of files
Auth module	0%	80%	95%
Jobs module	15 tests		