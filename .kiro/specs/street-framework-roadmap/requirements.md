# Requirements Document

## Introduction

This document specifies the requirements for the Street Framework implementation roadmap spanning versions v1.1 through v3.0. Street is a TypeScript-first, memory-safe, security-first, zero-runtime-dependency, production-grade backend framework built on Node.js core modules. The v1.0 baseline includes an HTTP server, regex router, controller decorators, DI container, PostgreSQL wire protocol driver, connection pool, repository layer, migration engine, ACID transactions, JWT auth, AES-GCM sessions, vault mode, rate limiter, XSS protection, security headers, CORS, multipart uploads, WebSockets, SSE, LRU cache, telemetry, cluster coordinator, webhook dispatcher, OpenAPI generator, CLI, Docker, and GitHub Actions CI/CD.

Each version in this roadmap must satisfy the Absolute Implementation Policy: fully implemented with no stubs or mocks, fully tested against real databases and sockets, security-audited, memory-audited, benchmarked against Express/Fastify/NestJS/Hono/Fiber/Gin, fully documented, integrated into CI/CD, and shipped as a production-ready stable release before the next version begins.

## Glossary

- **Street Framework**: The TypeScript-first backend framework being developed, built on Node.js core modules.
- **Framework**: The Street Framework system, consisting of `@streetjs/core` and `@streetjs/cli` packages.
- **CLI**: The `@streetjs/cli` command-line interface tool for scaffolding and managing Street projects.
- **Core**: The `@streetjs/core` runtime library.
- **DI Container**: The Dependency Injection container managing singleton lifecycles and recursive resolution.
- **Migration Engine**: The `StreetMigrationRunner` that applies ordered idempotent SQL migrations with a tracking table.
- **Connection Pool**: The `PgPool` bounded connection pool with idle sweep and acquire queue.
- **Repository**: The `StreetPostgresRepository<T>` generic data access layer.
- **Wire Protocol**: The native PostgreSQL wire protocol v3 client built on `node:net` and `node:crypto`.
- **Absolute Implementation Policy**: The mandatory quality gate requiring full implementation, real-infrastructure testing, security audit, memory audit, benchmarking, documentation, CI/CD integration, and stable release for every feature before it is considered complete.
- **Hot Reload**: Automatic recompilation and server restart on source file changes during development.
- **Query Builder**: A type-safe programmatic SQL query construction API.
- **Schema Introspection**: Runtime inspection of database schema (tables, columns, constraints, indexes).
- **OpenTelemetry**: The CNCF observability standard for traces, metrics, and logs.
- **Correlation ID**: A unique identifier propagated through all log entries and trace spans for a single request.
- **Prometheus**: An open-source metrics collection and alerting system with a pull-based scrape model.
- **RBAC**: Role-Based Access Control — authorization model mapping roles to permissions.
- **WebAuthn**: The W3C Web Authentication API standard for passkey and hardware-key authentication.
- **Dead Letter Queue**: A bounded queue holding jobs that have exhausted all retry attempts.
- **Saga Pattern**: A distributed transaction pattern using a sequence of local transactions with compensating actions.
- **CQRS**: Command Query Responsibility Segregation — separating read and write models.
- **Event Sourcing**: Persisting state as an immutable ordered log of domain events.
- **Circuit Breaker**: A fault-tolerance pattern that stops forwarding requests to a failing downstream service.
- **Service Mesh**: Infrastructure layer managing service-to-service communication, security, and observability.
- **Tenant**: A discrete customer or organizational unit with isolated data, configuration, and resource quotas in a multi-tenant deployment.
- **Feature Flag**: A runtime toggle that enables or disables a feature without deploying new code.
- **Audit Log**: An immutable, append-only record of security-relevant events with actor, action, resource, and timestamp.
- **Plugin Marketplace**: A registry of verified community and vendor extensions for the Street Framework.

## Requirements

---

## v1.1 — Developer Experience

### Requirement 1: Hot Reload Development Server

**User Story:** As a developer, I want the development server to automatically detect file changes and restart with updated code, so that I can iterate quickly without manually restarting.

#### Acceptance Criteria

1. WHEN a `.ts` source file in the `src/` directory is saved, THE Framework SHALL recompile only the changed files and restart the server within 2 seconds.
2. WHEN the recompilation produces a TypeScript type error, THE Framework SHALL print the full diagnostic (file, line, column, message) to stderr and keep the previous working server running.
3. WHEN the server restarts due to hot reload, THE Framework SHALL drain in-flight HTTP requests before terminating the previous process, subject to a configurable drain timeout not exceeding 5 seconds.
4. THE CLI SHALL expose a `street dev --watch` flag that enables hot reload mode distinct from a plain restart.
5. WHILE hot reload is active, THE Framework SHALL track file watcher resource usage and close all `FSWatcher` handles cleanly on `SIGTERM` or `SIGINT` to prevent listener leaks.

### Requirement 2: Code Generators

**User Story:** As a developer, I want CLI generators for middleware, gateways, and migrations, so that I can scaffold production-ready boilerplate without writing repetitive code.

#### Acceptance Criteria

1. WHEN `street generate middleware <name>` is executed, THE CLI SHALL create `src/middleware/<name>.middleware.ts` with a typed `StreetMiddleware` function signature, JSDoc, and a placeholder implementation that calls `next()`.
2. WHEN `street generate gateway <name>` is executed, THE CLI SHALL create `src/gateways/<name>.gateway.ts` with a `@Injectable()` class, a `@WebSocketGateway` decorator, and typed `onConnect`, `onMessage`, and `onDisconnect` lifecycle handlers.
3. WHEN `street generate migration <name>` is executed, THE CLI SHALL create a timestamped up-migration file `migrations/<timestamp>_<name>.sql` and a corresponding rollback file `migrations/<timestamp>_<name>.rollback.sql`.
4. IF a generator target file already exists, THEN THE CLI SHALL exit with code 1 and print a non-destructive error message without overwriting the existing file.
5. THE CLI SHALL validate the `<name>` argument against `[a-z][a-z0-9-_]*` and reject names containing uppercase letters, spaces, or special characters with a descriptive error.

### Requirement 3: Configuration Validation

**User Story:** As a developer, I want environment configuration to be validated at startup with clear error messages, so that misconfigured deployments are caught before the server accepts traffic.

#### Acceptance Criteria

1. WHEN the application starts, THE Framework SHALL validate all declared configuration values against their declared types and constraints before binding to the HTTP port.
2. IF a required configuration variable is missing or empty, THEN THE Framework SHALL log all missing variables together in a single error block and exit with code 1 before accepting any connections.
3. IF a configuration variable fails a constraint (such as an out-of-range port or malformed URL), THEN THE Framework SHALL include the variable name, the received value, and the expected constraint in the error message.
4. THE Framework SHALL support declaring configuration schemas using a `defineConfig()` API that accepts field names, types (`string | number | boolean | url | port`), requirement flags, and default values.
5. WHERE a default value is declared, THE Framework SHALL apply the default only when the variable is absent, not when it is present but invalid.

### Requirement 4: Enhanced Diagnostics

**User Story:** As a developer, I want structured error output with contextual stack information and actionable suggestions, so that I can resolve runtime errors faster.

#### Acceptance Criteria

1. WHEN an unhandled exception occurs in a route handler, THE Framework SHALL log the error class, message, and a cleaned stack trace (stripping Node.js internal frames) to stderr as structured JSON.
2. WHEN a dependency injection resolution fails, THE Framework SHALL include the full dependency chain (root → missing token) in the error message.
3. WHEN a database connection error occurs at startup, THE Framework SHALL suggest verifying `PG_HOST`, `PG_PORT`, `PG_DATABASE`, and connection pool configuration in the error output.
4. THE Framework SHALL emit a `diagnostic` event on the application event emitter for each error, enabling custom error reporters to be attached without patching internals.

