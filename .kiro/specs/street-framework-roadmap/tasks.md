# Implementation Tasks: Street Framework Roadmap v1.1 – v3.0

- [x] 1. v1.1 — Hot Reload Development Server
  - [x] 1.1 Create `packages/core/src/dev/watcher.ts` with `DevWatcher` class: `FSWatcher` handle management, `WatcherOptions` interface, `start()` and `stop()` methods, stores all watcher handles in an array for cleanup
  - [x] 1.2 Implement incremental TypeScript compilation in `DevWatcher`: spawn `tsc --incremental` as a child process, capture stdout/stderr, return boolean success/failure from `compile()`
  - [x] 1.3 Implement graceful server restart in `DevWatcher.restartServer()`: send `SIGTERM` to the current server process, wait for drain up to `drainTimeoutMs` (default 5000ms), then spawn fresh process
  - [x] 1.4 Wire `DevWatcher` into `packages/cli/src/commands/dev.ts`: read `--watch` flag, instantiate `DevWatcher`, call `start()`, register `SIGINT`/`SIGTERM` handlers that call `stop()`
  - [x] 1.5 Write integration tests in `packages/cli/src/tests/dev.test.ts`: verify FSWatcher handles are closed on stop, verify recompile triggers on file save, verify error output on type errors keeps previous server running
  - [x] 1.6 Export `DevWatcher` and `WatcherOptions` from `packages/core/src/index.ts`

- [x] 2. v1.1 — Code Generators (middleware, gateway, migration)
  - [x] 2.1 Create generator templates in `packages/cli/templates/generate/`: `middleware.ts.tpl`, `gateway.ts.tpl`, `migration-up.sql.tpl`, `migration-rollback.sql.tpl`
  - [x] 2.2 Implement `generateMiddleware(name, cwd)` in `packages/cli/src/commands/generate.ts`: validate name with `/^[a-z][a-z0-9_-]*$/`, check target file existence (exit 1 if exists), write typed `StreetMiddleware` function scaffold to `src/middleware/<name>.middleware.ts`
  - [x] 2.3 Implement `generateGateway(name, cwd)`: write `@Injectable()` + `@WebSocketGateway` scaffold with `onConnect`, `onMessage`, `onDisconnect` handlers to `src/gateways/<name>.gateway.ts`
  - [x] 2.4 Implement `generateMigration(name, cwd)`: create timestamped `migrations/<timestamp>_<name>.sql` and `migrations/<timestamp>_<name>.rollback.sql` files
  - [x] 2.5 Extend `GenerateCommand.execute()` switch to route `middleware`, `gateway`, `migration` sub-types to their respective functions
  - [x] 2.6 Write tests in `packages/cli/src/tests/generate.test.ts`: verify each generator creates the correct files, verify exit 1 on duplicate, verify name validation rejects uppercase/special chars

- [x] 3. v1.1 — Configuration Validation Engine
  - [x] 3.1 Create `packages/core/src/config/validator.ts`: define `FieldType` union (`string | number | boolean | url | port`), `ConfigFieldDef` interface, `ConfigSchema` type, `ConfigResult<S>` mapped type
  - [x] 3.2 Implement `defineConfig<S extends ConfigSchema>(schema: S): ConfigResult<S>`: reads `process.env`, validates each field against its type and constraints, collects ALL errors before throwing, throws `ConfigValidationError` with the full error list
  - [x] 3.3 Implement `ConfigValidationError` class extending `Error` with `errors: string[]` property
  - [x] 3.4 Add `url` type validation (uses `new URL()`) and `port` type validation (integer 1–65535) to the field validator
  - [x] 3.5 Apply default values only when the variable is absent; treat present-but-invalid values as errors regardless of default
  - [x] 3.6 Export `defineConfig` and `ConfigValidationError` from `packages/core/src/index.ts`
  - [x] 3.7 Write unit tests covering: missing required field, invalid port range, malformed URL, default applied on absent var, error on present-but-invalid var, multi-error collection

- [x] 4. v1.1 — Enhanced Error Diagnostics
  - [x] 4.1 Create `packages/core/src/diagnostics/reporter.ts`: `DiagnosticsReporter` class extending `EventEmitter`, `DiagnosticEvent` interface with `errorClass`, `message`, `stack[]`, `correlationId`, `ts` fields
  - [x] 4.2 Implement `DiagnosticsReporter.report(err, correlationId?)`: serialize to JSON, strip Node.js internal frames (filter lines matching `/node:internal|node_modules\/node/`), emit `diagnostic` event, write to `process.stderr`
  - [x] 4.3 Replace `console.error` in `packages/core/src/router/router.ts`'s `errorHandler` with `DiagnosticsReporter.report()`
  - [x] 4.4 Enrich `Container.resolve()` error message with the full dependency chain on resolution failure: `"Cannot resolve X → Y → Z: <reason>"`
  - [x] 4.5 Add `DatabaseConnectionError` class to `packages/core/src/http/exceptions.ts` with a `suggestion` field; throw it from `PgPool.initialize()` on `ECONNREFUSED` with relevant env var names
  - [x] 4.6 Export `DiagnosticsReporter` and `DiagnosticEvent` from `packages/core/src/index.ts`
  - [x] 4.7 Write tests: verify `diagnostic` event fires on unhandled route error, verify stack frames are cleaned, verify dependency chain appears in DI error messages

- [x] 5. v1.1 — CLI Operational Commands (info, doctor, env validate, audit)
  - [x] 5.1 Create `packages/cli/src/commands/info.ts` with `InfoCommand`: read `package.json` for Street version, read `process.version` for Node, detect TypeScript version from `node_modules/typescript/package.json`, print aligned table
  - [x] 5.2 Create `packages/cli/src/commands/doctor.ts` with `DoctorCommand`: check Node.js >= 20, TypeScript >= 5.0, required env vars from `.env.example`, attempt DB connectivity ping via `PgConnection.connect()`; print ✓/✗ per check with versions and upgrade hints
  - [x] 5.3 Create env-validate logic in `DoctorCommand` (or separate `EnvValidateCommand`): dynamic-import `street.config.ts` from the project root, call `defineConfig()`, report per-variable pass/fail, exit code 0 or 1
  - [x] 5.4 Create `packages/cli/src/commands/audit.ts` with `AuditCommand`: spawn `npm audit --json`, parse JSON output, format CVE findings as a table with package name, severity, and fix recommendation
  - [x] 5.5 Register all new commands (`info`, `doctor`, `env`, `audit`) in `packages/cli/src/index.ts` switch
  - [x] 5.6 Write tests for `InfoCommand` (reads correct versions), `DoctorCommand` (detects old Node version as failure), `AuditCommand` (parses npm audit JSON output)


- [x] 6. v1.2 — MySQL Wire Protocol Driver
  - [x] 6.1 Create `packages/core/src/database/mysql/wire.ts`: implement MySQL Client/Server Protocol v4.1 handshake over `node:net`; parse server greeting packet (capabilities, server version, auth plugin)
  - [x] 6.2 Implement `mysql_native_password` authentication: `SHA1(password) XOR SHA1(seed + SHA1(SHA1(password)))` using `node:crypto`
  - [x] 6.3 Implement `caching_sha2_password` authentication: full SHA-256 challenge-response using `node:crypto`
  - [x] 6.4 Implement `MysqlConnection.query(sql, params)`: use parameterized COM_STMT_PREPARE + COM_STMT_EXECUTE; return `DbResult { rows, rowCount, command }`
  - [x] 6.5 Implement `MysqlConnection.queryStream(sql)`: return a `Readable` that emits row objects with backpressure via `socket.pause()`/`socket.resume()`
  - [x] 6.6 Create `packages/core/src/database/mysql/pool.ts` with `MysqlPool`: same min/max/acquire/idle-sweep API as `PgPool`
  - [x] 6.7 Create `packages/core/src/database/mysql/mariadb.ts`: `MariaDbConnection` subclass handling MariaDB-specific capability flags; `MysqlConnection.connect()` detects server greeting and returns the appropriate subclass
  - [x] 6.8 Write integration tests against a real MySQL instance: connection, simple query, parameterized query, transaction commit, transaction rollback, concurrent queries
  - [x] 6.9 Export `MysqlConnection`, `MysqlPool`, `MariaDbConnection` from `packages/core/src/index.ts`

- [x] 7. v1.2 — SQLite Driver (WASM worker)
  - [x] 7.1 Bundle a SQLite WASM binary (`sqlite3.wasm`) into `packages/core/src/database/sqlite/`; document the source and build steps in `CONTRIBUTING.md`
  - [x] 7.2 Create `packages/core/src/database/sqlite/worker.ts`: load and instantiate the WASM module inside a `node:worker_threads` worker; handle `query` and `transaction` messages via `MessageChannel`
  - [x] 7.3 Create `packages/core/src/database/sqlite/pool.ts` with `SqlitePool`: constructor accepts `{ filePath, maxWorkers? }`; routes queries to available worker threads; supports `query()` and `transaction()` methods
  - [x] 7.4 Implement `DbResult` as a shared type across all three drivers (PG, MySQL, SQLite) in `packages/core/src/database/types.ts`; update existing `PgResult` to be an alias
  - [x] 7.5 Write integration tests against a real SQLite file: create table, insert, query, transaction rollback, concurrent reads
  - [x] 7.6 Export `SqlitePool` from `packages/core/src/index.ts`

- [x] 8. v1.2 — Type-Safe Query Builder
  - [x] 8.1 Create `packages/core/src/database/query-builder.ts` with `QueryBuilder<T extends object>` class: internal AST state with arrays for `selects`, `wheres`, `joins`, `orderBys`, `groupBys`, `havings`; `limit` and `offset` number fields
  - [x] 8.2 Implement all fluent methods: `select()`, `from()`, `where()`, `join()`, `leftJoin()`, `orderBy()`, `groupBy()`, `having()`, `limit()`, `offset()`, `subquery()`; each returns `this`
  - [x] 8.3 Implement `build()`: render all accumulated state into `{ sql: string; params: unknown[] }` with positional `$1`/`?` placeholders per `SqlDialect` enum
  - [x] 8.4 Add compile-time column name enforcement: `select(...cols: (keyof T & string)[])` and `where()` column parameter typed as `keyof T & string`; non-existent column produces a TypeScript error
  - [x] 8.5 Implement idempotent build: calling `build()` twice on the same unmodified builder produces identical output
  - [x] 8.6 Write tests: select with where and limit, join with subquery, idempotent build, parameterized placeholder count matches params array length, dialect-specific placeholder style

- [x] 9. v1.2 — Schema Introspection
  - [x] 9.1 Create `packages/core/src/database/schema-inspector.ts`: define `ColumnMeta`, `IndexMeta`, `FkMeta`, `TableSchema`, `DatabaseSchema` interfaces
  - [x] 9.2 Implement PostgreSQL introspection queries: batch `information_schema.columns`, `pg_indexes`, `information_schema.table_constraints`, `information_schema.referential_constraints` into minimal round-trips; complete within 1 second for 500-table schemas
  - [x] 9.3 Implement MySQL introspection queries using `information_schema` catalog tables
  - [x] 9.4 Implement SQLite introspection using `PRAGMA table_info()`, `PRAGMA index_list()`, `PRAGMA foreign_key_list()`
  - [x] 9.5 Implement result caching: `Map<pool, { schema: DatabaseSchema; expiresAt: number }>` with 60-second default TTL; `invalidateCache(pool)` removes the entry
  - [x] 9.6 Write integration tests: inspect a known schema, verify all column types and nullable flags, verify 60s cache TTL, verify invalidation forces re-fetch

- [x] 10. v1.2 — Migration Diffing, Seeding, Query Profiling, and Connection Diagnostics
  - [x] 10.1 Create `packages/core/src/database/migrations.ts` additions: `MigrationDiffer.diff(pool, entities)` reads live schema via `SchemaInspector`, compares to entity decorator metadata, returns `{ safe: string[], destructive: string[] }`
  - [x] 10.2 Add `street migrate:diff` CLI command: call `MigrationDiffer.diff()`, write generated SQL to timestamped file; require `--confirm-destructive` flag before writing any destructive statements
  - [x] 10.3 Create `packages/core/src/database/seeder.ts` with `StreetSeeder.run(pool, seedFile)`: wrap execution in `pool.transaction()`; track runs in `street_seed_runs` table using file content hash; skip already-applied seeds
  - [x] 10.4 Add `street db:seed <file>` CLI command wired to `StreetSeeder`
  - [x] 10.5 Create `packages/core/src/database/profiler.ts` with `QueryProfiler`: ring buffer of 10,000 `QueryRecord` entries; `enable(pool)` wraps `pool.query()` with a timing decorator via composition (no prototype patching); `getSlowQueries(thresholdMs)` returns sorted results
  - [x] 10.6 Implement `ConnectionDiagnostics.ping(pool)`: send `SELECT 1` and measure round-trip; `poolStats(pool)` returns `{ total, idle, inUse, waiting, avgAcquireMs }`
  - [x] 10.7 Emit `pool:exhausted` event on `PgPool`'s internal `EventEmitter` before enqueueing a wait request when the pool is full
  - [x] 10.8 Write tests: seed runs are idempotent (same hash → skip), diff detects added column, profiler records slow queries, `pool:exhausted` fires on pool saturation


- [x] 11. v1.3 — OpenTelemetry Integration
  - [x] 11.1 Create `packages/core/src/observability/otel.ts`: define `SpanContext`, `Span`, and `OtelTracer` interfaces; implement span lifecycle (`startSpan`, `end`) with `process.hrtime.bigint()` timing
  - [x] 11.2 Implement W3C `traceparent` header parsing in `OtelTracer.extractContext()` and injection in `OtelTracer.injectContext()` per the W3C Trace Context spec
  - [x] 11.3 Implement OTLP HTTP exporter in `OtelTracer`: serialize spans to OTLP JSON format, POST to `OTEL_EXPORTER_OTLP_ENDPOINT` using `node:https`; batch up to 1,000 spans; flush every 5 seconds
  - [x] 11.4 Implement retry with exponential backoff on OTLP export failure; emit a single `warn` log per drop event when the buffer overflows
  - [x] 11.5 Create `otelMiddleware(tracer)` factory: extract context from `traceparent`, start HTTP span, call `next()`, end span with response status; store span in `ctx.state['otelSpan']`
  - [x] 11.6 Instrument `PgPool.query()` to create a child span when `ctx.state['otelSpan']` is present; span attributes: `db.system`, `db.statement`, duration
  - [x] 11.7 Call `OtelTracer.flush()` during graceful shutdown (before pool close) to drain buffered spans
  - [x] 11.8 Export `OtelTracer`, `otelMiddleware`, `SpanContext` from `packages/core/src/index.ts`
  - [x] 11.9 Write integration tests: parent-child span relationship is correct, `traceparent` round-trip, buffer capped at 1,000, flush called on shutdown

- [x] 12. v1.3 — Structured Logging
  - [x] 12.1 Create `packages/core/src/observability/logger.ts`: `Logger` class, `LogLevel` type, `LogEntry` interface with `timestamp`, `level`, `message`, `correlationId`, `service` fields
  - [x] 12.2 Implement `Logger.debug/info/warn/error(msg, meta?)`: serialize to JSON `LogEntry` and write to `outputStream` (default `process.stderr`); suppress entries below configured `level`
  - [x] 12.3 Implement `Logger.child(bindings)`: return a new `Logger` instance with bindings merged into every entry; used for per-request loggers with `correlationId` pre-set
  - [x] 12.4 Implement `Error` serialization: if any `meta` value is an `Error` instance, replace it with `{ name, message, stack }` before `JSON.stringify`
  - [x] 12.5 Implement dev pretty-formatter: when `NODE_ENV=development`, output colorized single-line text to the terminal in addition to JSON to `outputStream`
  - [x] 12.6 Create `correlationMiddleware(logger)`: generate UUID v4 correlation ID or extract from `X-Correlation-ID` header; store in `ctx.state['correlationId']`; create child logger in `ctx.state['logger']`; set `X-Correlation-ID` response header
  - [x] 12.7 Make `Logger` injectable via the DI container by decorating it with `@Injectable()`
  - [x] 12.8 Export `Logger`, `LogLevel`, `LogEntry`, `correlationMiddleware` from `packages/core/src/index.ts`
  - [x] 12.9 Write tests: JSON output structure, level filtering, Error serialization, correlation ID propagation to child logger, pretty formatter in dev mode

- [x] 13. v1.3 — Prometheus Metrics Exporter
  - [x] 13.1 Create `packages/core/src/observability/prometheus.ts`: `MetricsRegistry`, `Counter`, `Gauge`, `Histogram` classes; `MetricConflictError` exception
  - [x] 13.2 Implement `Counter.inc(labels?, value?)`, `Gauge.set(value, labels?)`, `Histogram.observe(value, labels?)`: store label-keyed values in `Map<string, number>` (synchronous, event-loop-safe)
  - [x] 13.3 Implement `MetricsRegistry.collect()`: render all registered metrics to Prometheus text exposition format 0.0.4 with correct `# HELP`, `# TYPE`, and metric lines; return as `string`
  - [x] 13.4 Register default metrics: `http_requests_total` (counter), `http_request_duration_seconds` (histogram with buckets 0.005–10), `process_heap_bytes` (gauge), `db_pool_connections` (gauge) in `prometheusMiddleware(registry, pool?)`
  - [x] 13.5 Throw `MetricConflictError` synchronously at registration time if a metric name is already registered
  - [x] 13.6 Register `GET /metrics` route in `StreetApp` when `prometheusMiddleware` is used; set correct `Content-Type` header
  - [x] 13.7 Export `MetricsRegistry`, `prometheusMiddleware`, `MetricConflictError` from `packages/core/src/index.ts`
  - [x] 13.8 Write tests: Prometheus text format is valid, concurrent scrapes produce consistent snapshots, conflict detection, default metrics are present