### Requirement 5: CLI Operational Commands

**User Story:** As a developer, I want CLI commands for inspecting framework state, validating environments, and auditing dependencies, so that I can diagnose production and development issues from the terminal.

#### Acceptance Criteria

1. WHEN `street info` is executed, THE CLI SHALL print the Street Framework version, Node.js version, TypeScript version, operating system, and detected project configuration in a human-readable table.
2. WHEN `street doctor` is executed, THE CLI SHALL check Node.js version compatibility (≥20), TypeScript version compatibility (≥5.0), presence of required environment variables, database connectivity, and report a pass or fail status for each check.
3. WHEN `street env validate` is executed, THE CLI SHALL load the project's `street.config.ts`, validate all declared environment variables, and exit with code 0 if all pass or code 1 with a per-variable report if any fail.
4. WHEN `street audit` is executed, THE CLI SHALL list all direct and transitive npm dependencies, their installed versions, and flag any known CVEs using the npm audit registry.
5. IF `street doctor` detects a version incompatibility, THEN THE CLI SHALL print the detected version, the required version range, and a suggested upgrade command.

---

## v1.2 — Database Platform

### Requirement 6: Multi-Database Wire Protocol Drivers

**User Story:** As a developer, I want native wire protocol support for MySQL, MariaDB, and SQLite, so that I can build Street applications against the most common relational databases without adding third-party ORM dependencies.

#### Acceptance Criteria

1. THE Framework SHALL implement the MySQL Client/Server Protocol (version 4.1+) using only `node:net` and `node:crypto`, supporting `mysql_native_password` and `caching_sha2_password` authentication.
2. THE Framework SHALL implement the MariaDB wire protocol as a dialect extension of the MySQL driver, handling MariaDB-specific authentication and server capability flags.
3. THE Framework SHALL implement an SQLite driver using `node:worker_threads` to execute the SQLite C library via a bundled WASM binary, preserving the zero-native-dependency constraint.
4. WHEN a query is executed against any supported database, THE Framework SHALL use parameterized queries exclusively, preventing SQL injection at the driver level.
5. IF a wire-level connection error occurs, THEN THE Framework SHALL emit a typed `DatabaseConnectionError` with the driver name, host, port, and error code rather than a raw socket error.
6. FOR ALL valid SQL queries, executing the same query twice with identical parameters SHALL produce equivalent result sets, verifying deterministic query execution across all drivers.

### Requirement 7: Type-Safe Query Builder

**User Story:** As a developer, I want a fluent, type-safe query builder API, so that I can construct complex SQL queries programmatically without writing raw SQL strings.

#### Acceptance Criteria

1. THE Framework SHALL provide a `QueryBuilder<T>` class with `.select()`, `.from()`, `.where()`, `.join()`, `.orderBy()`, `.groupBy()`, `.having()`, `.limit()`, and `.offset()` methods that are fully typed against the entity schema.
2. WHEN `.build()` is called on a `QueryBuilder<T>` instance, THE Framework SHALL return a `{ sql: string; params: unknown[] }` object with all user values replaced by positional placeholders.
3. THE Framework SHALL support subqueries by accepting a `QueryBuilder<T>` instance as an argument to `.where()` and `.join()` conditions.
4. FOR ALL `QueryBuilder` instances, calling `.build()` twice on the same builder without mutations SHALL produce identical `{ sql, params }` outputs (idempotent build).
5. IF a `.where()` clause references a column name not present in the typed entity, THEN THE Framework SHALL produce a TypeScript compile-time error, not a runtime error.

### Requirement 8: Schema Introspection

**User Story:** As a developer, I want to inspect the live database schema at runtime, so that I can build tooling, validators, and migration diffing on top of the actual database structure.

#### Acceptance Criteria

1. WHEN `SchemaInspector.inspect(connection)` is called, THE Framework SHALL return a typed `DatabaseSchema` object containing all tables, columns (name, type, nullable, default), primary keys, foreign keys, and indexes.
2. THE Framework SHALL support schema introspection for PostgreSQL, MySQL, MariaDB, and SQLite without requiring any special database extensions or superuser privileges.
3. WHEN introspection is requested on a schema with over 500 tables, THE Framework SHALL complete within 1 second by batching catalog queries.
4. THE Framework SHALL cache the introspection result for a configurable TTL (default: 60 seconds) to avoid repeated catalog round-trips.

### Requirement 9: Migration Diffing and Seeding

**User Story:** As a developer, I want automatic migration generation from schema diffs and database seeding for test data, so that I can manage schema changes and reproducible test environments efficiently.

#### Acceptance Criteria

1. WHEN `street migrate:diff` is executed, THE CLI SHALL compare the current live database schema against the project's entity definitions and generate a timestamped `.sql` migration file containing the minimal `ALTER TABLE`, `CREATE TABLE`, and `DROP` statements needed to synchronize them.
2. WHEN `street db:seed <seed-file>` is executed, THE CLI SHALL execute the specified seed file within a transaction, rolling back automatically if any statement fails.
3. IF the generated diff migration would drop a column that still contains data, THEN THE CLI SHALL print a destructive-change warning listing the affected table and column and require a `--confirm-destructive` flag before writing the file.
4. THE Framework SHALL maintain a `street_schema_versions` tracking table for migrations and a separate `street_seed_runs` tracking table for seeds, preventing duplicate seed execution.
5. FOR ALL migration files, applying the up-migration followed by the rollback-migration SHALL restore the schema to its state before the up-migration was applied (round-trip property).

### Requirement 10: Query Profiling and Connection Diagnostics

**User Story:** As a developer, I want per-query execution timing and connection pool diagnostics, so that I can identify slow queries and pool exhaustion issues in development and production.

#### Acceptance Criteria

1. WHEN query profiling is enabled via `{ profile: true }` in the database configuration, THE Framework SHALL record the SQL text, parameters, execution duration in milliseconds, and affected row count for every query.
2. THE Framework SHALL expose a `QueryProfiler.getSlowQueries(thresholdMs: number)` method returning all recorded queries exceeding the threshold, sorted by duration descending.
3. WHEN a `/api/db/health` endpoint is registered, THE Framework SHALL return pool metrics including total connections, idle connections, waiting requests, and average acquire time.
4. IF the connection pool is fully exhausted and a new acquire request is made, THEN THE Framework SHALL emit a `pool:exhausted` event with the current pool state before enqueuing the request.
5. THE Framework SHALL provide a `ConnectionDiagnostics.ping(connection)` method that sends a protocol-level ping and returns the round-trip latency in milliseconds or a typed `ConnectionError`.

---

## v1.3 — Observability

### Requirement 11: OpenTelemetry Integration

**User Story:** As a developer, I want the framework to emit OpenTelemetry-compatible traces and metrics, so that I can use any OTEL-compatible backend (Jaeger, Tempo, Datadog, Honeycomb) without framework-level lock-in.

#### Acceptance Criteria