- [x] 14. v1.3 — Health Check DSL
  - [x] 14.1 Create `packages/core/src/observability/health.ts`: `HealthCheckRegistry`, `CheckFn`, `CheckResult`, `HealthResponse`, `CheckType` types
  - [x] 14.2 Implement `HealthCheckRegistry.addCheck(name, fn, opts)`: store checks in a `Map<string, { fn, type, timeoutMs }>`
  - [x] 14.3 Implement `HealthCheckRegistry.runLiveness()` and `runReadiness()`: execute all matching checks in parallel with `Promise.allSettled()`; wrap each in `Promise.race([fn(), timeoutPromise])`; mark any that reject or time out as `down`; return `HealthResponse`
  - [x] 14.4 Create `registerHealthRoutes(app, registry)`: register `GET /health/live` and `GET /health/ready` on `StreetApp`; respond 200 on all `up`, 503 on any `down`
  - [x] 14.5 Export `HealthCheckRegistry`, `registerHealthRoutes`, `CheckResult` from `packages/core/src/index.ts`
  - [x] 14.6 Write tests: all-up returns 200, one-down returns 503 with body listing the failed check, timed-out check marked `down`, thrown exception caught and marked `down`

- [x] 15. v1.3 — Request Profiler and Diagnostics Dashboard
  - [x] 15.1 Create `packages/core/src/diagnostics/route-profiler.ts` with `RouteProfiler`: `Map<routeKey, CircularBuffer<LatencySample>>` capped at 10,000 samples per route; `record(method, pattern, latencyNs, isError)` and `stats(method, pattern)` returning `RouteStats` with P50/P95/P99
  - [x] 15.2 Integrate `RouteProfiler` into the `Router.dispatch()` path: record latency after every dispatched request
  - [x] 15.3 Create `packages/core/src/diagnostics/socket-server.ts` with `DiagnosticsServer`: listen on Unix domain socket `/tmp/street-<pid>.sock`; accept connections; push JSON snapshots from `RouteProfiler` and `process.memoryUsage()` every 1 second
  - [x] 15.4 Create `packages/cli/src/commands/diagnostics.ts`: connect to the running process's Unix socket (detect PID from `--pid` flag or environment); render live terminal table with ANSI escape sequences; refresh every 1 second
  - [x] 15.5 Implement stale socket detection in the CLI: check if the PID is alive via `process.kill(pid, 0)`; if not, remove the stale socket file and print a warning
  - [x] 15.6 Ensure `DiagnosticsServer.stop()` removes the socket file and closes all client connections
  - [x] 15.7 Write tests: ring buffer caps at 10,000 samples, P99 is calculated correctly, socket server sends JSON on connection, stale socket is cleaned up


- [x] 16. v1.4 — OAuth2 and OpenID Connect
  - [x] 16.1 Create `packages/core/src/auth/oauth2.ts`: `OAuthProvider`, `OAuthProfile`, `OAuthTokens`, `OAuthSuccessCallback` interfaces; `OAuthManager` class
  - [x] 16.2 Implement PKCE generation: `code_verifier` = 32 random bytes as base64url; `code_challenge` = `S256` (SHA-256 of verifier) using `node:crypto`; store both in the encrypted session before redirect
  - [x] 16.3 Implement `OAuthManager.authorizationUrl(provider)`: construct the provider's authorization URL with `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, and `code_challenge` params
  - [x] 16.4 Implement `OAuthManager.handleCallback(provider, code, state, sessionState, codeVerifier)`: validate `state` with `timingSafeEqual`, exchange code for tokens at provider's token endpoint via `node:https`
  - [x] 16.5 Create `JwksCache` class: fetch provider JWKS on first use, cache for 5 minutes, serve from cache on subsequent calls; fall back to cached keys for up to 5 minutes if provider is unreachable
  - [x] 16.6 Implement OIDC ID token validation: decode JWT header to get `kid`, look up public key in `JwksCache`, verify RS256/ES256 signature using `node:crypto`'s `verify()`; enforce `exp`, `aud`, `iss` claims
  - [x] 16.7 Create built-in provider configs for Google (`accounts.google.com`), GitHub (`github.com`), and Microsoft (`login.microsoftonline.com`)
  - [x] 16.8 Write `oauth2.test.ts` integration tests: PKCE code challenge matches verifier, state round-trip, invalid state rejected with 400, JWKS cache serves stale on provider failure

- [x] 17. v1.4 — API Keys
  - [x] 17.1 Create `packages/core/src/auth/api-keys.ts` with `ApiKeyService` class, `ApiKey` interface; write `street_api_keys` migration SQL file
  - [x] 17.2 Implement `ApiKeyService.generate(opts)`: generate `randomBytes(32).toString('base64url')` prefixed with configurable namespace; store `createHash('sha256').update(rawKey).digest('hex')` in DB; return the raw key once only
  - [x] 17.3 Implement `ApiKeyService.verify(rawKey)`: compute SHA-256 hash; query DB for matching hash; use `timingSafeEqual` with equal-length check; check `expiresAt`; use `LruCache` for 60-second result caching
  - [x] 17.4 Implement `ApiKeyService.revoke(id)`: delete from DB; remove from `LruCache` immediately
  - [x] 17.5 Create `apiKeyMiddleware(service)`: extract `Authorization: Bearer <key>`, call `service.verify()`, set `ctx.user`; throw `UnauthorizedException` on invalid/expired key
  - [x] 17.6 Write tests: key generation produces correct prefix, only hash stored in DB, timing-safe comparison, revocation invalidates cache, expired key returns 401

- [x] 18. v1.4 — Refresh Tokens and Token Rotation
  - [x] 18.1 Create `packages/core/src/auth/refresh-tokens.ts` with `RefreshTokenService`; write `street_refresh_tokens` migration SQL
  - [x] 18.2 Implement `RefreshTokenService.issue(userId, familyId?)`: generate new `familyId` (if not provided) from `randomBytes(16)`, issue access token (15 min) and refresh token (30 days), store only SHA-256 hash of refresh token
  - [x] 18.3 Implement `RefreshTokenService.rotate(rawRefreshToken)`: inside a single `pool.transaction()`: hash the token, find and verify it, check `revoked_at IS NULL`; if already revoked → call `revokeFamily()` and throw `TokenReplayError`; otherwise atomically create new tokens and set `revoked_at` on the old one
  - [x] 18.4 Implement `RefreshTokenService.revokeFamily(familyId)`: `UPDATE street_refresh_tokens SET revoked_at = NOW() WHERE family_id = $1`
  - [x] 18.5 Export `RefreshTokenService`, `TokenReplayError` from `packages/core/src/index.ts`
  - [x] 18.6 Write tests: rotation invalidates old token, replay attack revokes whole family, rotation invariant (old token invalid after rotation, new token valid), configurable lifetimes respected

- [ ] 19. v1.4 — RBAC and Permission Decorators
  - [x] 19.1 Create `packages/core/src/auth/rbac.ts`: `RoleHierarchy` type, `RbacService` class, `@Roles()` and `@Permissions()` method decorators, `rbacGuard(service)` middleware factory
  - [~] 19.2 Implement `RbacService` constructor: traverse hierarchy using BFS to build a `Map<role, Set<string>>` of flattened permissions; store at construction time for synchronous lookups
  - [~] 19.3 Implement `@Roles(...roles)` decorator: store roles on route metadata under `street:roles` key using `Reflect.defineMetadata`
  - [~] 19.4 Implement `@Permissions(...perms)` decorator: store permissions under `street:permissions` key
  - [~] 19.5 Implement `rbacGuard(service)` middleware: read metadata from the route handler class/method; call `service.hasRole()` or `service.hasPermission()`; throw `ForbiddenException` with `{ error: 'Forbidden', required: string[] }` on failure
  - [~] 19.6 Write tests: role inheritance resolves permissions, `@Roles` guard blocks non-matching roles with 403, `@Permissions` guard blocks missing permission, synchronous resolution (no DB calls)

- [ ] 20. v1.4 — WebAuthn / Passkeys
  - [~] 20.1 Create `packages/core/src/auth/webauthn.ts` with `WebAuthnService`; write `street_webauthn_credentials` migration SQL
  - [~] 20.2 Implement a minimal CBOR decoder in `packages/core/src/auth/cbor.ts` using `node:buffer`; handle the subset of CBOR used in WebAuthn attestation and assertion objects
  - [~] 20.3 Implement `WebAuthnService.beginRegistration(userId)`: generate 16+ byte random challenge; store in session with 60-second expiry; return `PublicKeyCredentialCreationOptions` JSON
  - [~] 20.4 Implement `WebAuthnService.finishRegistration(userId, credential)`: verify challenge from session (check expiry), validate origin and rpId, decode CBOR attestation, store public key and initial `signCount`
  - [~] 20.5 Implement `WebAuthnService.beginAuthentication(userId)`: generate challenge; store in session
  - [~] 20.6 Implement `WebAuthnService.finishAuthentication(userId, assertion)`: verify challenge, verify assertion signature against stored public key using `node:crypto`'s `createVerify()`; enforce `signCount > stored` (replay protection); update stored `signCount`
  - [~] 20.7 Write tests: expired challenge returns 400 with `challenge_expired`, signature verification rejects tampered assertion, sign count replay protection, round-trip registration + authentication

- [ ] 21. v1.4 — Session Revocation and Audit Trails
  - [~] 21.1 Create `packages/core/src/auth/session-store.ts` with `StreetSessionStore`: backed by `street_sessions` DB table; `create(data)`, `find(sessionId)`, `revoke(sessionId)`, `revokeAll(userId)` methods; write migration SQL
  - [~] 21.2 Implement revocation check middleware: on every authenticated request, check session ID against a `LruCache<string, boolean>` revocation set (DB fallback on cache miss); throw `UnauthorizedException` if revoked
  - [~] 21.3 Create `packages/core/src/auth/audit-writer.ts` with `AuditWriter` class; write `street_audit_log` migration SQL with `append-only` database trigger or rule
  - [~] 21.4 Implement `AuditWriter.write(record)`: inside a transaction, write the audit entry; if the write fails, re-throw so the calling transaction rolls back
  - [~] 21.5 Integrate `AuditWriter` into auth flows: call `write()` after login success, login failure, logout, token refresh, session revocation, and permission denial
  - [~] 21.6 Write tests: revoked session returns 401 on next request, audit log entry written for each of the 6 event types, failed audit write causes transaction rollback, audit log cannot be deleted via public API


- [ ] 22. v1.5 — Job Queue and Cron Scheduler
  - [~] 22.1 Write `street_jobs` migration SQL: `id UUID, type TEXT, payload JSONB, status TEXT, attempt_count INT, run_at TIMESTAMPTZ, created_at TIMESTAMPTZ, worker_id TEXT, locked_at TIMESTAMPTZ, error TEXT`; add index on `(status, run_at)` for polling efficiency
  - [~] 22.2 Create `packages/core/src/jobs/queue.ts` with `JobQueue` class: `enqueue(opts)` inserts a row; `register(type, handler)` stores handler in a `Map`; `start()` starts the polling loop; `stop()` clears the interval
  - [~] 22.3 Implement polling loop: `setInterval` runs `SELECT ... FOR UPDATE SKIP LOCKED LIMIT $concurrency`, dispatches each job to its handler, marks success (`DELETE` or `status=completed`) or failure (`UPDATE attempt_count, error`)
  - [~] 22.4 Implement `@Job('type')` class decorator: marks a class as a job handler, stores type in metadata; `JobQueue.registerClass(ctor)` reads metadata and registers the `execute(payload, ctx)` method
  - [~] 22.5 Write `CronParseError` class and a 5-field cron expression parser in `packages/core/src/jobs/scheduler.ts`: validate field ranges (minute 0-59, hour 0-23, day 1-31, month 1-12, weekday 0-7); throw `CronParseError` with invalid expression and reason at registration time
  - [~] 22.6 Implement `CronScheduler`: `register(expression, name, fn)` parses and stores the cron config; `start()` computes next fire time and schedules via `setTimeout`; single-instance guard per job name prevents overlapping execution
  - [~] 22.7 Write tests: job enqueued and executed, delayed job not executed before `runAt`, cron fires on correct tick, single-instance guard prevents overlap, invalid cron expression throws at registration

- [ ] 23. v1.5 — Delayed Jobs, Retry Policies, and Dead Letter Queues
  - [~] 23.1 Write `street_dead_letter_queue` migration SQL: `id, job_id, type, payload JSONB, error TEXT, exhausted_at TIMESTAMPTZ, created_at`
  - [~] 23.2 Implement `RetryPolicy` interface and per-job-type retry config: `maxAttempts`, `initialDelayMs`, `backoffMultiplier`, `maxDelayMs`; register policies via `JobQueue.setRetryPolicy(type, policy)`
  - [~] 23.3 Implement geometric backoff in the polling loop: on job failure, compute `Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs)`, update `run_at = NOW() + interval`; increment `attempt_count`
  - [~] 23.4 Implement DLQ promotion: when `attempt_count >= maxAttempts`, `INSERT INTO street_dead_letter_queue` and `DELETE FROM street_jobs` in the same transaction
  - [~] 23.5 Implement DLQ pruning: `CronScheduler` runs a nightly job that `DELETE FROM street_dead_letter_queue WHERE id NOT IN (SELECT id FROM street_dead_letter_queue ORDER BY created_at DESC LIMIT $maxEntries)`
  - [~] 23.6 Write tests: backoff formula `initialDelay * multiplier^attempt` is correct, DLQ receives job after exhausting retries, DLQ pruning respects max entries, delayed job not executed before `runAt`

- [ ] 24. v1.5 — Workflow Engine
  - [~] 24.1 Write `street_workflows` migration SQL: `id UUID, name TEXT, status TEXT, current_step INT, step_outputs JSONB, input JSONB, error TEXT, created_at, updated_at`
  - [~] 24.2 Create `packages/core/src/jobs/workflow.ts` with `WorkflowEngine`: `define(name, steps)` stores the definition; `start(name, input)` inserts a row and begins execution; `resume(workflowId)` loads row and skips completed steps
  - [~] 24.3 Implement step execution: after each step succeeds, serialize the output to `step_outputs[stepName]` and update `current_step` in the DB; if the process restarts, `resume()` reads `current_step` and skips already-recorded outputs
  - [~] 24.4 Implement step timeout: `Promise.race([step.run(input, ctx), timeoutPromise])` where `timeoutPromise` rejects after `step.timeoutMs`; on timeout, run compensation and mark workflow `timed_out`
  - [~] 24.5 Implement Saga compensation: on step failure, call `step.compensate()` for completed steps in reverse order; log compensation errors without re-throwing
  - [~] 24.6 Write tests: workflow resumes from last step after restart, compensation runs in reverse on failure, step timeout triggers compensation, conditional branch evaluates correctly

- [ ] 25. v1.5 — Distributed Jobs and Queue Monitoring
  - [~] 25.1 Write `street_job_history` migration SQL: `id, job_id, type, status, duration_ms, created_at`; add nightly pruning via `CronScheduler` (keep last 1,000 per type)
  - [~] 25.2 Implement worker heartbeat: each `JobQueue` worker writes its `worker_id` and updates `locked_at` every 30 seconds on in-flight jobs; a background scanner re-enqueues jobs where `locked_at < NOW() - interval '2 minutes'`
  - [~] 25.3 Register `GET /api/jobs/metrics` route: return `{ pending, inFlight, failed, succeeded, byType: { [type]: { avgDurationMs } } }` via SQL aggregation against `street_jobs` and `street_job_history`
  - [~] 25.4 Extend the `DiagnosticsServer` (from task 15.3) to include job queue metrics in its snapshot payload so `street jobs:dashboard` CLI command can display them
  - [~] 25.5 Create `packages/cli/src/commands/jobs-dashboard.ts`: connect to the diagnostics socket, render live terminal table showing queue depth, worker count, last 50 job history entries, DLQ depth; refresh every 2 seconds
  - [~] 25.6 Write tests: crashed-worker job recovery re-enqueues after heartbeat timeout, metrics endpoint returns correct counts, history pruning keeps last 1,000 entries per type


- [ ] 26. v1.6 — GraphQL Server
  - [~] 26.1 Create `packages/core/src/graphql/schema.ts`: SDL parser that reads a `.graphql` schema string and produces an internal AST (type definitions, field definitions, directives); no `graphql-js` dependency
  - [~] 26.2 Create `packages/core/src/graphql/engine.ts` with `GraphQlEngine`: takes `{ schema, resolvers, maxDepth?, maxComplexity? }`; `execute(query, variables, ctx)` parses the query document, validates against schema, executes against resolvers
  - [~] 26.3 Implement query depth limiting: recursive visitor counts nesting depth; reject with 400 if `> maxDepth`
  - [~] 26.4 Implement query complexity analysis: accumulate field weights (default 1 per field); reject with 400 if `> maxComplexity`
  - [~] 26.5 Implement GraphQL subscriptions using `AsyncIterator`; integrate with `StreetWebSocketServer` using the `graphql-ws` subprotocol framing
  - [~] 26.6 Implement introspection guard: when `introspection: false`, `__schema` and `__type` field access returns a field-not-found error
  - [~] 26.7 Register `POST /graphql` route in `StreetApp` via `graphqlMiddleware(engine)` factory
  - [~] 26.8 Write tests: simple query resolves, mutation executes and returns data, depth limit rejects deep queries, introspection blocked in production mode, response round-trip (serialize→parse→equals original)