1. THE Framework SHALL instrument every incoming HTTP request as an OpenTelemetry span with attributes for HTTP method, route path, status code, and duration.
2. THE Framework SHALL instrument every outbound database query as a child span with attributes for the database system, statement, and duration.
3. WHEN an `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable is present, THE Framework SHALL initialize the OTLP HTTP exporter and flush spans on graceful shutdown.
4. THE Framework SHALL implement trace context propagation using the W3C `traceparent` header, reading incoming context and writing it to outbound requests.
5. IF the OTEL exporter fails to deliver spans, THEN THE Framework SHALL buffer up to 1,000 spans in memory and retry with exponential backoff before dropping, logging a single warning per drop event.
6. FOR ALL exported spans, the parent-child span relationship SHALL correctly reflect the call hierarchy, verifiable by reconstructing the trace tree from exported span IDs.

### Requirement 12: Structured Logging

**User Story:** As a developer, I want structured, leveled JSON logging with correlation IDs, so that I can filter, search, and aggregate log events in any log management platform.

#### Acceptance Criteria

1. THE Framework SHALL emit all framework-internal log events as JSON objects with `timestamp` (ISO 8601), `level` (`debug | info | warn | error`), `message`, `correlationId`, and `service` fields.
2. WHEN a request arrives, THE Framework SHALL generate or extract a correlation ID from the `X-Correlation-ID` request header and attach it to all log entries and spans produced during that request lifecycle.
3. THE Framework SHALL support configurable log levels via the `LOG_LEVEL` environment variable, suppressing all entries below the configured level.
4. THE Framework SHALL provide a `Logger` class injectable via the DI container, with `debug()`, `info()`, `warn()`, and `error()` methods that accept a message string and an optional structured metadata object.
5. WHILE the application is running in `NODE_ENV=development`, THE Framework SHALL format log output as human-readable colorized text in addition to emitting machine-readable JSON to a configurable output stream.
6. IF a log entry includes an `Error` instance as metadata, THEN THE Framework SHALL serialize it as `{ name, message, stack }` rather than an empty object.

### Requirement 13: Prometheus Metrics Exporter

**User Story:** As an operator, I want a Prometheus-compatible `/metrics` endpoint, so that I can scrape application metrics into a Prometheus instance and alert on them with Alertmanager.

#### Acceptance Criteria

1. THE Framework SHALL expose a `/metrics` endpoint that returns text in the Prometheus exposition format (version 0.0.4) with content-type `text/plain; version=0.0.4; charset=utf-8`.
2. THE Framework SHALL export the following default metrics: `http_requests_total` (counter, labeled by method, route, status), `http_request_duration_seconds` (histogram), `process_heap_bytes` (gauge), `db_pool_connections` (gauge, labeled by state: idle/active/waiting).
3. THE Framework SHALL support custom metrics registration via a `MetricsRegistry.counter()`, `.gauge()`, and `.histogram()` API that produces correctly formatted Prometheus metric descriptors.
4. WHEN the `/metrics` endpoint is scraped under concurrent load, THE Framework SHALL return a consistent snapshot without partial writes, using atomic counter reads.
5. WHERE a custom metric is registered with a name that conflicts with an existing metric, THE Framework SHALL throw a `MetricConflictError` at registration time, not at scrape time.

### Requirement 14: Health Check DSL

**User Story:** As an operator, I want a declarative health check DSL, so that I can define liveness and readiness probes that Kubernetes and load balancers can poll.

#### Acceptance Criteria

1. THE Framework SHALL provide a `HealthCheckRegistry` with `.addCheck(name, fn, { type: 'liveness' | 'readiness' })` where `fn` is an async function returning `{ status: 'up' | 'down'; details?: Record<string, unknown> }`.
2. WHEN a `GET /health/live` request is received, THE Framework SHALL execute all registered liveness checks in parallel and respond with HTTP 200 if all return `up`, or HTTP 503 with a JSON body listing failed checks.
3. WHEN a `GET /health/ready` request is received, THE Framework SHALL execute all registered readiness checks in parallel and respond with HTTP 200 or HTTP 503 with the same structure as the liveness endpoint.
4. IF a health check function throws an uncaught exception, THEN THE Framework SHALL catch it, mark that check as `down` with the error message, and continue evaluating remaining checks without propagating the exception.
5. THE Framework SHALL complete all parallel health check evaluations within a configurable timeout (default: 5 seconds) and mark any check exceeding the timeout as `down` with a `timeout` detail field.

### Requirement 15: Request Profiler and Runtime Diagnostics Dashboard

**User Story:** As a developer, I want an in-process request profiler and a terminal-accessible diagnostics dashboard, so that I can identify performance bottlenecks without external profiling tools.

#### Acceptance Criteria

1. THE Framework SHALL record per-route statistics including request count, P50 latency, P95 latency, P99 latency, and error rate, using a bounded ring buffer of at most 10,000 samples per route.
2. WHEN `street diagnostics` is executed, THE CLI SHALL connect to the running process via a Unix domain socket and display a live-updating terminal dashboard showing per-route statistics, memory usage, and active connection count, refreshed every 1 second.
3. THE Framework SHALL expose a `DiagnosticsServer` that listens on a configurable Unix socket path (default: `/tmp/street-<pid>.sock`) for the CLI diagnostics client.
4. IF the diagnostics socket file is not cleaned up after an abnormal process exit, THEN THE CLI SHALL detect the stale socket file, remove it, and print a warning before attempting reconnection.
5. WHILE the diagnostics dashboard is active, THE Framework SHALL not allocate heap memory proportional to the number of active connections beyond the fixed ring buffer size.

---

## v1.4 — Authentication & Authorization

### Requirement 16: OAuth2 and OpenID Connect Providers

**User Story:** As a developer, I want built-in OAuth2 and OIDC integration for Google, GitHub, and Microsoft, so that I can add social login without implementing the authorization code flow manually.

#### Acceptance Criteria

1. THE Framework SHALL implement the OAuth2 Authorization Code Flow with PKCE (RFC 7636) for Google, GitHub, and Microsoft identity providers using only `node:crypto` and `node:https`.
2. WHEN a user is redirected to the callback URL after authorization, THE Framework SHALL validate the `state` parameter against a cryptographically random value stored in the session to prevent CSRF attacks.
3. THE Framework SHALL validate the OIDC ID token signature against the provider's published JWKS endpoint, rejecting tokens with invalid signatures, expired `exp` claims, or mismatched `aud` claims.
4. WHEN token validation succeeds, THE Framework SHALL invoke a configurable `onSuccess(profile, tokens, ctx)` callback where `profile` contains normalized fields: `id`, `email`, `name`, and `avatarUrl`.
5. IF the provider's JWKS endpoint is unreachable, THEN THE Framework SHALL use cached public keys for up to 5 minutes before returning a 503 to prevent hard availability dependency on the provider's JWKS endpoint.
6. FOR ALL OAuth2 state parameters, the state stored in the session and the state received in the callback SHALL match exactly (round-trip property), verifying CSRF protection correctness.

### Requirement 17: API Keys

**User Story:** As a developer, I want a built-in API key authentication system, so that I can issue and revoke machine-to-machine credentials without a separate identity service.

#### Acceptance Criteria

1. THE Framework SHALL generate API keys as cryptographically random 32-byte values encoded as URL-safe base64, prefixed with a configurable namespace string (e.g., `sk_live_`).
2. THE Framework SHALL store only a BLAKE2b or SHA-256 hash of the API key in the database, never the raw key value.
3. WHEN a request includes an `Authorization: Bearer <key>` header, THE Framework SHALL compute the key hash and perform a constant-time comparison against stored hashes to prevent timing side-channel attacks.
4. THE Framework SHALL support API key expiry via an optional `expiresAt` timestamp field, rejecting expired keys with a 401 response.
5. WHEN an API key is revoked, THE Framework SHALL immediately invalidate any cached key lookups and ensure subsequent requests using the revoked key receive a 401 within one request cycle.

### Requirement 18: Refresh Tokens and Token Rotation

**User Story:** As a developer, I want automatic refresh token rotation with revocation, so that stolen refresh tokens are invalidated and legitimate users can maintain sessions without reauthentication.

#### Acceptance Criteria

1. THE Framework SHALL issue refresh tokens as cryptographically random 32-byte values, storing only their SHA-256 hash alongside the associated user ID and expiry timestamp.
2. WHEN a valid refresh token is exchanged, THE Framework SHALL atomically issue a new access token and a new refresh token and invalidate the previous refresh token in the same database transaction.
3. IF a refresh token is used more than once (replay attack), THEN THE Framework SHALL revoke the entire token family (all refresh tokens for that session) and log a security event with the client IP and timestamp.
4. THE Framework SHALL support configurable refresh token lifetimes (default: 30 days) and access token lifetimes (default: 15 minutes).
5. FOR ALL refresh token exchanges, the token issued before rotation SHALL be invalid after rotation, and the token issued after rotation SHALL be valid (rotation invariant).

### Requirement 19: RBAC and Permission Decorators

**User Story:** As a developer, I want role-based access control with controller-level permission decorators, so that I can enforce authorization rules declaratively without writing inline permission checks.

#### Acceptance Criteria

1. THE Framework SHALL provide a `@Roles(...roles: string[])` decorator that attaches the required roles list to a route handler and evaluates it in a middleware chain before the handler executes.
2. THE Framework SHALL provide a `@Permissions(...permissions: string[])` decorator that enforces fine-grained permission strings (e.g., `users:read`, `posts:write:own`) resolved from the authenticated user's role set.
3. WHEN a request reaches a `@Roles`-decorated handler without a valid authenticated session containing the required roles, THE Framework SHALL return HTTP 403 with a JSON body containing `{ error: 'Forbidden', required: string[] }`.
4. THE Framework SHALL support hierarchical roles where a higher role inherits all permissions of lower roles, configured via a `RoleHierarchy` definition passed to the framework at startup.
5. THE Framework SHALL resolve permissions synchronously from the in-memory role hierarchy to avoid per-request database lookups for standard authorization checks.

### Requirement 20: WebAuthn / Passkeys

**User Story:** As a developer, I want WebAuthn/Passkey registration and authentication flows, so that I can offer phishing-resistant, passwordless authentication to users.

#### Acceptance Criteria

1. THE Framework SHALL implement the WebAuthn Level 2 specification for credential registration and authentication using the `node:crypto` SubtleCrypto-compatible APIs.
2. WHEN a registration ceremony begins, THE Framework SHALL generate a cryptographically random challenge of at least 16 bytes, store it in the session with a 60-second expiry, and return a `PublicKeyCredentialCreationOptions` JSON object.
3. WHEN the client submits a registration response, THE Framework SHALL verify the attestation object, validate the challenge, origin, and rpId, and store the credential public key and sign count.
4. WHEN an authentication ceremony completes, THE Framework SHALL verify the assertion signature against the stored public key and reject the ceremony if the authenticator signature count is not greater than the stored count (replay protection).
5. IF the WebAuthn challenge has expired when the client submits a response, THEN THE Framework SHALL return a 400 error with message `challenge_expired` and require the client to restart the ceremony.

### Requirement 21: Session Revocation and Audit Trails

**User Story:** As an operator, I want server-side session revocation and an immutable audit trail of authentication events, so that I can terminate compromised sessions and meet compliance requirements.

#### Acceptance Criteria

1. THE Framework SHALL maintain a server-side session store (backed by PostgreSQL or an in-memory store with configurable adapters) that can revoke individual sessions by session ID within one request cycle.
2. WHEN a session is revoked, THE Framework SHALL immediately add the session ID to a revocation set checked on every authenticated request, preventing further use of the revoked session.
3. THE Framework SHALL write an audit trail entry for each of the following events: login success, login failure, logout, token refresh, session revocation, and permission denial.
4. WHEN an audit trail entry is written, THE Framework SHALL include the event type, actor user ID (or `anonymous`), IP address, user agent, timestamp, and outcome in a JSON record stored in a `street_audit_log` table.
5. THE Framework SHALL guarantee that audit trail writes are never silently dropped: IF the audit write fails, THEN the originating request SHALL be rolled back and a 500 error returned, preserving audit completeness.

---

## v1.5 — Background Processing

### Requirement 22: Job Queue and Cron Scheduler

**User Story:** As a developer, I want a built-in job queue and cron scheduler, so that I can run background tasks and periodic jobs without adding a separate queue service for simple use cases.

#### Acceptance Criteria

1. THE Framework SHALL provide a `JobQueue` class that enqueues jobs as rows in a `street_jobs` PostgreSQL table and executes them in FIFO order using `SELECT ... FOR UPDATE SKIP LOCKED`.
2. WHEN a job is enqueued, THE Framework SHALL assign it a unique job ID, record the job type, serialized payload, and enqueue timestamp.
3. THE Framework SHALL provide a `CronScheduler` that accepts standard 5-field cron expressions and executes the registered handler function on the correct schedule, using the server's configured timezone.
4. IF a cron expression is syntactically invalid, THEN THE Framework SHALL throw a `CronParseError` at scheduler registration time with the invalid expression and a description of the syntax error.
5. WHILE a cron job is executing, THE Framework SHALL not schedule the same job again for that tick even if execution takes longer than the scheduled interval (single-instance guard).

### Requirement 23: Delayed Jobs, Retry Policies, and Dead Letter Queues

**User Story:** As a developer, I want configurable delayed job execution, retry policies with backoff, and dead letter queues, so that I can build resilient background processing pipelines.

#### Acceptance Criteria

1. WHEN a job is enqueued with a `runAt` timestamp in the future, THE Framework SHALL not execute the job before that timestamp, polling for eligible jobs at a configurable interval (default: 1 second).
2. THE Framework SHALL support per-job-type retry policies with configurable maximum attempts, initial delay, backoff multiplier, and maximum delay (capped at 1 hour).
3. WHEN a job fails and the retry policy allows further attempts, THE Framework SHALL reschedule it with the computed backoff delay and increment the `attempt_count` field in the `street_jobs` table.
4. WHEN a job exhausts all retry attempts, THE Framework SHALL move it to a `street_dead_letter_queue` table, preserving the job ID, type, payload, final error message, and exhausted timestamp.
5. THE Framework SHALL ensure dead letter queues are bounded: WHERE a `maxDeadLetterEntries` limit is configured, THE Framework SHALL prune the oldest entries when the limit is exceeded.
6. FOR ALL retry sequences, the delay between attempt N and attempt N+1 SHALL equal `initialDelay * (backoffMultiplier ^ N)`, capped at `maxDelay` (geometric backoff invariant).

### Requirement 24: Workflow Engine

**User Story:** As a developer, I want a workflow engine for multi-step durable processes, so that I can define business workflows that survive process restarts and partial failures.

#### Acceptance Criteria

1. THE Framework SHALL provide a `WorkflowEngine` that executes workflows as sequences of named steps, persisting the current step index and step output to PostgreSQL after each successful step.
2. WHEN a workflow process is interrupted (crash, deployment), THE Framework SHALL resume the workflow from the last persisted step on restart without re-executing completed steps.
3. WHEN a workflow step fails, THE Framework SHALL execute the step's registered compensation function (if any) before propagating the failure to the workflow orchestrator (Saga compensation).
4. THE Framework SHALL support conditional branching in workflows via a `step.condition(ctx => boolean)` API that determines which branch executes based on runtime context.
5. IF a workflow step hangs beyond a configurable step timeout (default: 30 seconds), THEN THE Framework SHALL mark the step as `timed_out` and trigger the compensation function.

### Requirement 25: Distributed Jobs and Queue Monitoring

**User Story:** As an operator, I want distributed job execution across multiple worker processes and a monitoring interface for queue health, so that I can scale background processing horizontally.

#### Acceptance Criteria

1. THE Framework SHALL support multiple concurrent job worker processes selecting jobs from the shared `street_jobs` table without double-processing, using PostgreSQL advisory locks.
2. THE Framework SHALL expose queue metrics including jobs pending, jobs in-flight, jobs failed, jobs succeeded, and average execution time per job type via the `/api/jobs/metrics` endpoint.
3. WHEN `street jobs:dashboard` is executed, THE CLI SHALL display a live terminal dashboard showing queue depth, worker count, recent job history (last 50 entries), and dead letter queue depth, refreshed every 2 seconds.
4. THE Framework SHALL record job execution history in a `street_job_history` table retaining the last 1,000 entries per job type, pruning older records automatically.
5. IF a job worker process crashes, THEN THE Framework SHALL detect in-flight jobs assigned to the crashed worker via a heartbeat timeout and re-enqueue them for execution by another worker.

---

## v1.6 — API Platform

### Requirement 26: GraphQL Server

**User Story:** As a developer, I want a built-in GraphQL server, so that I can expose GraphQL APIs from a Street application without adding a separate GraphQL framework dependency.

#### Acceptance Criteria

1. THE Framework SHALL implement a GraphQL execution engine that parses GraphQL SDL schema definitions and executes queries, mutations, and subscriptions against registered resolver functions.
2. WHEN a GraphQL request is received, THE Framework SHALL validate the document against the schema before execution and return a well-formed error response for invalid documents per the GraphQL specification.
3. THE Framework SHALL implement query depth limiting and query complexity analysis, rejecting queries that exceed configurable `maxDepth` and `maxComplexity` thresholds with a 400 response.
4. THE Framework SHALL support GraphQL subscriptions over WebSocket using the `graphql-ws` protocol, integrating with the existing `StreetWebSocketServer`.
5. WHERE introspection is disabled via configuration, THE Framework SHALL return a 400 for any `__schema` or `__type` query, preventing schema exposure in production environments.
6. FOR ALL GraphQL query-response pairs, serializing the response to JSON and parsing it back SHALL produce a value structurally equivalent to the original response (round-trip property).

### Requirement 27: API Versioning

**User Story:** As a developer, I want built-in API versioning support, so that I can evolve the API without breaking existing clients.

#### Acceptance Criteria

1. THE Framework SHALL support URL path versioning (`/v1/`, `/v2/`) via a `@ApiVersion('v1')` decorator applied to controllers, routing requests to the correct versioned handler.
2. THE Framework SHALL support header-based versioning (`Accept: application/vnd.street.v2+json`) as an alternative to URL versioning, configurable per-application.
3. WHEN a request targets a version that has no registered handler, THE Framework SHALL return HTTP 404 with a JSON body listing available versions for that route path.
4. THE Framework SHALL generate separate OpenAPI spec files per API version, accessible at `/v1/openapi.json` and `/v2/openapi.json`.
5. WHEN a versioned route is marked as deprecated via `@Deprecated({ sunset: Date })`, THE Framework SHALL include a `Sunset` response header and a `Deprecation` header on all responses from that route.

### Requirement 28: SDK Generator

**User Story:** As a developer, I want automatic client SDK generation from the OpenAPI spec, so that consumers of the API get type-safe client libraries without manual maintenance.

#### Acceptance Criteria

1. WHEN `street generate sdk --lang typescript --output ./sdk` is executed, THE CLI SHALL generate a fully typed TypeScript client library from the project's OpenAPI spec with typed request/response interfaces and a `fetch`-based client class.
2. WHEN `street generate sdk --lang python --output ./sdk` is executed, THE CLI SHALL generate a Python client library using only the Python standard library with typed dataclasses for request/response models.
3. THE generated TypeScript SDK SHALL include an `ApiClient` class with methods named after each `operationId`, accepting typed request parameters and returning typed response objects.
4. FOR ALL generated SDK method calls, serializing the request parameters to JSON and deserializing the API response SHALL produce values structurally equivalent to the original request parameters and response (round-trip property).
5. WHEN the API spec changes (new route or modified schema), running the SDK generator again SHALL produce an updated SDK that is backward-compatible with clients using previously generated types, where the API change is itself backward-compatible.

### Requirement 29: Rate Limit Policies and API Analytics

**User Story:** As an operator, I want configurable rate limit policies per route and API analytics, so that I can protect the API from abuse and understand usage patterns.

#### Acceptance Criteria

1. THE Framework SHALL support per-route rate limit policies defined via a `@RateLimit({ requests: number, window: string, key: 'ip' | 'user' | 'apiKey' })` decorator, overriding the global rate limiter for that route.
2. WHEN a rate limit is exceeded, THE Framework SHALL return HTTP 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers.
3. THE Framework SHALL record API analytics events (route, method, status, duration, user ID or API key ID) in a `street_api_events` table, batching inserts to reduce write amplification.
4. WHEN `street analytics report --from <date> --to <date>` is executed, THE CLI SHALL query the analytics table and print a summary report showing top routes by request count, average latency, and error rate for the specified period.
5. THE Framework SHALL prune `street_api_events` records older than a configurable retention period (default: 90 days) via a background job to prevent unbounded table growth.

### Requirement 30: Webhook Management

**User Story:** As a developer, I want a webhook management system for sending and receiving signed webhooks, so that I can build event-driven integrations with external systems reliably.

#### Acceptance Criteria

1. THE Framework SHALL store webhook endpoint registrations (URL, event types, secret key) in a `street_webhook_endpoints` table and route events to matching endpoints on publication.
2. WHEN a webhook event is published, THE Framework SHALL sign the payload with HMAC-SHA256 using the endpoint's secret key and include the signature in a `X-Street-Signature` header.
3. THE Framework SHALL implement webhook delivery with at-least-once semantics, retrying failed deliveries with exponential backoff for up to 72 hours before moving the event to a dead letter state.
4. WHEN a webhook delivery request returns a non-2xx status, THE Framework SHALL record the response status and body (truncated to 1 KB) in the delivery log for debugging.
5. THE Framework SHALL validate incoming webhook requests by verifying the `X-Street-Signature` header against the registered secret, rejecting invalid signatures with HTTP 401.

---

## v1.7 — Multi-Tenancy

### Requirement 31: Tenant Isolation and Routing

**User Story:** As a developer, I want built-in multi-tenancy with tenant isolation, per-tenant databases, and tenant-aware middleware, so that I can build SaaS applications where one tenant cannot access another's data.

#### Acceptance Criteria

1. THE Framework SHALL provide a `TenantContext` that is populated per-request by a configurable tenant resolution strategy: subdomain (`tenant.app.com`), path prefix (`/tenant-slug/api`), or `X-Tenant-ID` header.
2. WHEN a request arrives without a resolvable tenant, THE Framework SHALL return HTTP 400 with `{ error: 'tenant_not_found' }` before executing any route handler.
3. THE Framework SHALL support per-tenant database connection pools where each tenant's requests are routed to a dedicated connection string registered in the `street_tenants` table.
4. WHEN a per-tenant database is used, THE Framework SHALL guarantee that no database query from one tenant's request can execute against another tenant's connection pool.
5. THE Framework SHALL provide a `@TenantScoped()` decorator for repository classes that automatically prepends a `tenant_id` filter to all queries, preventing cross-tenant data leakage in shared-database deployments.

### Requirement 32: Tenant Provisioning, Billing, and Quotas

**User Story:** As an operator, I want automated tenant provisioning, usage tracking, and configurable resource quotas, so that I can onboard tenants programmatically and enforce fair usage limits.

#### Acceptance Criteria

1. WHEN `TenantService.provision({ name, plan, adminEmail })` is called, THE Framework SHALL create the tenant record, run tenant-specific database migrations, configure the connection pool, and emit a `tenant:provisioned` event within a single atomic operation.
2. THE Framework SHALL track per-tenant resource usage metrics (request count, storage bytes, active connections, API calls per day) in a `street_tenant_usage` table, aggregated per billing period.
3. WHEN a tenant exceeds a configured quota (e.g., `maxRequestsPerDay`), THE Framework SHALL return HTTP 429 with `{ error: 'quota_exceeded', quota: string, limit: number, reset: string }` for subsequent requests until the period resets.
4. THE Framework SHALL emit a `tenant:quota:warning` event when a tenant reaches 80% of any quota, allowing the application to send notifications before hard limits are hit.
5. THE Framework SHALL expose a `TenantBillingAdapter` interface with a `reportUsage(tenantId, period, metrics)` method, allowing integration with billing platforms (Stripe, custom) via an adapter pattern without coupling the framework to a specific billing provider.

### Requirement 33: Tenant Metrics

**User Story:** As an operator, I want per-tenant observability metrics accessible via the monitoring infrastructure, so that I can identify noisy tenants and diagnose per-tenant incidents.

#### Acceptance Criteria

1. THE Framework SHALL label all Prometheus metrics with a `tenant_id` dimension when the application is running in multi-tenant mode.
2. THE Framework SHALL provide a `TenantMetricsRegistry` that maintains per-tenant counters and histograms in memory with a bounded maximum of 10,000 tenant entries, evicting least-recently-active tenants when the limit is exceeded.
3. WHEN `GET /admin/tenants/:id/metrics` is requested by an authenticated admin, THE Framework SHALL return the current usage statistics and quota status for the specified tenant.
4. THE Framework SHALL aggregate tenant metrics into a daily summary stored in `street_tenant_daily_stats`, enabling historical analysis without retaining raw event data indefinitely.

---

## v2.0 — Microservices

### Requirement 34: HTTP/2 and gRPC Support

**User Story:** As a developer, I want HTTP/2 and gRPC server support, so that I can build high-throughput microservice APIs with multiplexing and protocol buffer efficiency.

#### Acceptance Criteria

1. THE Framework SHALL provide an HTTP/2 server using `node:http2` that supports request multiplexing, header compression (HPACK), and server push, with TLS termination via `node:tls`.
2. THE Framework SHALL implement a gRPC server that parses protobuf service definitions (`.proto` files) and dispatches RPC calls to registered handler functions, supporting unary, server-streaming, client-streaming, and bidirectional-streaming RPC types.
3. WHEN a gRPC handler is registered with a proto definition, THE Framework SHALL generate TypeScript type definitions for request and response message types at build time via a `street generate grpc` command.
4. THE Framework SHALL support gRPC deadlines and cancellation: WHEN a client cancels an RPC, THE Framework SHALL propagate the cancellation signal to the handler via `ctx.signal` (AbortSignal).
5. THE Framework SHALL enforce gRPC max message size limits (configurable, default: 4 MB) and return a `RESOURCE_EXHAUSTED` status code for oversized messages.

### Requirement 35: Service Discovery and Circuit Breakers

**User Story:** As a developer, I want built-in service discovery and circuit breakers, so that I can build resilient microservice architectures that degrade gracefully under partial failures.

#### Acceptance Criteria

1. THE Framework SHALL provide a `ServiceRegistry` that supports static configuration and Consul/etcd discovery backends, resolving service instances by name to `{ host, port, healthStatus }` objects.
2. THE Framework SHALL implement the circuit breaker pattern with three states (Closed, Open, Half-Open) and configurable failure threshold, success threshold, and open timeout.
3. WHEN the circuit breaker transitions to Open state, THE Framework SHALL emit a `circuitbreaker:open` event with the service name, failure count, and timestamp.
4. WHEN the circuit breaker is Open and a request is made to the protected service, THE Framework SHALL immediately return a `CircuitOpenError` without making a network call.
5. IF a circuit breaker is in Half-Open state and the probe request fails, THEN THE Framework SHALL return immediately to Open state and reset the open timeout.
6. FOR ALL circuit breaker state transitions, the sequence SHALL follow the valid state machine: Closed → Open → Half-Open → Closed (or Half-Open → Open), and no other transitions SHALL be possible.

### Requirement 36: Message Queues and Event Bus

**User Story:** As a developer, I want a built-in event bus and message queue adapters, so that I can implement event-driven microservice communication with configurable transports.

#### Acceptance Criteria

1. THE Framework SHALL provide an `EventBus` with `publish(topic, payload)` and `subscribe(topic, handler)` methods, supporting in-process (default), Redis Pub/Sub, and RabbitMQ transport adapters.
2. WHEN a message is published to an external transport, THE Framework SHALL serialize it as JSON with an envelope containing `id` (UUID), `topic`, `timestamp`, `version`, and `payload` fields.
3. THE Framework SHALL guarantee at-least-once delivery for message queue transports by acknowledging messages only after the handler function returns successfully.
4. IF a message handler throws an exception, THEN THE Framework SHALL nack the message and apply the transport's retry policy without acknowledging it, preserving the message for redelivery.
5. THE Framework SHALL support dead letter routing for message queues: WHERE a dead letter topic is configured, messages exhausting all retries SHALL be routed there rather than dropped.

### Requirement 37: Saga Pattern, Distributed Locks, CQRS, and Event Sourcing

**User Story:** As a developer, I want framework-level primitives for distributed coordination patterns, so that I can implement complex microservice workflows without building these mechanisms from scratch.

#### Acceptance Criteria

1. THE Framework SHALL provide a `SagaOrchestrator` that executes a sequence of `{ action, compensation }` step pairs and runs compensation functions in reverse order on any step failure.
2. THE Framework SHALL implement distributed locks using PostgreSQL advisory locks (`pg_try_advisory_lock`) with a configurable timeout, providing a `DistributedLock.acquire(key, ttl)` API that returns a scoped lock handle.
3. WHEN a distributed lock is acquired, THE Framework SHALL release it automatically when the lock handle's `release()` method is called or when the lock TTL expires, whichever comes first, preventing deadlocks.
4. THE Framework SHALL provide a `CqrsModule` with separate `CommandBus` and `QueryBus`, dispatching commands to `CommandHandler` instances and queries to `QueryHandler` instances registered via the DI container.
5. THE Framework SHALL provide an `EventStore` backed by a `street_events` PostgreSQL table that appends immutable domain events, supporting aggregate event stream reads by aggregate ID and optimistic concurrency via expected version checks.
6. FOR ALL event store append operations, the sequence of events read back by aggregate ID SHALL equal the sequence in which they were appended (append-order invariant).

---

## v2.1 — Cloud Native

### Requirement 38: Container Orchestration and Cloud Runtime Adapters

**User Story:** As an operator, I want first-class support for Kubernetes, Cloud Run, ECS, and Nomad deployment targets, so that I can deploy Street applications to the most common container orchestration platforms with minimal configuration.

#### Acceptance Criteria

1. THE Framework SHALL generate environment-specific deployment manifests via `street deploy:init --platform <kubernetes|cloudrun|ecs|nomad>`, producing production-ready configuration files with resource limits, health probe paths, and environment variable references.
2. WHEN running on Kubernetes, THE Framework SHALL respond to `SIGTERM` by stopping the HTTP listener, draining in-flight requests, closing database connections, and exiting cleanly within a configurable grace period (default: 30 seconds).
3. THE Framework SHALL auto-detect the Cloud Run, ECS, and Nomad execution environments via platform-specific metadata environment variables and configure the port, logging format, and shutdown behavior accordingly.
4. THE Framework SHALL expose `/health/live` and `/health/ready` endpoints that conform to Kubernetes liveness and readiness probe contract semantics, as specified in Requirement 14.
5. WHERE the application is running on Cloud Run, THE Framework SHALL emit structured JSON logs to stdout in the format expected by Google Cloud Logging, including `severity`, `message`, `timestamp`, and `httpRequest` fields.

### Requirement 39: Secret Providers

**User Story:** As an operator, I want pluggable secret provider adapters for HashiCorp Vault, AWS Secrets Manager, and GCP Secret Manager, so that I can manage credentials centrally without hardcoding secrets in environment variables.

#### Acceptance Criteria

1. THE Framework SHALL provide a `SecretProvider` interface with a `get(key: string): Promise<string>` method and built-in adapters for HashiCorp Vault (KV v2), AWS Secrets Manager, and GCP Secret Manager.
2. WHEN a secret is fetched, THE Framework SHALL cache it in memory for a configurable TTL (default: 5 minutes) to avoid excessive provider round-trips while bounding secret staleness.
3. IF a secret provider is unavailable at startup, THEN THE Framework SHALL retry with exponential backoff for up to 60 seconds before exiting with code 1 and a descriptive error listing the failed secret keys.
4. THE Framework SHALL support secret rotation: WHEN a `SecretProvider` emits a `rotate` event or the cache TTL expires, THE Framework SHALL refresh the secret value and, where the secret is a database password, recycle affected connection pool connections gracefully.
5. THE Framework SHALL never log or serialize raw secret values; WHERE a secret appears in a log context, THE Framework SHALL replace its value with `[REDACTED]`.

### Requirement 40: Service Mesh and Auto Scaling Metrics

**User Story:** As an operator, I want service mesh compatibility and custom auto-scaling metrics, so that I can operate Street applications within Istio/Linkerd service meshes and export scaling signals to Kubernetes HPA.

#### Acceptance Criteria

1. THE Framework SHALL emit mTLS-compatible `ALPN` and connection metadata to allow transparent sidecar injection by Istio and Linkerd without application code changes.
2. THE Framework SHALL export custom auto-scaling metrics in the Kubernetes Custom Metrics API format (requests per second, active connections, queue depth) via a `/metrics/autoscale` endpoint compatible with the Kubernetes External Metrics API.
3. WHEN running in a service mesh environment detected via `ISTIO_META_MESH_ID` or `LINKERD_PROXY_INJECTION_ENABLED` environment variables, THE Framework SHALL disable its internal retry logic to avoid conflicts with the mesh's retry policies.
4. THE Framework SHALL support configurable readiness delay after startup to allow sidecars to initialize before the application begins accepting traffic (configurable via `STREET_READINESS_DELAY_MS`, default: 0).

### Requirement 41: Edge Runtime Support

**User Story:** As a developer, I want a Street-compatible edge runtime adapter, so that I can run Street application logic in edge environments (Cloudflare Workers, Deno Deploy) with the same API surface.

#### Acceptance Criteria

1. THE Framework SHALL provide an `@streetjs/edge` adapter package that maps the Street `StreetContext` API to the Web Fetch API `Request`/`Response` types used by Cloudflare Workers and Deno Deploy.
2. THE Framework SHALL provide a tree-shaking-compatible build of `@streetjs/core` that excludes Node.js-specific modules (`node:net`, `node:cluster`, `node:fs`) when bundled for edge targets.
3. WHEN deployed to an edge runtime, THE Framework SHALL support all routing, middleware, DI, and request/response features that do not depend on persistent TCP connections or the filesystem.
4. IF a feature requires Node.js-specific capabilities unavailable in the edge runtime, THEN THE Framework SHALL throw a `FeatureUnavailableInEdgeRuntimeError` with the feature name when that feature is initialized.

---

## v2.2 — Enterprise Platform

### Requirement 42: Feature Flags

**User Story:** As a developer, I want a built-in feature flag system, so that I can enable or disable features at runtime without redeployment and gradually roll out to users.

#### Acceptance Criteria

1. THE Framework SHALL provide a `FeatureFlagService` with an `isEnabled(flagName, context?)` method that evaluates flag state from a `street_feature_flags` database table.
2. THE Framework SHALL support flag targeting rules: WHERE a flag has targeting rules, THE Framework SHALL evaluate them in priority order and return `true` only for requests matching a rule (by user ID, role, percentage rollout, or environment).
3. WHEN a flag is evaluated for a percentage rollout, THE Framework SHALL use a stable hash of `flagName + userId` to assign users deterministically, ensuring the same user always sees the same variant.
4. THE Framework SHALL cache flag state in memory with a configurable TTL (default: 30 seconds) and support forced cache invalidation via an admin API endpoint.
5. IF a flag referenced in code does not exist in the database, THEN THE Framework SHALL return `false` and log a `warn`-level entry identifying the unknown flag name, rather than throwing an exception.

### Requirement 43: Audit Logging

**User Story:** As a compliance officer, I want comprehensive, tamper-evident audit logging for all security-relevant events, so that the system can demonstrate compliance with SOC 2, HIPAA, and GDPR audit requirements.

#### Acceptance Criteria

1. THE Framework SHALL provide an `AuditLogger` with predefined event categories: `auth`, `data_access`, `data_mutation`, `config_change`, `admin_action`, and `security_violation`.
2. WHEN a data mutation audit event is emitted, THE Framework SHALL record the before and after state of the affected record as JSON in the `street_audit_log` table, redacting fields annotated with `@Sensitive()`.
3. THE Framework SHALL sign each audit log batch with HMAC-SHA256 using a configurable signing key, enabling tamper detection by verifying the chain of batch signatures.
4. THE Framework SHALL enforce append-only semantics on the audit log: THE Framework SHALL not provide any API for deleting or updating audit log entries once written.
5. THE Framework SHALL support streaming audit log export via `street audit:export --from <date> --to <date> --format <jsonl|csv>` for compliance reporting.

### Requirement 44: Data Retention, Encryption Policies, and Data Classification

**User Story:** As a compliance engineer, I want declarative data retention policies, field-level encryption, and data classification labels, so that I can enforce GDPR, CCPA, and HIPAA data governance requirements in code.

#### Acceptance Criteria

1. THE Framework SHALL provide a `@RetainFor(duration: string)` decorator for entity fields that configures automated deletion of records containing that field after the specified retention period.
2. THE Framework SHALL provide a `@Encrypt()` decorator for entity fields that transparently encrypts the field value with AES-256-GCM using the vault key before persisting and decrypts it on retrieval.
3. THE Framework SHALL provide a `@Classify(level: 'public' | 'internal' | 'confidential' | 'restricted')` decorator for entity fields, enabling classification-aware logging that redacts fields above the configured log classification threshold.
4. WHEN the retention policy background job runs, THE Framework SHALL delete all records where the `created_at` date plus the retention period is in the past, operating in bounded batches of configurable size to avoid long-running deletes.
5. THE Framework SHALL generate a data classification report via `street compliance:report` listing all entity fields, their classification levels, encryption status, and retention policies.

### Requirement 45: Backup Framework and Disaster Recovery

**User Story:** As an operator, I want a built-in backup framework with point-in-time recovery support, so that I can meet RTO and RPO requirements without managing backup infrastructure manually.

#### Acceptance Criteria

1. THE Framework SHALL provide a `BackupService` that triggers PostgreSQL logical backups using `pg_dump` via the wire protocol and streams the output to a configurable storage adapter (local filesystem, S3, GCS).
2. WHEN a backup completes, THE Framework SHALL record the backup ID, size, duration, checksum, and storage location in a `street_backups` table.
3. THE Framework SHALL support scheduled backups via a cron expression configured in `street.config.ts`, running the backup job in the background without blocking request serving.
4. WHEN `street restore --backup-id <id>` is executed, THE CLI SHALL retrieve the backup from the configured storage adapter, verify its checksum, and restore it to the configured target database.
5. IF a backup checksum verification fails, THEN THE CLI SHALL abort the restore operation, print the expected and actual checksums, and exit with code 1 without modifying the target database.

---

## v3.0 — Next Generation

### Requirement 46: Distributed Cache and Global Config Service

**User Story:** As a developer, I want a distributed cache with multi-node invalidation and a globally replicated configuration service, so that I can build stateless application tiers that share state efficiently.

#### Acceptance Criteria

1. THE Framework SHALL provide a `DistributedCache` with Redis and Memcached adapters, exposing the same `get`, `set`, `delete`, and `invalidate` API as the existing `LruCache<K,V>`.
2. WHEN a cache entry is invalidated on one node, THE Framework SHALL propagate the invalidation to all other nodes within 100 milliseconds using pub/sub invalidation channels.
3. THE Framework SHALL provide a `GlobalConfigService` backed by a distributed store (etcd or PostgreSQL with LISTEN/NOTIFY) that propagates configuration changes to all running instances within 500 milliseconds.
4. WHEN a configuration key is updated via `GlobalConfigService.set(key, value)`, THE Framework SHALL emit a `config:changed` event on all connected instances with the key, old value, and new value.
5. THE Framework SHALL ensure the distributed cache is bounded: WHERE a `maxMemoryMb` limit is configured on the adapter, THE Framework SHALL apply an LRU eviction policy to maintain the bound.

### Requirement 47: Event Streaming and Realtime Analytics

**User Story:** As a developer, I want built-in event streaming with Kafka and Kinesis adapters and realtime analytics aggregation, so that I can build data pipelines and live dashboards without external stream processing infrastructure.

#### Acceptance Criteria

1. THE Framework SHALL provide an `EventStreamPublisher` with Kafka, AWS Kinesis, and in-process adapters, serializing events using the same envelope format defined in Requirement 36.
2. THE Framework SHALL provide an `EventStreamConsumer` that reads from Kafka topics or Kinesis shards and dispatches events to registered handlers with configurable consumer group semantics.
3. THE Framework SHALL provide a `RealtimeAggregator` that computes sliding-window aggregations (count, sum, average, min, max) over event streams in memory, publishing aggregate results to SSE subscribers.
4. IF the event stream consumer falls behind by more than a configurable lag threshold, THEN THE Framework SHALL emit a `stream:lag` warning event with the consumer group name and current lag in messages.
5. FOR ALL events published and then consumed, the deserialized event payload SHALL be structurally equivalent to the original published payload (round-trip property).

### Requirement 48: Multi-Region Replication

**User Story:** As an operator, I want multi-region deployment support with active-passive and active-active replication modes, so that I can build globally available applications with low latency for geographically distributed users.

#### Acceptance Criteria

1. THE Framework SHALL provide a `ReplicationCoordinator` that manages active-passive database replication, routing all write queries to the primary region and read queries to the nearest replica based on configured region weights.
2. WHEN the primary region becomes unavailable, THE Framework SHALL detect the failure within 10 seconds via health checks and promote a replica to primary, updating the routing table for all connected workers.
3. THE Framework SHALL support active-active replication for conflict-tolerant data via a last-write-wins strategy with vector clocks, ensuring eventual consistency across regions.
4. THE Framework SHALL expose region-aware request routing: WHEN a request includes an `X-Preferred-Region` header, THE Framework SHALL route it to the specified region's endpoint if available, falling back to the default region.
5. THE Framework SHALL track replication lag per replica in the Prometheus metrics as `db_replication_lag_seconds` labeled by `region` and `replica_id`.

### Requirement 49: AI Infrastructure Toolkit and Native Agent Framework

**User Story:** As a developer, I want first-class AI/LLM integration primitives and an agent framework, so that I can build production AI-powered APIs with streaming, tool calling, and memory without third-party AI frameworks.

#### Acceptance Criteria

1. THE Framework SHALL provide an `LlmClient` interface with adapters for OpenAI, Anthropic, and Ollama APIs, supporting both blocking and streaming (SSE) response modes.
2. THE Framework SHALL provide a `ToolRegistry` for registering typed tool functions that an LLM agent can invoke, with automatic JSON Schema generation from TypeScript function signatures.
3. THE Framework SHALL provide an `AgentExecutor` that implements a ReAct-style think/act loop, invoking registered tools and feeding results back to the LLM until a final answer is produced or a configurable step limit is reached.
4. THE Framework SHALL bound memory usage in agent executions: WHEN an agent conversation history exceeds a configurable token limit, THE Framework SHALL summarize older messages using the LLM to stay within bounds.
5. IF the LLM provider returns a rate limit error (HTTP 429), THEN THE Framework SHALL retry with exponential backoff, propagating the delay as a `Retry-After` header on the API response.
6. THE Framework SHALL stream agent intermediate steps to the client via SSE, emitting `{ type: 'thought' | 'action' | 'observation' | 'final', content: string }` events.

### Requirement 50: Plugin Marketplace and Extension SDK

**User Story:** As a developer, I want a verified plugin marketplace and a first-class extension SDK, so that I can share and consume community-built Street plugins with confidence in quality and security.

#### Acceptance Criteria

1. THE Framework SHALL provide an `ExtensionSDK` with `PluginModule` base class, lifecycle hooks (`onInstall`, `onLoad`, `onUnload`), and access to a sandboxed subset of the framework API (routes, DI container, middleware pipeline, event bus).
2. WHEN a plugin is loaded via `app.use(plugin)`, THE Framework SHALL isolate the plugin in a separate module scope and prevent it from accessing or modifying the core framework internals not exposed by the `ExtensionSDK`.
3. THE Framework SHALL provide a `street plugin:install <name>@<version>` CLI command that fetches the plugin from the marketplace registry, verifies its checksum and marketplace signature, and installs it to the `plugins/` directory.
4. IF a plugin's marketplace signature is invalid or the checksum does not match, THEN THE CLI SHALL refuse to install it, print the verification failure details, and exit with code 1.
5. THE Framework SHALL provide a plugin health check mechanism: WHEN `street plugin:list` is executed, THE CLI SHALL show each installed plugin's name, version, marketplace verification status, and load status (loaded/failed/disabled).
6. FOR ALL plugins that implement the `onLoad` and `onUnload` lifecycle hooks, calling `onLoad` followed by `onUnload` on a fresh application instance SHALL restore the application to its pre-load state (round-trip property).

---

## Cross-Cutting Requirements

### Requirement 51: Absolute Implementation Policy

**User Story:** As a project maintainer, I want every shipped version to meet a comprehensive quality gate, so that the Street Framework maintains its production-grade reputation across all releases.

#### Acceptance Criteria

1. THE Framework SHALL not ship any version containing TypeScript `TODO`, `FIXME`, `HACK`, or `@ts-ignore` comments in production source files under `src/`.
2. WHEN a new version is released, THE Framework SHALL include passing integration tests executed against real database instances (not mocks) for every database-touching feature in that version.
3. WHEN a new version is released, THE Framework SHALL include a security audit report confirming no SQL injection, XSS, CSRF, SSRF, DoS, or memory exhaustion vulnerabilities in the features added by that version.
4. WHEN a new version is released, THE Framework SHALL include benchmark results comparing throughput and p99 latency against Express, Fastify, NestJS, Hono, Fiber, and Gin for the primary request-handling path.
5. WHEN a new version is released, THE Framework SHALL include complete documentation covering Getting Started, User Guide, API Reference, CLI Reference, Security Guide, Migration Guide, Troubleshooting, and Examples for all new features.
6. THE Framework SHALL enforce memory bounds on all internal data structures: THE Framework SHALL not allow queues, caches, event listener sets, connection pools, or ring buffers to grow without a configured maximum size.
7. WHEN a version is released, THE Framework SHALL pass all existing tests from previous versions without regression, verifying backward compatibility of public APIs.