- [ ] 27. v1.6 — API Versioning
  - [~] 27.1 Create `packages/core/src/versioning/strategy.ts`: `@ApiVersion(version)` class decorator that stores version string under `street:apiVersion` metadata; `VersioningOptions` interface; `VersionStrategy` union type
  - [~] 27.2 Implement URL versioning in `enableVersioning(app, { strategy: 'url' })`: read `street:apiVersion` metadata from each controller during `registerController()`; prefix the controller's routes with `/<version>/`
  - [~] 27.3 Implement header versioning in `enableVersioning(app, { strategy: 'header', headerName? })`: middleware reads `Accept: application/vnd.street.v2+json`, extracts version, rewrites internal route key for dispatch
  - [~] 27.4 Return HTTP 404 with available versions list when a request targets an unregistered version: `{ error: 'version_not_found', available: ['v1', 'v2'] }`
  - [~] 27.5 Generate separate OpenAPI spec files per version: `app.openApiSpec('v1')` returns only v1 routes; register `GET /v1/openapi.json` and `GET /v2/openapi.json`
  - [~] 27.6 Implement `@Deprecated({ sunset: Date })` decorator: post-dispatch middleware reads metadata and adds `Sunset` and `Deprecation` headers
  - [~] 27.7 Write tests: URL-versioned route dispatches correctly, header-versioned route dispatches correctly, unregistered version returns 404 with versions list, `@Deprecated` adds response headers

- [ ] 28. v1.6 — SDK Generator
  - [~] 28.1 Create `packages/core/src/sdk-gen/typescript.ts`: `generateTypescriptSdk(spec, outputDir)` iterates `spec.paths`, generates `types.ts` with typed request/response interfaces using mapped types from the OpenAPI schema objects
  - [~] 28.2 Implement TypeScript `ApiClient.ts` generation: one method per `operationId`, named exactly as the operationId; method signature accepts typed request params; body uses native `fetch` API
  - [~] 28.3 Create `packages/core/src/sdk-gen/python.ts`: `generatePythonSdk(spec, outputDir)` generates Python dataclasses for models and a `urllib.request`-based client; no third-party Python dependencies
  - [~] 28.4 Add `street generate sdk --lang <typescript|python> --output <dir>` to `GenerateCommand`: dynamically import the compiled project's `openApiSpec()`, pass to the appropriate generator
  - [~] 28.5 Write tests: generated TypeScript compiles without errors, generated Python dataclasses match the spec schema, backward-compatible spec change produces additive SDK update

- [ ] 29. v1.6 — Rate Limit Policies and API Analytics
  - [~] 29.1 Create `@RateLimit({ requests, window, key? })` method decorator in `packages/core/src/security/ratelimit.ts`: store config under `street:rateLimit` route metadata
  - [~] 29.2 Implement per-route rate limit resolution in the router middleware pipeline: read `street:rateLimit` metadata and instantiate a route-scoped `RateLimiter`; cache instances in a `Map<routeKey, RateLimiter>`; respond 429 with `Retry-After`, `X-RateLimit-*` headers on violation
  - [~] 29.3 Write `street_api_events` migration SQL; create `packages/core/src/observability/analytics.ts` with `AnalyticsService`
  - [~] 29.4 Implement `AnalyticsService.middleware()`: buffer events in memory (max 100); flush to DB every 5 seconds or when buffer reaches 100; use a single batched `INSERT` statement
  - [~] 29.5 Implement `AnalyticsService.report(from, to)`: SQL aggregation query returning top routes by count, average latency, and error rate
  - [~] 29.6 Implement retention pruning: `CronScheduler` nightly job deletes `street_api_events` rows older than `retentionDays`
  - [~] 29.7 Add `street analytics report --from <date> --to <date>` CLI command
  - [~] 29.8 Write tests: per-route limiter overrides global, 429 headers are correct, analytics buffer flushes, retention pruning removes old rows

- [ ] 30. v1.6 — Webhook Management
  - [~] 30.1 Write `street_webhook_endpoints` and `street_webhook_deliveries` migration SQL files
  - [~] 30.2 Create `packages/core/src/webhook/manager.ts` with `WebhookManager` class: `registerEndpoint()`, `publish()`, `deliveryLog()`, `revokeEndpoint()` methods
  - [~] 30.3 Implement `WebhookManager.publish(event, payload)`: query `street_webhook_endpoints` for matching event types; for each endpoint, enqueue a delivery job in `JobQueue` (re-using task 22 infrastructure)
  - [~] 30.4 Implement delivery: the job handler calls the existing `WebhookDispatcher`; on non-2xx response, record status and truncated body (1 KB max) in `street_webhook_deliveries`
  - [~] 30.5 Implement at-least-once semantics with exponential backoff up to 72 hours; move to dead-letter state after all retries exhausted
  - [~] 30.6 Implement `verifyIncomingWebhook(secret, signature, rawBody)`: HMAC-SHA256 constant-time comparison; reuse `signPayload` from `dispatcher.ts`
  - [~] 30.7 Write tests: published event delivered to matching endpoints, non-matching event skipped, delivery retry on 5xx, HMAC verification accepts valid and rejects invalid signatures


- [ ] 31. v1.7 — Tenant Isolation and Routing
  - [~] 31.1 Write `street_tenants` migration SQL: `id UUID, name TEXT, plan TEXT, connection_string TEXT, status TEXT, created_at`
  - [~] 31.2 Create `packages/core/src/tenancy/context.ts`: `TenantContextData` interface; `tenantMiddleware(opts)` factory supporting `subdomain`, `path`, and `header` resolution strategies; populate `ctx.state['tenant']`; return 400 `{ error: 'tenant_not_found' }` when resolution fails
  - [~] 31.3 Create `TenantPoolRegistry` in `packages/core/src/tenancy/pool-registry.ts`: `Map<tenantId, PgPool>` keyed by tenant; create pool from `street_tenants.connection_string` on first access; reap idle pools after configurable timeout
  - [~] 31.4 Implement `@TenantScoped()` class decorator: intercept `create()`, `update()`, `findById()`, `findAll()`, `delete()` on the decorated repository to automatically inject `tenant_id` filter from `ctx.state['tenant']`
  - [~] 31.5 Implement `TenantScopedRepository<T>` base class extending `StreetPostgresRepository<T>`: override SQL generation to include `AND tenant_id = $N` in all WHERE clauses and add `tenant_id = $N` to all INSERTs
  - [~] 31.6 Write tests: subdomain resolution extracts tenant from hostname, missing tenant returns 400, per-tenant pool routes queries to correct connection, `@TenantScoped` prevents cross-tenant data access

- [ ] 32. v1.7 — Tenant Provisioning, Billing, and Quotas
  - [~] 32.1 Write `street_tenant_usage` migration SQL: `tenant_id, period DATE, metric_key TEXT, value BIGINT, updated_at`
  - [~] 32.2 Create `packages/core/src/tenancy/provisioner.ts` with `TenantService.provision(opts)`: atomic transaction that INSERTs `street_tenants` row, runs tenant-specific migrations, registers the connection pool, and emits `tenant:provisioned` event
  - [~] 32.3 Implement `TenantService.checkQuota(tenantId, quotaKey)`: reads configured limits from a `QuotaConfig` map; reads current usage from `street_tenant_usage`; returns `QuotaStatus { allowed, current, limit, reset }`
  - [~] 32.4 Create `QuotaEnforcer.middleware()`: call `checkQuota()` before handler; return 429 with `{ error: 'quota_exceeded', quota, limit, reset }` if exceeded; emit `tenant:quota:warning` event at 80% threshold
  - [~] 32.5 Create `TenantBillingAdapter` interface in `packages/core/src/tenancy/billing.ts`: `reportUsage(tenantId, period, metrics)` abstract method; no coupling to specific billing provider
  - [~] 32.6 Write tests: provisioning creates tenant record and runs migrations atomically, quota exceeded returns 429 with correct fields, warning event fires at 80%, `reportUsage` adapter is called with correct metrics

- [ ] 33. v1.7 — Tenant Metrics
  - [~] 33.1 Write `street_tenant_daily_stats` migration SQL: `tenant_id, date DATE, metrics JSONB, created_at`
  - [~] 33.2 Create `packages/core/src/tenancy/metrics.ts` with `TenantMetricsRegistry`: wraps `MetricsRegistry`; all metric registrations automatically include a `tenant_id` label; enforces max 10,000 tenant entries with LRU eviction
  - [~] 33.3 Implement `TenantMetricsRegistry.forTenant(tenantId)`: returns a scoped `TenantMetricsView` that pre-labels all metric operations with `tenant_id`; evicts the LRU entry when the 10,000 cap is reached
  - [~] 33.4 Register `GET /admin/tenants/:id/metrics` route: protected by `requireRoles('admin')`; return current usage and quota status for the specified tenant
  - [~] 33.5 Add a nightly `CronScheduler` job that aggregates `street_tenant_usage` rows into `street_tenant_daily_stats`
  - [~] 33.6 Write tests: Prometheus output includes `tenant_id` label, LRU eviction at 10,000 tenants, admin endpoint returns correct stats, daily aggregation job produces correct summaries


- [ ] 34. v2.0 — HTTP/2 and gRPC Support
  - [~] 34.1 Create `packages/core/src/microservices/http2.ts` with `streetHttp2App(opts)`: wraps `node:http2` `createSecureServer()`; implements the same `registerController()` / `use()` / `listen()` / `close()` interface as `StreetApp`; controllers are portable between HTTP/1.1 and HTTP/2 apps
  - [~] 34.2 Create `packages/core/src/microservices/grpc/` directory with `proto-parser.ts`: read `.proto` file with `node:fs`, parse `service` and `message` definitions via a recursive-descent parser, produce `ServiceDefinition` and `MessageDefinition` ASTs
  - [~] 34.3 Create `packages/core/src/microservices/grpc/server.ts` with `GrpcServer`: `registerService(def, impl)`, `start()`, `stop()`; implement HTTP/2 framing for gRPC protocol (length-prefixed message frames) over `node:net`
  - [~] 34.4 Support all four RPC types: unary, server-streaming, client-streaming, bidirectional-streaming; each handler receives an `AbortSignal` from the gRPC `grpc-timeout` deadline
  - [~] 34.5 Enforce max message size (default 4 MB): return `RESOURCE_EXHAUSTED` status for oversized messages
  - [~] 34.6 Create `packages/cli/src/commands/grpc-codegen.ts` for `street generate grpc --proto ./service.proto`: invoke `proto-parser.ts`, write TypeScript type definitions for request/response messages to the output directory
  - [~] 34.7 Write tests: HTTP/2 server accepts requests, gRPC unary RPC round-trip, server-streaming emits multiple messages, deadline cancellation fires `AbortSignal`, message size limit enforced

- [ ] 35. v2.0 — Service Discovery and Circuit Breakers
  - [~] 35.1 Create `packages/core/src/microservices/service-registry.ts`: `ServiceInstance`, `ServiceRegistryBackend` interface, `ServiceRegistry` class; implement `StaticRegistry` backend reading from a config object
  - [~] 35.2 Implement `ConsulRegistry` backend: poll Consul `/v1/catalog/service/<name>` via `node:https`, return healthy instances; refresh every 10 seconds
  - [~] 35.3 Create `packages/core/src/microservices/circuit-breaker.ts` with `CircuitBreaker` extending `EventEmitter`: `CircuitBreakerOptions`, `CircuitState` type, state machine (Closed → Open → Half-Open → Closed)
  - [~] 35.4 Implement `CircuitBreaker.execute(fn)`: in Closed state call `fn()`; in Open state throw `CircuitOpenError` immediately (no network call); in Half-Open state call `fn()` as probe
  - [~] 35.5 Enforce valid state transitions only: Closed→Open, Open→HalfOpen, HalfOpen→Closed, HalfOpen→Open; no other transitions possible
  - [~] 35.6 Emit `circuitbreaker:open` event with service name, failure count, and timestamp on Closed→Open transition
  - [~] 35.7 Write tests: failure threshold opens the circuit, probe failure returns to Open, probe success closes the circuit, `CircuitOpenError` thrown on Open state, invalid state transitions are unreachable

- [ ] 36. v2.0 — Message Queues and Event Bus
  - [~] 36.1 Create `packages/core/src/microservices/event-bus.ts`: `EventBusTransport` interface, `EventEnvelope` type, `EventBus` class; default in-process transport backed by `EventEmitter`
  - [~] 36.2 Implement `EventBus.publish(topic, payload)`: wrap payload in envelope `{ id: randomBytes(16).hex, topic, timestamp, version: 1, payload }`; call `transport.publish()`
  - [~] 36.3 Implement `EventBus.subscribe(topic, handler)`: call `transport.subscribe()`; return unsubscribe function that cleans up all listeners
  - [~] 36.4 Create `RedisTransport` in `packages/core/src/microservices/transports/redis.ts`: use Redis Pub/Sub via `node:net` (raw RESP protocol, no redis npm package); ACK only after handler resolves; NACK on handler exception
  - [~] 36.5 Create `RabbitMQTransport` in `packages/core/src/microservices/transports/rabbitmq.ts`: AMQP 0-9-1 basic framing over `node:net`; support dead letter exchange routing
  - [~] 36.6 Write tests: in-process publish and subscribe, message envelope structure is correct, at-least-once delivery (message re-delivered after NACK), dead letter routing on exhausted retries

- [ ] 37. v2.0 — Saga, Distributed Locks, CQRS, and Event Sourcing
  - [~] 37.1 Create `packages/core/src/microservices/saga.ts` with `SagaOrchestrator.execute(steps)`: run each `{ action, compensate }` step in sequence; on failure, run `compensate()` functions in reverse order; log compensation errors without re-throwing
  - [~] 37.2 Create `packages/core/src/microservices/distributed-lock.ts` with `DistributedLock` using `pg_try_advisory_lock`: `acquire(key, ttlMs?)` returns a `LockHandle`; `LockHandle.release()` calls `pg_advisory_unlock`; TTL timer auto-calls `release()` if not manually released
  - [~] 37.3 Create `packages/core/src/microservices/cqrs.ts` with `CommandBus` and `QueryBus`: typed `register(commandType, handler)` and `dispatch(command)` methods; handler lookup by constructor identity
  - [~] 37.4 Write `street_events` migration SQL: `id UUID, aggregate_id TEXT, version INT, type TEXT, payload JSONB, created_at`; add `UNIQUE (aggregate_id, version)` constraint
  - [~] 37.5 Create `packages/core/src/microservices/event-store.ts` with `EventStore`: `append(aggregateId, events, expectedVersion?)` validates optimistic concurrency then inserts; `load(aggregateId, fromVersion?)` reads events in version order
  - [~] 37.6 Write tests: saga compensation runs in reverse order on failure, distributed lock prevents concurrent acquisition, released lock allows next acquisition, event store append-order invariant (events read back in insertion order), optimistic concurrency conflict throws


- [ ] 38. v2.1 — Container Orchestration and Cloud Runtime Adapters
  - [~] 38.1 Create `packages/core/src/cloud/deployment.ts` with `generateManifest(platform, config)`: produce Kubernetes `Deployment` + `Service` + `HPA` YAML, Cloud Run `service.yaml`, ECS task definition JSON, or Nomad job HCL; each includes liveness/readiness probe paths, resource limits, and env var references
  - [~] 38.2 Add `street deploy:init --platform <kubernetes|cloudrun|ecs|nomad>` CLI command: import the project's `street.config.ts`, call `generateManifest()`, write files to `deploy/` directory
  - [~] 38.3 Extract `registerShutdownHook(app, pool, opts?)` from `main.ts` as a standalone exportable function: `SIGTERM` → drain HTTP → close DB connections → exit 0; configurable `graceMs` (default 30,000)
  - [~] 38.4 Implement Cloud Run auto-detection: check `K_SERVICE` and `K_REVISION` env vars; when detected, switch `Logger` to GCP structured JSON format with `severity`, `message`, `timestamp`, and `httpRequest` fields
  - [~] 38.5 Implement `STREET_READINESS_DELAY_MS` env var: delay the readiness probe returning `up` by the configured milliseconds after startup completes
  - [~] 38.6 Write tests: generated Kubernetes YAML is valid YAML with correct health probe paths, Cloud Run format detection switches log format, shutdown drains in-flight requests before pool close

- [ ] 39. v2.1 — Secret Providers
  - [~] 39.1 Create `packages/core/src/cloud/secret-providers.ts`: `SecretProvider` interface with `get(key): Promise<string>`; shared in-memory cache `Map<key, { value, expiresAt }>`
  - [~] 39.2 Implement `VaultSecretProvider`: KV v2 `GET /v1/<mount>/data/<key>` via `node:https` with Vault token auth; parse response JSON; never log raw secret values (use `[REDACTED]`)
  - [~] 39.3 Implement `AwsSecretsManagerProvider`: `GetSecretValue` API call via AWS Signature V4 signed request using `node:crypto` (HMAC-SHA256); parse JSON response
  - [~] 39.4 Implement `GcpSecretManagerProvider`: `GET /v1/projects/<id>/secrets/<name>/versions/latest:access` via `node:https` with service account token from instance metadata
  - [~] 39.5 Implement startup retry logic: on first `get()` failure, retry with exponential backoff (`1s, 2s, 4s, 8s, 10s...`) for up to 60 seconds; exit process with code 1 after timeout with descriptive error listing failed key names
  - [~] 39.6 Implement secret rotation: emit `rotate` event when TTL expires; connect to `PgPool` via a `onRotate` callback that recycles connections when the secret is a DB password
  - [~] 39.7 Write tests: cached secret returned without network call within TTL, expired cache triggers re-fetch, `[REDACTED]` appears in all log output, startup retry exhaustion exits with code 1

- [ ] 40. v2.1 — Service Mesh and Auto-Scaling Metrics
  - [~] 40.1 Register `GET /metrics/autoscale` route in `StreetApp`: return JSON in Kubernetes External Metrics API format with `http_requests_per_second`, `active_connections`, and `queue_depth` values computed from `TelemetryTracker` and `JobQueue`
  - [~] 40.2 Implement service mesh detection: check `ISTIO_META_MESH_ID` and `LINKERD_PROXY_INJECTION_ENABLED` env vars on startup; when detected, set `RetryPolicy.enabled = false` for all `CircuitBreaker` instances to avoid conflicting with mesh retries
  - [~] 40.3 Implement `STREET_READINESS_DELAY_MS` startup delay: `HealthCheckRegistry` readiness probe returns `down` until the delay has elapsed after `app.listen()` completes
  - [~] 40.4 Export `/metrics/autoscale` response shape as `AutoscaleMetrics` type from `packages/core/src/index.ts`
  - [~] 40.5 Write tests: `/metrics/autoscale` response matches Kubernetes External Metrics API format, service mesh env var disables retries, readiness delay holds probe in `down` state

- [ ] 41. v2.1 — Edge Runtime Adapter
  - [~] 41.1 Create `packages/edge/` workspace package with its own `package.json` (`@streetjs/edge`) and `tsconfig.json`; configure `"browser"` export condition
  - [~] 41.2 Create `packages/edge/src/adapter.ts` with `handleEdgeRequest(request: Request, app: StreetApp): Promise<Response>`: map Web Fetch `Request` → `StreetContext` using a synthetic `IncomingMessage`-like object; run the middleware pipeline; build a `Response` from the context's JSON/text/html output
  - [~] 41.3 Create `packages/edge/src/stubs.ts`: stub modules that replace `node:net`, `node:cluster`, `node:fs`, and `node:http` when bundled for edge targets; each stub's methods throw `FeatureUnavailableInEdgeRuntimeError` when called
  - [~] 41.4 Add `"browser"` export conditions in `packages/core/package.json` to map `node:net` imports to edge stubs for tree-shaking
  - [~] 41.5 Create `FeatureUnavailableInEdgeRuntimeError` in `packages/core/src/http/exceptions.ts`
  - [~] 41.6 Write tests: `handleEdgeRequest` routes to the correct handler, edge-incompatible features throw `FeatureUnavailableInEdgeRuntimeError` when initialized, routing/middleware/DI/JWT verify all work in edge mode


- [ ] 42. v2.2 — Feature Flags
  - [~] 42.1 Write `street_feature_flags` migration SQL: `name TEXT PRIMARY KEY, enabled BOOLEAN, rules JSONB, updated_at`
  - [~] 42.2 Create `packages/core/src/enterprise/feature-flags.ts` with `FeatureFlagService`: `isEnabled(flagName, context?)` reads from DB with `LruCache` (default 30s TTL); returns `false` and logs a `warn` entry if flag is not found
  - [~] 42.3 Implement targeting rules evaluation: `user_id` exact match, `role` membership check, `environment` match; `percentage` rule uses `SHA256(flagName + userId)[0:8] % 100` for stable per-user assignment
  - [~] 42.4 Implement `FeatureFlagService.invalidateCache(flagName)`: remove the flag entry from `LruCache`
  - [~] 42.5 Register `PATCH /admin/feature-flags/:name` route: update the DB record, call `invalidateCache()`; protect with `requireRoles('admin')`
  - [~] 42.6 Write tests: flag not found returns `false` without throwing, percentage rollout is stable for same user, targeting rule evaluation order, cache invalidation forces DB re-read

- [ ] 43. v2.2 — Audit Logging
  - [~] 43.1 Write `street_audit_log` migration SQL: `id UUID, category TEXT, actor_id TEXT, action TEXT, resource TEXT, before_state JSONB, after_state JSONB, ip TEXT, user_agent TEXT, batch_id UUID, signature TEXT, created_at`; create append-only trigger that blocks `UPDATE` and `DELETE`
  - [~] 43.2 Create `packages/core/src/enterprise/audit-logger.ts` with `AuditLogger`: `AuditCategory`, `AuditLogOptions`, `AuditLogger` class accepting `{ pool, signingKey }`
  - [~] 43.3 Implement `AuditLogger.log(opts)`: write to `street_audit_log`; batch every 100 entries; sign each batch with `HMAC-SHA256(previousSignature + batchJSON)` to create a hash chain
  - [~] 43.4 Implement `@Sensitive()` property decorator: marks entity fields; `AuditLogger.log()` reads metadata and replaces sensitive field values with `"[REDACTED]"` in `before_state` and `after_state`
  - [~] 43.5 Implement `AuditLogger.export(from, to, format)`: `SELECT` from `street_audit_log` ordered by `created_at`; stream output as JSONL or CSV via a `Readable` stream
  - [~] 43.6 Add `street audit:export --from <date> --to <date> --format <jsonl|csv>` CLI command
  - [~] 43.7 Write tests: append-only trigger prevents DELETE and UPDATE, batch signature chain is verifiable, `@Sensitive` fields are redacted in audit output, JSONL export contains all entries in time range

- [ ] 44. v2.2 — Data Retention, Encryption Policies, and Data Classification
  - [~] 44.1 Create `packages/core/src/enterprise/data-policy.ts`: `@RetainFor(duration)`, `@Encrypt()`, `@Classify(level)` property decorators; store metadata under `street:retention`, `street:encrypt`, `street:classify` keys
  - [~] 44.2 Implement field-level transparent encryption in repository layer: when `@Encrypt()` is present on a field, intercept `create()` and `update()` to encrypt with `AES-256-GCM` using the vault key; intercept `findById()` and `findAll()` to decrypt on retrieval
  - [~] 44.3 Integrate `@Classify(level)` with `Logger`: when a log entry includes entity fields, check their classification level against `LOG_CLASSIFICATION_THRESHOLD` env var; redact fields above the threshold
  - [~] 44.4 Create `RetentionJob` class: read all entity `@RetainFor` metadata, generate `DELETE FROM <table> WHERE created_at < NOW() - INTERVAL $1` queries, execute in batches of configurable size (default 1,000 rows)
  - [~] 44.5 Create `ComplianceReporter.report(entities)`: iterate entity decorator metadata, produce `ComplianceReport[]` with field name, classification level, encrypted status, and retention period
  - [~] 44.6 Add `street compliance:report` CLI command: call `ComplianceReporter.report()`, print formatted table
  - [~] 44.7 Write tests: encrypted fields round-trip (encrypt on write, decrypt on read), classified fields redacted in logs, retention job deletes rows older than period, compliance report lists all annotated fields

- [ ] 45. v2.2 — Backup Framework and Disaster Recovery
  - [~] 45.1 Write `street_backups` migration SQL: `id UUID, size_bytes BIGINT, duration_ms INT, checksum TEXT, storage_key TEXT, created_at`
  - [~] 45.2 Create `packages/core/src/enterprise/backup.ts`: `StorageAdapter` interface with `write(key, stream)`, `read(key)`, `list()`; `BackupRecord` type; `BackupService` class
  - [~] 45.3 Implement `LocalStorageAdapter`: write/read streams to/from local filesystem path
  - [~] 45.4 Implement `S3StorageAdapter`: PUT/GET via AWS Signature V4 signed `node:https` requests
  - [~] 45.5 Implement `GcsStorageAdapter`: PUT/GET via GCP service account `node:https` requests
  - [~] 45.6 Implement `BackupService.backup()`: use PostgreSQL `COPY (SELECT ...) TO STDOUT` over the existing `PgConnection` to stream table data without spawning an external process; compute SHA-256 incrementally; write to `StorageAdapter`; record metadata in `street_backups`
  - [~] 45.7 Implement `BackupService.restore(backupId, targetPool)`: fetch stream from `StorageAdapter`, verify SHA-256 checksum (abort on mismatch), apply SQL stream to target DB
  - [~] 45.8 Add `street restore --backup-id <id>` CLI command; exit code 1 with expected/actual checksums on mismatch
  - [~] 45.9 Write tests: backup stream checksum matches stored value, corrupted backup aborts restore without modifying target DB, S3 adapter round-trip (upload then download produces identical content)


- [ ] 46. v3.0 — Distributed Cache and Global Config Service
  - [~] 46.1 Create `packages/core/src/platform/distributed-cache.ts`: `CacheTransport` interface with `get`, `set`, `delete`, `subscribe`, `publish`; `DistributedCache` class; `InProcessTransport` default implementation backed by `LruCache`
  - [~] 46.2 Implement `RedisTransport` in `packages/core/src/platform/transports/redis.ts`: raw RESP3 protocol over `node:net`; support `GET`, `SET EX`, `DEL`, `SUBSCRIBE`, `PUBLISH` commands; no redis npm package
  - [~] 46.3 Implement `MemcachedTransport`: raw Memcached text protocol over `node:net`
  - [~] 46.4 Implement `DistributedCache.invalidate(key)`: publish invalidation message to a `street:invalidate` pub/sub channel; all nodes receive the message and evict their local copy; complete propagation within 100ms on local network
  - [~] 46.5 Enforce `maxMemoryMb` bound in `DistributedCache`: local in-memory replica uses `LruCache` with byte-size tracking; evicts LRU entries when `maxMemoryMb` is exceeded
  - [~] 46.6 Create `GlobalConfigService` extending `EventEmitter`: `get(key)`, `set(key, value)` backed by `CacheTransport`; emit `config:changed` with `{ key, oldValue, newValue }` to all connected instances via pub/sub within 500ms
  - [~] 46.7 Write tests: invalidation propagates to all nodes within 100ms, `maxMemoryMb` eviction triggers LRU removal, `GlobalConfigService` emits `config:changed` event, stale config is re-fetched after TTL

- [ ] 47. v3.0 — Event Streaming and Realtime Analytics
  - [~] 47.1 Create `packages/core/src/platform/event-streaming.ts`: `StreamTransport` interface, `EventStreamPublisher` class, `EventStreamConsumer` class; `InProcessTransport` default
  - [~] 47.2 Implement `KafkaTransport` in `packages/core/src/platform/transports/kafka.ts`: raw Kafka protocol (Fetch API, Produce API) over `node:net`; support consumer groups; no kafkajs dependency
  - [~] 47.3 Implement `KinesisTransport`: `PutRecord` and `GetRecords` via AWS Signature V4 signed `node:https` requests
  - [~] 47.4 Implement `EventStreamConsumer` lag monitoring: compare consumer committed offset to latest partition offset; emit `stream:lag` event when lag exceeds `maxLagThreshold`
  - [~] 47.5 Create `packages/core/src/platform/realtime-aggregator.ts` with `RealtimeAggregator`: register sliding-window aggregation functions (count, sum, avg, min, max); compute on each window tick; push results to `SseConnection` subscribers
  - [~] 47.6 Write tests: published event consumed by subscriber, envelope round-trip (published payload equals consumed payload), lag event fires when consumer falls behind, aggregator correctly computes window statistics

- [ ] 48. v3.0 — Multi-Region Replication
  - [~] 48.1 Create `packages/core/src/platform/replication.ts` with `ReplicationCoordinator`: `RegionConfig[]` constructor parameter; `getWritePool()` always returns primary; `getReadPool(preferredRegion?)` routes by weight or preference
  - [~] 48.2 Implement primary health monitoring: `setInterval(() => checkHealth(), healthCheckIntervalMs)` pings each region with `ConnectionDiagnostics.ping()`; detect primary failure within `healthCheckIntervalMs` (default 10s)
  - [~] 48.3 Implement `promotePrimary(regionName)`: update internal routing table to make the specified region primary; emit `region:promoted` event; reject write queries to the former primary
  - [~] 48.4 Create `preferredRegionMiddleware(coordinator)`: read `X-Preferred-Region` header; call `coordinator.getReadPool(region)` for read requests; fall back to default read pool if region unavailable
  - [~] 48.5 Implement `db_replication_lag_seconds` Prometheus gauge: query `pg_stat_replication` on the primary and report lag per replica; label by `region` and `replica_id`
  - [~] 48.6 Write tests: primary failure promotes next healthy replica within 10s, `X-Preferred-Region` routes to correct pool, replication lag metric emitted with correct labels, active-active last-write-wins resolves conflict correctly

- [ ] 49. v3.0 — AI Infrastructure Toolkit and Native Agent Framework
  - [~] 49.1 Create `packages/core/src/platform/ai/llm-client.ts`: `LlmClient` interface, `CompletionOptions`, `CompletionResult` types; `OpenAiClient`, `AnthropicClient`, `OllamaClient` implementations using `node:https`; no SDK dependencies
  - [~] 49.2 Implement streaming mode in each client: parse SSE chunks from the provider's stream response; yield tokens via `AsyncIterator<string>`
  - [~] 49.3 Create `packages/core/src/platform/ai/tool-registry.ts` with `ToolRegistry`: `register(name, fn, schema)` stores typed tool functions with their JSON Schema descriptors; `toFunctionList()` returns `LlmFunctionDef[]` for inclusion in LLM API calls
  - [~] 49.4 Create `packages/core/src/platform/ai/agent-executor.ts` with `AgentExecutor`: ReAct think/act/observe loop; call LLM, parse tool calls from response, execute via `ToolRegistry`, feed result back; stop when final answer produced or `maxSteps` reached
  - [~] 49.5 Implement SSE step streaming: when `ctx` is provided, emit `{ type: 'thought'|'action'|'observation'|'final', content: string }` events via `createSse(ctx.res)` for each intermediate step
  - [~] 49.6 Implement conversation history summarization: estimate tokens as `Math.ceil(content.length / 4)`; when history exceeds `maxTokens * 0.8`, send a summarization prompt to the LLM and replace history with the summary
  - [~] 49.7 Implement HTTP 429 retry: catch `429` from LLM provider, parse `Retry-After` header, wait that duration, then retry; propagate `Retry-After` on the API response
  - [~] 49.8 Write tests: ReAct loop resolves with correct final answer, tool execution result is fed back to LLM, history summarization triggers at token limit, 429 retry respects `Retry-After`, SSE events emitted in correct order

- [ ] 50. v3.0 — Plugin Marketplace and Extension SDK
  - [~] 50.1 Create `packages/core/src/platform/plugins/sdk.ts`: `PluginModule` abstract base class with `name`, `version`, `onInstall?`, `onLoad?`, `onUnload?` lifecycle hooks; `SandboxedApp` interface exposing only `use()`, `registerController()`, and `on()`
  - [~] 50.2 Implement `StreetApp.use(plugin: PluginModule)`: resolve plugin as a `SandboxedApp` proxy; record the pre-load middleware stack length; call `plugin.onLoad(sandboxedApp)`; track loaded plugins in a `Map`
  - [~] 50.3 Implement plugin unloading: `app.unuse(plugin)`: call `plugin.onUnload(sandboxedApp)`; verify middleware stack is restored to pre-load length; remove tracked entries
  - [~] 50.4 Create `packages/core/src/platform/plugins/registry.ts` with `PluginInstaller`: `install(name, version)` fetches from `registryUrl`, verifies Ed25519 marketplace signature using `node:crypto`'s `verify()` with bundled public key, verifies SHA-256 checksum, extracts to `pluginsDir`; throw on invalid signature or mismatched checksum
  - [~] 50.5 Add `street plugin:install <name>@<version>` CLI command: call `PluginInstaller.install()`, report verification status
  - [~] 50.6 Add `street plugin:list` CLI command: read `pluginsDir`, load metadata from each plugin's `package.json`, print name, version, marketplace verification status, and load status
  - [~] 50.7 Write tests: `onLoad` + `onUnload` restores app to pre-load state (round-trip property), invalid marketplace signature throws and refuses installation, checksum mismatch throws and refuses installation, plugin cannot access DI container internals outside `SandboxedApp` interface


- [ ] 51. Cross-Cutting — Absolute Implementation Policy Enforcement
  - [~] 51.1 Add a CI step in `.github/workflows/ci-cd.yml` that scans all `.ts` files under `packages/core/src/` for `TODO`, `FIXME`, `HACK`, and `@ts-ignore` comments and fails the build if any are found
  - [~] 51.2 Add database integration test jobs to `.github/workflows/ci-cd.yml`: spin up real PostgreSQL 16, MySQL 8, and SQLite services; run all test suites that touch database code against live instances
  - [~] 51.3 Create `benchmarks/` directory with benchmark scripts for the primary request path: measure latency and throughput against Express, Fastify, NestJS, and Hono using `node:http` or `autocannon`; add benchmark job to CI that records results as a build artifact
  - [~] 51.4 Add a memory safety test job to CI: run `node --max-old-space-size=256` against the memory safety test suite in `packages/core/tests/system/memory-safety.test.ts`; fail if heap growth exceeds 50 MB over 10,000 requests
  - [~] 51.5 Add a security audit step to CI: run `npm audit --audit-level=high` and fail the build on any high or critical severity findings
  - [~] 51.6 Create `docs/` content stubs for each new module matching the documentation plan: `getting-started.md`, `user-guide.md`, `api-reference.md`, `cli-reference.md`, `security.md`, `migration.md`, `troubleshooting.md`, `examples/` per version milestone
  - [~] 51.7 Audit all new stateful classes (`DevWatcher`, `JobQueue`, `CronScheduler`, `WorkflowEngine`, `DiagnosticsServer`, `OtelTracer`, `AnalyticsService`, `TenantPoolRegistry`, `AgentExecutor`) for `destroy()`/`stop()`/`close()` method completeness and verify they are called in the graceful shutdown sequence in `main.ts`
  - [~] 51.8 Verify all `setInterval` and `setTimeout` timers across all new modules call `.unref()` so they do not prevent process exit
  - [~] 51.9 Add a backward-compatibility regression test job: after each version is completed, run the full previous-version test suite against the new codebase and fail if any existing test breaks
  - [~] 51.10 Create `CHANGELOG.md` entries for each shipped version following the Keep a Changelog format; automate generation from conventional commit messages in the CI release job
