# Design Document: StreetJS Framework Roadmap v1.1 – v3.0

## Overview

This document specifies the technical architecture for all features in the StreetJS Framework roadmap. Every design decision extends the existing v1.0 architecture: zero-external-dependency philosophy, pure Node.js core modules, the `MiddlewareFn` pipeline, decorator-based metadata, the `Container` DI singleton, and `StreetPostgresRepository<T>` as the data access foundation.

The framework source lives in `packages/core/src/` (ESM, NodeNext module resolution, `experimentalDecorators`, `emitDecoratorMetadata`, strict TypeScript). All new modules follow the same file layout conventions and are exported through `packages/core/src/index.ts`.

---

## Architecture

### Existing Foundation

```
packages/core/src/
├── core/          container.ts · context.ts · decorators.ts · types.ts
├── http/          server.ts · auth.middleware.ts · exceptions.ts · openapi.ts
├── router/        router.ts
├── database/      wire.ts · pool.ts · repository.ts · migrations.ts
├── security/      jwt.ts · session.ts · ratelimit.ts · vault.ts · xss.ts
├── websocket/     server.ts · sse.ts
├── cache/         lru.ts
├── telemetry/     tracker.ts
├── cluster/       coordinator.ts
├── webhook/       dispatcher.ts
├── multipart/     parser.ts
└── cli/           kernel.ts · commands.ts
```

### New Module Tree (v1.1 – v3.0)

```
packages/core/src/
├── dev/           watcher.ts (hot reload)
├── config/        validator.ts (defineConfig, startup validation)
├── diagnostics/   reporter.ts · socket-server.ts
├── database/
│   ├── mysql/     wire.ts · pool.ts
│   ├── sqlite/    worker.ts · pool.ts
│   ├── query-builder.ts
│   ├── schema-inspector.ts
│   ├── seeder.ts
│   └── profiler.ts
├── observability/
│   ├── otel.ts
│   ├── logger.ts
│   ├── prometheus.ts
│   └── health.ts
├── auth/
│   ├── oauth2.ts
│   ├── api-keys.ts
│   ├── refresh-tokens.ts
│   ├── rbac.ts
│   └── webauthn.ts
├── jobs/
│   ├── queue.ts
│   ├── scheduler.ts
│   ├── workflow.ts
│   └── dashboard.ts
├── graphql/       engine.ts · schema.ts · subscriptions.ts
├── versioning/    strategy.ts
├── sdk-gen/       typescript.ts · python.ts
├── tenancy/       context.ts · provisioner.ts · billing.ts
├── microservices/
│   ├── http2.ts
│   ├── grpc/      server.ts · codegen.ts
│   ├── service-registry.ts
│   ├── circuit-breaker.ts
│   ├── event-bus.ts
│   ├── saga.ts
│   ├── distributed-lock.ts
│   └── cqrs.ts · event-store.ts
├── cloud/
│   ├── secret-providers.ts
│   ├── deployment.ts
│   └── edge-adapter.ts
├── enterprise/
│   ├── feature-flags.ts
│   ├── audit-logger.ts
│   ├── data-policy.ts
│   └── backup.ts
└── platform/
    ├── distributed-cache.ts
    ├── event-streaming.ts
    ├── replication.ts
    ├── ai/            llm-client.ts · tool-registry.ts · agent-executor.ts
    └── plugins/       sdk.ts · registry.ts
```

---

## v1.1 — Developer Experience

### 1. Hot Reload Development Server (`dev/watcher.ts`)

**Approach:** Use `node:fs/promises watch()` (Node 22+) or fall back to `fs.watch()` to detect `.ts` file saves in `src/`. On change, spawn a child `tsc --incremental` process. When compilation succeeds, send `SIGTERM` to the current server process and spawn a fresh one. The previous server drains in-flight requests before exiting via the existing graceful shutdown path.

```typescript
export interface WatcherOptions {
  srcDir: string;          // default: './src'
  outDir: string;          // default: './dist'
  drainTimeoutMs: number;  // default: 5000
  entrypoint: string;      // default: './dist/main.js'
}

export class DevWatcher {
  private watcher: FSWatcher | null = null;
  private serverProcess: ChildProcess | null = null;
  private compiling = false;

  constructor(private readonly opts: WatcherOptions) {}

  async start(): Promise<void>;   // starts watcher + initial compile + server boot
  async stop(): Promise<void>;    // closes FSWatcher handles, kills server process
  private async compile(): Promise<boolean>;    // tsc --incremental, returns success
  private async restartServer(): Promise<void>; // SIGTERM old + spawn new
}
```

**CLI integration:** `street dev --watch` sets `DEV_WATCH=true` before delegating to `DevCommand` in `packages/cli/src/commands/dev.ts`. The command instantiates `DevWatcher`, calls `start()`, and registers `SIGINT`/`SIGTERM` handlers that call `stop()`.

**Memory safety:** All `FSWatcher` handles are stored in an array and closed in `stop()`. The `compiling` boolean prevents concurrent recompile races.

---

### 2. Code Generators (`packages/cli/src/commands/generate.ts`)

**Approach:** Extend the existing `GenerateCommand` class. Add `middleware`, `gateway`, and `migration` sub-types to the switch. Read templates from `packages/cli/templates/generate/`. Validate the `<name>` argument with `/^[a-z][a-z0-9_-]*$/`. Check file existence before writing; exit 1 without overwrite if file exists.

```typescript
// Middleware template output: src/middleware/<name>.middleware.ts
export async function generateMiddleware(name: string, cwd: string): Promise<void>;

// Gateway template output: src/gateways/<name>.gateway.ts
export async function generateGateway(name: string, cwd: string): Promise<void>;

// Migration template output: migrations/<timestamp>_<name>.sql + .rollback.sql
export async function generateMigration(name: string, cwd: string): Promise<void>;
```

**Name validation** runs before any filesystem access. The generator exits with code 1 and a message like `"Name must match [a-z][a-z0-9_-]*"` if invalid.

---

### 3. Configuration Validation (`config/validator.ts`)

**Approach:** A `defineConfig<T>()` factory that accepts a schema object and returns a validated, typed config bag. Called at application startup before any port binding.

```typescript
export type FieldType = 'string' | 'number' | 'boolean' | 'url' | 'port';

export interface ConfigFieldDef {
  type: FieldType;
  required?: boolean;
  default?: string | number | boolean;
  min?: number;   // for 'number' and 'port'
  max?: number;
}

export type ConfigSchema = Record<string, ConfigFieldDef>;
export type ConfigResult<S extends ConfigSchema> = { [K in keyof S]: string | number | boolean };

export function defineConfig<S extends ConfigSchema>(schema: S): ConfigResult<S>;
// Reads process.env, validates each field, collects all errors, throws ConfigValidationError
// with a per-field error listing if any fail. Never throws on individual fields.

export class ConfigValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super('Configuration validation failed:\n' + errors.join('\n'));
  }
}
```

**Startup integration:** `streetApp()` accepts an optional `config` option. If provided, `defineConfig()` is called before `server.listen()`. Failures cause `process.exit(1)` with the error block printed to stderr.

---

### 4. Enhanced Diagnostics (`diagnostics/reporter.ts`)

**Approach:** Replace `console.error` in `router/router.ts`'s `errorHandler` with a structured `DiagnosticsReporter`. The reporter serializes errors as JSON to stderr, strips Node.js internal frames from stacks, and emits a `diagnostic` event on the app's event emitter.

```typescript
export interface DiagnosticEvent {
  level: 'error' | 'warn';
  errorClass: string;
  message: string;
  stack: string[];       // cleaned frames only
  correlationId?: string;
  ts: string;            // ISO 8601
}

export class DiagnosticsReporter extends EventEmitter {
  report(err: unknown, correlationId?: string): void;
  // Emits 'diagnostic' event and writes to stderr as JSON
}
```

**DI injection chain error enrichment:** When `Container.resolve()` catches a resolution error, it prepends the full dependency chain to the error message: `"Cannot resolve UserService → UserRepository → PgPool: ..."`.

**DB error suggestions:** `PgPool.initialize()` catches `ECONNREFUSED` and throws `DatabaseConnectionError` with a `suggestion` field listing relevant env vars.

---

### 5. CLI Operational Commands

**New commands in `packages/cli/src/commands/`:**

```typescript
// street info
class InfoCommand {
  async execute(ctx: CliContext): Promise<void>;
  // Reads package.json, process.version, tsconfig.json
  // Prints aligned table: StreetJS version, Node version, TS version, OS, project config
}

// street doctor
class DoctorCommand {
  async execute(ctx: CliContext): Promise<void>;
  // Checks: Node.js >= 20, TypeScript >= 5.0, required env vars, DB connectivity
  // Prints: ✓ / ✗ per check with details
}

// street env validate
class EnvValidateCommand {
  async execute(ctx: CliContext): Promise<void>;
  // Loads street.config.ts (via dynamic import), calls defineConfig(), prints per-var report
}

// street audit
class AuditCommand {
  async execute(ctx: CliContext): Promise<void>;
  // Runs `npm audit --json`, parses output, formats as table
}
```

All commands are registered in `packages/cli/src/index.ts`'s switch block.

---

## v1.2 — Database Platform

### 6. MySQL / MariaDB Wire Protocol (`database/mysql/wire.ts`)

**Approach:** Implement the MySQL Client/Server Protocol v4.1+ from scratch using `node:net` and `node:crypto`. Same interface as `PgConnection` — the consumer calls `connect()`, `query()`, `queryStream()`, `close()`. This enables `MysqlPool` to be structurally compatible with `PgPool`.

```typescript
export interface MysqlConnectOptions {
  host: string; port?: number; user: string; password: string; database: string;
  authPlugin?: 'mysql_native_password' | 'caching_sha2_password';
  connectTimeoutMs?: number;
}

export class MysqlConnection {
  static async connect(opts: MysqlConnectOptions): Promise<MysqlConnection>;
  async query(sql: string, params?: unknown[]): Promise<DbResult>;
  queryStream(sql: string): DbStream;
  async close(): Promise<void>;
  get isReady(): boolean;
  get isClosed(): boolean;
}

export class MysqlPool {
  constructor(opts: MysqlPoolOptions);
  async initialize(): Promise<void>;
  async query(sql: string, params?: unknown[]): Promise<DbResult>;
  async transaction<T>(fn: (conn: MysqlConnection) => Promise<T>): Promise<T>;
  async close(): Promise<void>;
}
```

**Authentication:** `mysql_native_password` uses `SHA1(password) XOR SHA1(seed + SHA1(SHA1(password)))`. `caching_sha2_password` uses a challenge-response with `SHA256`. Both implemented via `node:crypto`.

**MariaDB dialect:** A `MariaDbConnection` subclass that negotiates MariaDB-specific capability flags during handshake. `MysqlConnection.connect()` detects the server greeting and returns the appropriate subclass.

**SQLite** (`database/sqlite/worker.ts`): Implemented as a `node:worker_threads` worker that loads a bundled SQLite WASM binary via `new WebAssembly.Module(wasmBytes)`. The main thread communicates via `MessageChannel`. This satisfies the zero-native-dependency constraint.

```typescript
export class SqlitePool {
  constructor(opts: { filePath: string; maxWorkers?: number });
  async query(sql: string, params?: unknown[]): Promise<DbResult>;
  async transaction<T>(fn: () => Promise<T>): Promise<T>;
  async close(): Promise<void>;
}
```

**Shared type:** All drivers produce the same `DbResult`:
```typescript
export interface DbResult {
  rows: Record<string, string | null>[];
  rowCount: number;
  command: string;
}
```

---

### 7. Type-Safe Query Builder (`database/query-builder.ts`)

**Approach:** A fluent builder class that accumulates AST-like state and renders to `{ sql, params }` on `.build()`. TypeScript generics enforce column names at compile time.

```typescript
export class QueryBuilder<T extends object> {
  select(...cols: (keyof T & string)[]): this;
  from(table: string): this;
  where(condition: string, ...values: unknown[]): this;
  join(table: string, condition: string): this;
  leftJoin(table: string, condition: string): this;
  orderBy(col: keyof T & string, dir?: 'ASC' | 'DESC'): this;
  groupBy(...cols: (keyof T & string)[]): this;
  having(condition: string, ...values: unknown[]): this;
  limit(n: number): this;
  offset(n: number): this;
  subquery<U extends object>(qb: QueryBuilder<U>, alias: string): this;
  build(): { sql: string; params: unknown[] };
}
```

Values are collected into a `params[]` array; `?` or `$N` placeholders are rendered per the target dialect. The builder is immutable between `build()` calls — each method returns `this` after mutating internal state, so calling `build()` twice produces identical output (idempotent).

**Dialect handling:** A `SqlDialect` enum (`postgres | mysql | sqlite`) is passed to the constructor and controls placeholder style.

---

### 8. Schema Introspection (`database/schema-inspector.ts`)

```typescript
export interface ColumnMeta { name: string; type: string; nullable: boolean; default: string | null; }
export interface IndexMeta   { name: string; columns: string[]; unique: boolean; }
export interface FkMeta      { column: string; refTable: string; refColumn: string; }
export interface TableSchema { name: string; columns: ColumnMeta[]; primaryKey: string[]; foreignKeys: FkMeta[]; indexes: IndexMeta[]; }
export interface DatabaseSchema { tables: TableSchema[]; inspectedAt: Date; }

export class SchemaInspector {
  static async inspect(pool: PgPool | MysqlPool | SqlitePool, opts?: { ttlMs?: number }): Promise<DatabaseSchema>;
  static invalidateCache(pool: PgPool | MysqlPool | SqlitePool): void;
}
```

Introspection queries batch all catalog reads into a single round-trip per database type. Results are cached in a `Map<pool, { schema, expiresAt }>` with a 60-second default TTL. Cache is checked on each call; `invalidateCache()` removes the entry.

---

### 9. Migration Diffing & Seeding (`database/migrations.ts` extensions)

**Diff generation:** `MigrationDiffer.diff(pool, entityDefs)` compares the live `DatabaseSchema` from `SchemaInspector` against entity class metadata (read from `@Column` decorators) and emits `AlterStatement[]`. Each statement is classified as `safe` or `destructive`. The CLI command writes the generated SQL to a timestamped file; destructive changes require `--confirm-destructive`.

**Seeder:** `StreetSeeder.run(pool, seedFile)` wraps execution in a transaction. Seeds are tracked in a `street_seed_runs` table with a hash of the seed file content to prevent duplicate runs.

```typescript
export class MigrationDiffer {
  static async diff(pool: PgPool, entities: Constructor[]): Promise<{ safe: string[]; destructive: string[] }>;
}

export class StreetSeeder {
  constructor(private readonly pool: PgPool) {}
  async run(seedFile: string): Promise<void>;
}
```

---

### 10. Query Profiler & Connection Diagnostics (`database/profiler.ts`)

```typescript
export interface QueryRecord {
  sql: string; params: unknown[]; durationMs: number; rowCount: number; ts: Date;
}

export class QueryProfiler {
  static enable(pool: PgPool | MysqlPool): void;
  static getSlowQueries(thresholdMs: number): QueryRecord[];
  static clear(): void;
}

export class ConnectionDiagnostics {
  static async ping(pool: PgPool | MysqlPool): Promise<{ latencyMs: number }>;
  static poolStats(pool: PgPool | MysqlPool): PoolStats;
}

export interface PoolStats {
  total: number; idle: number; inUse: number; waiting: number; avgAcquireMs: number;
}
```

Profiling wraps `pool.query()` with a timing decorator (without patching the prototype — uses composition). The profiler stores up to 10,000 records in a bounded ring buffer. `pool:exhausted` is emitted on the pool's EventEmitter before enqueuing a wait request.

---

## v1.3 — Observability

### 11. OpenTelemetry Integration (`observability/otel.ts`)

**Approach:** Implement the OTLP HTTP exporter and W3C `traceparent` propagation from scratch using `node:https`, `node:crypto`, and the OTLP protobuf-over-JSON encoding (no SDK dependency). Spans are serialized to the OTLP JSON format and batched for export.

```typescript
export interface SpanContext { traceId: string; spanId: string; traceFlags: number; }
export interface Span {
  name: string;
  startNs: bigint;
  attributes: Record<string, string | number | boolean>;
  end(statusCode?: number): void;
}

export class OtelTracer {
  constructor(opts: { endpoint?: string; serviceName: string; maxBuffer?: number });
  startSpan(name: string, parent?: SpanContext): Span;
  extractContext(headers: Record<string, string>): SpanContext | null;
  injectContext(ctx: SpanContext, headers: Record<string, string>): void;
  flush(): Promise<void>;
  shutdown(): void;
}
```

**Middleware integration:** `otelMiddleware(tracer: OtelTracer)` returns a `MiddlewareFn` that:
1. Extracts trace context from `traceparent` header
2. Starts a span with HTTP method, route, and host attributes
3. Calls `next()`
4. Ends the span with the response status code
5. Injects the context into `ctx.state['otelSpan']` for downstream use (e.g., DB query child spans)

**Buffer and retry:** Spans accumulate in a bounded array (default max: 1,000). A background flush loop runs every 5 seconds; exponential backoff on export failure; a single `warn` log is emitted per drop event.

---

### 12. Structured Logging (`observability/logger.ts`)

```typescript
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;   // ISO 8601
  level: LogLevel;
  message: string;
  correlationId?: string;
  service: string;
  [key: string]: unknown;
}

export class Logger {
  constructor(opts: { service: string; level?: LogLevel; stream?: NodeJS.WritableStream });
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
  // Injects correlationId into all child logger entries
}
```

**Correlation ID middleware:** `correlationMiddleware(logger: Logger)` generates or extracts `X-Correlation-ID`, attaches it to `ctx.state['correlationId']`, and creates a child logger stored in `ctx.state['logger']`.

**Dev formatting:** When `NODE_ENV=development`, a `PrettyFormatter` transforms JSON entries into colorized single-line output. JSON serialization continues to a configurable `outputStream` (default: `process.stderr`).

**Error serialization:** If `meta` contains an `Error` instance (at any key), it is serialized as `{ name, message, stack }` before `JSON.stringify`.

---

### 13. Prometheus Exporter (`observability/prometheus.ts`)

```typescript
export type MetricType = 'counter' | 'gauge' | 'histogram';

export class MetricsRegistry {
  counter(name: string, help: string, labels?: string[]): Counter;
  gauge(name: string, help: string, labels?: string[]): Gauge;
  histogram(name: string, help: string, buckets?: number[], labels?: string[]): Histogram;
  collect(): string;   // returns Prometheus text exposition format 0.0.4
}

export class Counter {
  inc(labels?: Record<string, string>, value?: number): void;
}
export class Gauge {
  set(value: number, labels?: Record<string, string>): void;
}
export class Histogram {
  observe(value: number, labels?: Record<string, string>): void;
}
```

**Default metrics** are registered automatically in `prometheusMiddleware(registry)`:
- `http_requests_total` (counter, labels: method, route, status)
- `http_request_duration_seconds` (histogram, labels: method, route)
- `process_heap_bytes` (gauge, collected from `process.memoryUsage()`)
- `db_pool_connections` (gauge, labels: state ∈ {idle, active, waiting})

**Thread safety:** All counter increments use `Map<string, number>` with synchronous reads, which is safe in Node.js's single-threaded event loop. The `/metrics` route handler calls `registry.collect()` inside a single synchronous call, producing a consistent snapshot.

**Conflict detection:** `counter()`/`gauge()`/`histogram()` check the registry map for name collisions and throw `MetricConflictError` if found.

---

### 14. Health Check DSL (`observability/health.ts`)

```typescript
export type CheckType = 'liveness' | 'readiness';
export type CheckStatus = 'up' | 'down';

export interface CheckResult { status: CheckStatus; details?: Record<string, unknown>; }
export type CheckFn = () => Promise<CheckResult>;

export class HealthCheckRegistry {
  addCheck(name: string, fn: CheckFn, opts?: { type?: CheckType; timeoutMs?: number }): void;
  runLiveness(): Promise<HealthResponse>;
  runReadiness(): Promise<HealthResponse>;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: Record<string, CheckResult & { durationMs: number }>;
}
```

**Route registration:** `registerHealthRoutes(app, registry)` registers `GET /health/live` and `GET /health/ready` on the `StreetApp`. Each route calls `registry.runLiveness()` or `registry.runReadiness()`, returning 200 if all checks pass or 503 if any fail.

**Timeout handling:** Each check is wrapped in `Promise.race([fn(), timeoutPromise])`. The timeout promise resolves to `{ status: 'down', details: { reason: 'timeout' } }` after the configured milliseconds.

**Exception safety:** Each check is wrapped in a `try/catch`; thrown errors are caught and returned as `{ status: 'down', details: { error: err.message } }`.

---

### 15. Request Profiler & Diagnostics Dashboard (`observability/`)

**Per-route ring buffer:** `RouteProfiler` maintains a `Map<routeKey, CircularBuffer<LatencySample>>` with a maximum of 10,000 samples per route. `routeKey` is `METHOD:pattern`.

```typescript
export class RouteProfiler {
  record(method: string, pattern: string, latencyNs: bigint, isError: boolean): void;
  stats(method: string, pattern: string): RouteStats;
  allStats(): Map<string, RouteStats>;
}

export interface RouteStats {
  count: number; errorRate: number;
  p50Ms: number; p95Ms: number; p99Ms: number;
}
```

**Diagnostics socket server:** `DiagnosticsServer` listens on a Unix domain socket (`/tmp/street-<pid>.sock`). The `street diagnostics` CLI command connects to it, reads a JSON snapshot every 1 second, and renders a terminal table using ANSI escape sequences. No third-party terminal UI library.

```typescript
export class DiagnosticsServer {
  constructor(opts: { socketPath?: string; profiler: RouteProfiler; pool?: PgPool });
  start(): void;
  stop(): void;
}
```

**Stale socket cleanup:** The CLI command checks if the socket file exists and whether its PID (extracted from the filename) is still running via `process.kill(pid, 0)`. If the process is gone, it removes the socket file and prints a warning.

---

## v1.4 — Authentication & Authorization

### 16. OAuth2 / OpenID Connect (`auth/oauth2.ts`)

**Approach:** Implement RFC 6749 Authorization Code Flow + RFC 7636 PKCE using `node:crypto` and `node:https`. Three built-in provider configurations (Google, GitHub, Microsoft). JWKS key caching with a 5-minute TTL.

```typescript
export interface OAuthProvider {
  name: 'google' | 'github' | 'microsoft';
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
}

export interface OAuthProfile {
  id: string; email: string; name: string; avatarUrl: string;
}

export interface OAuthTokens {
  accessToken: string; idToken?: string; refreshToken?: string; expiresIn: number;
}

export type OAuthSuccessCallback = (profile: OAuthProfile, tokens: OAuthTokens, ctx: StreetContext) => Promise<void>;
export type OAuthErrorCallback = (err: Error, ctx: StreetContext) => Promise<void>;

export class OAuthManager {
  constructor(opts: { providers: OAuthProvider[]; sessionManager: SessionManager });
  authorizationUrl(provider: string): Promise<{ url: string; state: string; codeVerifier: string }>;
  handleCallback(provider: string, code: string, state: string, sessionState: string, codeVerifier: string): Promise<{ profile: OAuthProfile; tokens: OAuthTokens }>;
  middleware(provider: string, onSuccess: OAuthSuccessCallback): MiddlewareFn;
}
```

**PKCE:** `code_verifier` = 32 random bytes as base64url. `code_challenge` = `S256` (SHA-256 of verifier). Both stored in the encrypted session before redirect.

**JWKS caching:** A `JwksCache` class fetches from the provider's `jwks_uri` at first use and on every 5-minute TTL expiry. Key lookup is by `kid` claim. Signature verification uses `node:crypto`'s `verify()` with the RSA or EC public key reconstructed from JWK.

**State CSRF protection:** `state` is a 32-byte random hex string stored in the session. On callback, the session value and the query parameter are compared with `timingSafeEqual`.

---

### 17. API Keys (`auth/api-keys.ts`)

```typescript
export interface ApiKey {
  id: string; keyHash: string; prefix: string;
  name: string; ownerId: string; expiresAt: Date | null; createdAt: Date;
}

export class ApiKeyService {
  constructor(private readonly pool: PgPool);
  async generate(opts: { ownerId: string; name: string; prefix?: string; expiresAt?: Date }): Promise<{ key: string; record: ApiKey }>;
  // Returns the raw key ONCE; stores only SHA-256 hash
  async verify(rawKey: string): Promise<ApiKey | null>;
  // Constant-time hash comparison; returns null for expired or revoked keys
  async revoke(id: string): Promise<void>;
  // Deletes from table + clears LRU cache entry
}

export function apiKeyMiddleware(service: ApiKeyService): MiddlewareFn;
// Extracts 'Authorization: Bearer sk_...' header, calls service.verify()
// Sets ctx.user = { id: apiKey.ownerId, email: '', roles: [] }
```

**Key generation:** `randomBytes(32).toString('base64url')` prefixed with a configurable namespace. **Storage:** `createHash('sha256').update(rawKey).digest('hex')`. **Timing safety:** `timingSafeEqual(Buffer.from(storedHash, 'hex'), computedHash)` with equal-length check before comparison.

**LRU caching:** Verified keys are cached in the existing `LruCache<string, ApiKey>` for 60 seconds. Revocation removes the cache entry immediately.

---

### 18. Refresh Tokens & Token Rotation (`auth/refresh-tokens.ts`)

```typescript
export class RefreshTokenService {
  constructor(private readonly pool: PgPool, private readonly jwt: JwtService);
  async issue(userId: string, familyId?: string): Promise<{ accessToken: string; refreshToken: string }>;
  async rotate(rawRefreshToken: string): Promise<{ accessToken: string; refreshToken: string }>;
  // Atomically: verify hash, invalidate old token, issue new token + access token
  // On replay: revoke entire family, throw SecurityEvent
  async revokeFamily(familyId: string): Promise<void>;
  async revokeAll(userId: string): Promise<void>;
}
```

**Schema:** `street_refresh_tokens(id, token_hash, family_id, user_id, expires_at, revoked_at, created_at)`. All operations within a single `pool.transaction()`.

**Replay detection:** `UPDATE ... WHERE token_hash=$1 AND revoked_at IS NULL` returns `rowCount`. If 0, the token was already used — revoke the entire `family_id` and throw `TokenReplayError`.

---

### 19. RBAC & Permission Decorators (`auth/rbac.ts`)

```typescript
export interface RoleHierarchy {
  [role: string]: string[];  // role -> list of roles it inherits
}

export class RbacService {
  constructor(hierarchy: RoleHierarchy);
  hasRole(userRoles: string[], requiredRole: string): boolean;
  hasPermission(userRoles: string[], permission: string): boolean;
  // Resolves flattened permission set from role hierarchy at startup
}

// Decorators — attach metadata read by a guard middleware
export function Roles(...roles: string[]): MethodDecorator;
export function Permissions(...perms: string[]): MethodDecorator;

// Middleware factory
export function rbacGuard(service: RbacService): MiddlewareFn;
// Reads 'street:roles' and 'street:permissions' metadata from the route handler
// Checks ctx.user against required roles/permissions; throws ForbiddenException on failure
```

**Hierarchy resolution:** On `RbacService` construction, the hierarchy is traversed using BFS to build a `Map<role, Set<permissions>>`. All checks are synchronous in-memory lookups — no per-request DB queries.

---

### 20. WebAuthn / Passkeys (`auth/webauthn.ts`)

```typescript
export interface WebAuthnConfig {
  rpName: string; rpId: string; origin: string;
  challengeExpiryMs?: number;  // default: 60000
}

export class WebAuthnService {
  constructor(opts: WebAuthnConfig, pool: PgPool);

  async beginRegistration(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON>;
  async finishRegistration(userId: string, credential: RegistrationResponseJSON): Promise<{ credentialId: string }>;
  // Verifies attestation, validates challenge from session, stores public key + signCount

  async beginAuthentication(userId: string): Promise<PublicKeyCredentialRequestOptionsJSON>;
  async finishAuthentication(userId: string, assertion: AuthenticationResponseJSON): Promise<void>;
  // Verifies assertion signature, enforces signCount > stored, updates stored signCount
}
```

**Crypto:** CBOR decoding of attestation/assertion objects implemented using `node:buffer` and a minimal CBOR parser (no external library). Signature verification uses `node:crypto`'s `createVerify()` with P-256/RS256 keys. Challenge storage is in the encrypted session with a 60-second expiry timestamp.

---

### 21. Session Revocation & Audit Trails (`auth/`)

**Session revocation:** Extend `SessionManager` with a `StreetSessionStore` backed by a `street_sessions` table. Each session has a `session_id` (stored in the cookie). On every authenticated request, the session ID is checked against a `revoked_sessions` set (LRU cache + DB fallback). `revokeSession(id)` inserts to the revocation table and removes from cache.

**Audit log:** `AuditWriter` class wraps `pool.transaction()` and writes to `street_audit_log`. The write is not optional — if it fails, the calling transaction is rolled back.

```typescript
export type AuditEvent = 'login_success' | 'login_failure' | 'logout' | 'token_refresh' | 'session_revoked' | 'permission_denied';

export interface AuditRecord {
  eventType: AuditEvent; actorId: string; ip: string;
  userAgent: string; timestamp: Date; outcome: 'success' | 'failure'; details?: object;
}

export class AuditWriter {
  constructor(private readonly pool: PgPool);
  async write(record: AuditRecord): Promise<void>;
}
```

---

## v1.5 — Background Processing

### 22. Job Queue & Cron Scheduler (`jobs/queue.ts`, `jobs/scheduler.ts`)

**Job Queue:** Uses PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` as the locking mechanism — no Redis, no external queue service.

```typescript
export interface JobOptions {
  type: string;
  payload: unknown;
  runAt?: Date;        // defaults to NOW()
  maxAttempts?: number;
  priority?: number;
}

export class JobQueue {
  constructor(opts: { pool: PgPool; pollIntervalMs?: number; concurrency?: number });
  async enqueue(opts: JobOptions): Promise<string>;  // returns job ID
  register(type: string, handler: JobHandler): void;
  async start(): Promise<void>;
  async stop(): Promise<void>;
}

export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<void>;
export interface JobContext { jobId: string; attempt: number; signal: AbortSignal; }
```

**Schema:** `street_jobs(id UUID, type TEXT, payload JSONB, status TEXT, attempt_count INT, run_at TIMESTAMPTZ, created_at TIMESTAMPTZ, worker_id TEXT, locked_at TIMESTAMPTZ, error TEXT)`.

**Polling loop:** `setInterval` acquires up to `concurrency` jobs per tick using `SELECT ... FOR UPDATE SKIP LOCKED LIMIT $1`. Each job is processed in its own try/catch; failures increment `attempt_count` and reschedule or move to DLQ.

**Cron Scheduler:**

```typescript
export class CronScheduler {
  register(expression: string, name: string, fn: () => Promise<void>): void;
  // Throws CronParseError if expression is invalid (validated with a 5-field cron parser)
  start(): void;
  stop(): void;
}

export class CronParseError extends Error {
  constructor(expression: string, reason: string) { ... }
}
```

**Single-instance guard:** A boolean `running` flag per job prevents overlapping executions. The next tick is scheduled only after the current execution completes.

---

### 23. Delayed Jobs, Retry Policies & Dead Letter Queues

**Retry policy per job type:**
```typescript
export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;  // capped at 3_600_000
}
```

**Backoff formula:** `Math.min(initialDelayMs * Math.pow(backoffMultiplier, attempt), maxDelayMs)` — geometric backoff invariant as specified in the requirements.

**DLQ:** When `attempt_count >= maxAttempts`, the job is moved to `street_dead_letter_queue` in the same transaction that marks the job as failed. DLQ pruning: a background job runs daily and deletes oldest entries beyond `maxDeadLetterEntries`.

**Delayed execution:** `runAt` is stored in the `street_jobs` table. The polling loop filters `WHERE run_at <= NOW()`.

---

### 24. Workflow Engine (`jobs/workflow.ts`)

```typescript
export interface WorkflowStep<TInput, TOutput> {
  name: string;
  run(input: TInput, ctx: WorkflowContext): Promise<TOutput>;
  compensate?: (input: TInput, ctx: WorkflowContext) => Promise<void>;
  timeoutMs?: number;
}

export class WorkflowEngine {
  define<T>(name: string, steps: WorkflowStep<T, T>[]): WorkflowDefinition<T>;
  async start(name: string, input: unknown): Promise<string>;   // returns workflowId
  async resume(workflowId: string): Promise<void>;              // resumes from last persisted step
}
```

**Persistence schema:** `street_workflows(id, name, status, current_step, step_outputs JSONB, input JSONB, error TEXT, created_at, updated_at)`.

**Step execution:** Each step's output is serialized to JSONB and stored in `step_outputs[stepName]`. On resume, completed steps are skipped by checking `step_outputs`.

**Compensation:** On step failure, compensation functions run in reverse order (from the failed step backwards). Compensation errors are logged but do not block the rollback sequence.

**Timeout:** Each step is wrapped in `Promise.race([step.run(), timeoutPromise])`. On timeout, the compensation function runs and the workflow is marked `timed_out`.

---

### 25. Distributed Jobs & Queue Monitoring (`jobs/dashboard.ts`)

**Multi-worker support:** Multiple Node.js processes share the same `street_jobs` table. `SELECT ... FOR UPDATE SKIP LOCKED` is the MVCC-based coordination mechanism — no additional locking needed.

**Heartbeat:** Each worker writes its `worker_id` and `locked_at` timestamp when acquiring a job. A background process (part of the queue itself) scans for jobs where `locked_at < NOW() - interval '2 minutes'` and re-enqueues them (crashed worker recovery).

**Metrics endpoint:** `GET /api/jobs/metrics` returns:
```json
{ "pending": 0, "inFlight": 0, "failed": 0, "succeeded": 0, "byType": { "send-email": { "avgDurationMs": 123 } } }
```

**Dashboard CLI:** `street jobs:dashboard` connects to the running process via the `DiagnosticsServer` Unix socket (re-using the v1.3 socket infrastructure) and renders a live terminal view refreshed every 2 seconds.

**History pruning:** A background job (cron, registered with `CronScheduler`) runs nightly and deletes `street_job_history` entries beyond 1,000 per job type.

---

## v1.6 — API Platform

### 26. GraphQL Server (`graphql/`)

**Approach:** Implement a GraphQL execution engine from scratch using `node:crypto` (for subscription ID generation) and the GraphQL specification. Parse SDL schemas with a hand-written recursive-descent parser. No `graphql-js` dependency.

```typescript
export interface ResolverMap {
  [typeName: string]: {
    [fieldName: string]: (parent: unknown, args: Record<string, unknown>, ctx: StreetContext) => unknown;
  };
}

export class GraphQlEngine {
  constructor(opts: { schema: string; resolvers: ResolverMap; maxDepth?: number; maxComplexity?: number });
  execute(query: string, variables?: Record<string, unknown>, ctx?: StreetContext): Promise<GraphQlResponse>;
  subscribe(query: string, variables?: Record<string, unknown>, ctx?: StreetContext): AsyncIterator<GraphQlResponse>;
}

export interface GraphQlResponse {
  data?: unknown;
  errors?: Array<{ message: string; locations?: Array<{ line: number; column: number }>; path?: string[] }>;
}
```

**Depth and complexity:** Checked at document parse time before execution. A recursive visitor counts nesting depth and accumulated field weights (default: 1 per field). Violations return a 400 response without executing.

**Subscriptions:** Use the existing `StreetWebSocketServer` with the `graphql-ws` subprotocol. `subscribe()` returns an `AsyncIterator` that is pumped by `SseConnection` or WebSocket framing.

**Introspection guard:** When `introspection: false`, the schema's type definitions are not exposed. `__schema` and `__type` field access in the executor returns a field-not-found error.

---

### 27. API Versioning (`versioning/strategy.ts`)

```typescript
export type VersionStrategy = 'url' | 'header';

export function ApiVersion(version: string): ClassDecorator;
// Attaches version string to controller metadata under 'street:apiVersion'

export interface VersioningOptions {
  strategy: VersionStrategy;
  headerName?: string;  // default: 'Accept' with vnd content type
}

// Used by streetApp:
export function enableVersioning(app: StreetApp, opts: VersioningOptions): void;
// Wraps the router to prefix-match version before dispatching
```

**URL strategy:** Controllers decorated with `@ApiVersion('v2')` have their routes prefixed with `/v2/` at registration time. The existing `Router.add()` call receives the prefixed path.

**Header strategy:** A pre-dispatch middleware reads `Accept: application/vnd.street.v2+json`, extracts the version, and routes to the matching versioned controller by rewriting `ctx.path` with a version prefix prefix before dispatch.

**`@Deprecated` decorator:** Attaches `{ sunset: Date }` to route metadata. A post-dispatch middleware checks the metadata and adds `Sunset` and `Deprecation` headers to the response.

---

### 28. SDK Generator (`sdk-gen/`)

**TypeScript SDK:** `street generate sdk --lang typescript` reads the project's `openapi.json` (via `app.openApiSpec()`), iterates `paths`, and generates:
- A `types.ts` file with request/response interfaces
- An `ApiClient.ts` class with one method per `operationId`, using the native `fetch` API

```typescript
export function generateTypescriptSdk(spec: OpenApiSpec, outputDir: string): Promise<void>;
export function generatePythonSdk(spec: OpenApiSpec, outputDir: string): Promise<void>;
```

**Python SDK:** Generates dataclasses (Python 3.10+ standard library) for request/response models and a `urllib.request`-based client class. No third-party Python dependencies.

**CLI command:** `street generate sdk --lang <typescript|python> --output <dir>` loads `openApiSpec()` from the compiled project, calls the appropriate generator.

---

### 29. Rate Limit Policies & API Analytics (`observability/analytics.ts`)

**Per-route rate limit:** New `@RateLimit({ requests, window, key })` decorator attaches rate limit config to route metadata. The `rateLimitMiddleware` factory reads this metadata and creates a per-route `RateLimiter` instance (reusing the existing `RateLimiter` class from `security/ratelimit.ts`).

```typescript
export function RateLimit(opts: { requests: number; window: string; key?: 'ip' | 'user' | 'apiKey' }): MethodDecorator;
```

**API Analytics:** `AnalyticsMiddleware` records events to `street_api_events(route, method, status, duration_ms, user_id, created_at)` using batched inserts (flush every 100 events or 5 seconds, whichever comes first). Retention pruning runs via `CronScheduler`.

```typescript
export class AnalyticsService {
  constructor(opts: { pool: PgPool; batchSize?: number; flushIntervalMs?: number; retentionDays?: number });
  middleware(): MiddlewareFn;
  async report(from: Date, to: Date): Promise<AnalyticsReport>;
  async flush(): Promise<void>;
  async close(): Promise<void>;
}
```

---

### 30. Webhook Management (`webhook/manager.ts`)

**Approach:** Extend the existing `WebhookDispatcher` with a database-backed endpoint registry and persistent delivery log. The existing `WebhookDispatcher` handles the actual HTTP delivery; this layer adds management.

```typescript
export class WebhookManager {
  constructor(opts: { pool: PgPool; dispatcher: WebhookDispatcher });
  async registerEndpoint(url: string, events: string[], secret?: string): Promise<WebhookEndpoint>;
  async publish(event: string, payload: unknown): Promise<void>;
  // Queries street_webhook_endpoints, enqueues delivery for each matching endpoint
  async deliveryLog(endpointId: string, limit?: number): Promise<WebhookDelivery[]>;
  async revokeEndpoint(id: string): Promise<void>;
}
```

**Delivery log:** Each delivery attempt is recorded in `street_webhook_deliveries(id, endpoint_id, event, payload_hash, status, response_status, response_body_truncated, attempt, created_at)`.

**Incoming webhook validation:** `verifyIncomingWebhook(secret, signature, rawBody): boolean` — HMAC-SHA256 constant-time comparison, re-using `signPayload` from `dispatcher.ts`.

---

## v1.7 — Multi-Tenancy

### 31. Tenant Isolation & Routing (`tenancy/context.ts`)

```typescript
export type TenantResolutionStrategy = 'subdomain' | 'path' | 'header';

export interface TenantContextData {
  tenantId: string;
  connectionPool: PgPool;
  plan: string;
}

export function tenantMiddleware(opts: {
  strategy: TenantResolutionStrategy;
  resolver: (ctx: StreetContext) => Promise<TenantContextData | null>;
}): MiddlewareFn;
// Populates ctx.state['tenant']; returns 400 if null

export function TenantScoped(): ClassDecorator;
// Marks a repository class; repository's findAll/findById/create/update/delete
// automatically prepend WHERE tenant_id = $tenantId using ctx.state['tenant']
```

**Per-tenant pools:** `TenantPoolRegistry` maintains a `Map<tenantId, PgPool>`. On first access, the pool is created from the connection string stored in `street_tenants`. Idle pools are reaped after a configurable timeout.

**Data isolation guarantee:** The `@TenantScoped()` decorator modifies the repository's SQL generation to include `tenant_id = $N` in every WHERE clause and an implicit `tenant_id = $N` in every INSERT.

---

### 32. Tenant Provisioning, Billing & Quotas (`tenancy/provisioner.ts`)

```typescript
export class TenantService {
  constructor(opts: { pool: PgPool; migrationRunner: StreetMigrationRunner });
  async provision(opts: { name: string; plan: string; adminEmail: string }): Promise<Tenant>;
  // Atomic: INSERT into street_tenants, run tenant migrations, emit 'tenant:provisioned' event
  async deactivate(tenantId: string): Promise<void>;
  async checkQuota(tenantId: string, quotaKey: string): Promise<QuotaStatus>;
}

export interface TenantBillingAdapter {
  reportUsage(tenantId: string, period: BillingPeriod, metrics: UsageMetrics): Promise<void>;
}

export class QuotaEnforcer {
  constructor(opts: { pool: PgPool; cache: LruCache<string, QuotaStatus> });
  middleware(): MiddlewareFn;
  // Checks quota before handler; returns 429 with quota details if exceeded
  // Emits 'tenant:quota:warning' event at 80% threshold
}
```

---

### 33. Tenant Metrics (`tenancy/metrics.ts`)

All Prometheus metrics in multi-tenant mode include a `tenant_id` label. `TenantMetricsRegistry` is a wrapper over `MetricsRegistry` that enforces the tenant label on all operations and caps at 10,000 tenant entries with LRU eviction.

```typescript
export class TenantMetricsRegistry {
  constructor(opts: { registry: MetricsRegistry; maxTenants?: number });
  forTenant(tenantId: string): TenantMetricsView;
  // Evicts LRU tenant entry when at capacity
}
```

Daily stats aggregation runs via `CronScheduler` and writes to `street_tenant_daily_stats(tenant_id, date, metrics JSONB)`.

---

## v2.0 — Microservices

### 34. HTTP/2 & gRPC (`microservices/http2.ts`, `microservices/grpc/`)

**HTTP/2:** `StreetHttp2App` wraps `node:http2`'s `createSecureServer()`. Implements the same `registerController()` / `use()` interface as `StreetApp` so controllers are portable.

```typescript
export function streetHttp2App(opts: Http2AppOptions & { key: Buffer; cert: Buffer }): StreetApp;
```

**gRPC:** A `.proto` file parser built on `node:fs` reads service definitions. Generated TypeScript types are written to disk by `street generate grpc --proto ./service.proto`. The gRPC server uses `node:net` (plain TCP, not TLS) for inter-service communication, handling the HTTP/2 framing required by the gRPC wire format.

```typescript
export class GrpcServer {
  constructor(opts: { host?: string; port?: number; maxMessageBytes?: number });
  registerService(serviceDef: ServiceDefinition, implementation: ServiceImplementation): void;
  async start(): Promise<void>;
  async stop(): Promise<void>;
}
```

**Deadlines and cancellation:** The gRPC server reads the `grpc-timeout` header, creates an `AbortController`, and passes `ctx.signal` to the handler. When `grpc-timeout` expires, `AbortController.abort()` is called.

---

### 35. Service Discovery & Circuit Breakers (`microservices/service-registry.ts`, `microservices/circuit-breaker.ts`)

```typescript
export interface ServiceInstance { id: string; host: string; port: number; healthStatus: 'healthy' | 'unhealthy'; }

export interface ServiceRegistryBackend {
  resolve(name: string): Promise<ServiceInstance[]>;
  register(name: string, instance: ServiceInstance): Promise<void>;
  deregister(id: string): Promise<void>;
}

// Implementations: StaticRegistry, ConsulRegistry, EtcdRegistry
export class ServiceRegistry {
  constructor(backend: ServiceRegistryBackend);
  async resolve(name: string): Promise<ServiceInstance>;
}
```

```typescript
export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold: number; successThreshold: number; openTimeoutMs: number;
}

export class CircuitBreaker extends EventEmitter {
  constructor(name: string, opts: CircuitBreakerOptions);
  async execute<T>(fn: () => Promise<T>): Promise<T>;
  // Throws CircuitOpenError when state is 'open'
  get state(): CircuitState;
}

export class CircuitOpenError extends StreetException {
  constructor(name: string) { super(503, `Circuit ${name} is open`); }
}
```

**State machine transitions:** `closed → open` when `failureCount >= failureThreshold`. `open → half-open` after `openTimeoutMs`. `half-open → closed` when `successCount >= successThreshold`; `half-open → open` on next failure. No other transitions are possible (enforced by the state machine switch).

---

### 36. Message Queues & Event Bus (`microservices/event-bus.ts`)

```typescript
export interface EventBusTransport {
  publish(topic: string, envelope: EventEnvelope): Promise<void>;
  subscribe(topic: string, handler: (env: EventEnvelope) => Promise<void>): Promise<() => void>;
  // Returns an unsubscribe function that cleans up all listeners
}

export interface EventEnvelope {
  id: string; topic: string; timestamp: Date; version: number; payload: unknown;
}

export class EventBus {
  constructor(transport?: EventBusTransport);
  // Default transport is in-process (EventEmitter-based)
  publish(topic: string, payload: unknown): Promise<void>;
  subscribe(topic: string, handler: EventHandler): Promise<() => void>;
}

// Adapters: RedisTransport, RabbitMQTransport (in microservices/transports/)
```

**At-least-once:** External transports only ACK a message after the handler returns successfully. On handler exception, the message is NACKed and redelivered. Dead letter routing uses a configurable `deadLetterTopic`.

---

### 37. Saga, Distributed Locks, CQRS, Event Sourcing (`microservices/`)

```typescript
// Saga
export class SagaOrchestrator {
  async execute(steps: Array<{ action: () => Promise<void>; compensate?: () => Promise<void> }>): Promise<void>;
}

// Distributed Lock (PostgreSQL advisory locks)
export class DistributedLock {
  constructor(private readonly pool: PgPool);
  async acquire(key: string, ttlMs?: number): Promise<LockHandle>;
}
export interface LockHandle { release(): Promise<void>; }

// CQRS
export class CommandBus {
  register<T>(commandType: Constructor<T>, handler: CommandHandler<T>): void;
  dispatch<T>(command: T): Promise<void>;
}
export class QueryBus {
  register<T, R>(queryType: Constructor<T>, handler: QueryHandler<T, R>): void;
  dispatch<T, R>(query: T): Promise<R>;
}

// Event Store
export class EventStore {
  constructor(private readonly pool: PgPool);
  async append(aggregateId: string, events: DomainEvent[], expectedVersion?: number): Promise<void>;
  async load(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]>;
}
```

**Distributed lock implementation:** `pg_try_advisory_lock(hashKey)` in a transaction. The lock handle's `release()` calls `pg_advisory_unlock(hashKey)`. TTL is enforced via a `setTimeout` that calls `release()` if the lock handle is not manually released.

**Event store append invariant:** `INSERT INTO street_events (aggregate_id, version, type, payload) VALUES ...` with a unique constraint on `(aggregate_id, version)`. Optimistic concurrency: if `expectedVersion` is provided, a `SELECT MAX(version) WHERE aggregate_id=$1` check is done in the same transaction before insert.

---

## v2.1 — Cloud Native

### 38. Container Orchestration Adapters (`cloud/deployment.ts`)

**Manifest generation:** `street deploy:init --platform <kubernetes|cloudrun|ecs|nomad>` reads `street.config.ts` and writes platform-specific YAML/JSON manifests to a `deploy/` directory.

- **Kubernetes:** `Deployment`, `Service`, `ConfigMap`, `HorizontalPodAutoscaler` with liveness/readiness probe paths pointing to `/health/live` and `/health/ready`
- **Cloud Run:** `service.yaml` with `containerConcurrency`, `timeoutSeconds`, and structured logging config
- **ECS:** Task definition JSON with health check configuration
- **Nomad:** HCL job spec with service health check stanza

**Graceful shutdown:** `registerShutdownHook(app, pool, opts?: { graceMs })` registers `SIGTERM` → drain HTTP → close connections → exit 0. Already present in `main.ts`; extracted to a standalone exportable function for use in any entry point.

**Cloud Run auto-detection:** `detectCloudRunEnvironment()` checks `K_SERVICE` and `K_REVISION` env vars. When detected, `Logger` outputs JSON in the GCP logging format.

---

### 39. Secret Providers (`cloud/secret-providers.ts`)

```typescript
export interface SecretProvider {
  get(key: string): Promise<string>;
  // Returns cached value if within TTL
}

// Implementations
export class VaultSecretProvider implements SecretProvider {
  constructor(opts: { address: string; token: string; mount?: string; ttlMs?: number });
}
export class AwsSecretsManagerProvider implements SecretProvider {
  constructor(opts: { region: string; accessKeyId?: string; secretAccessKey?: string; ttlMs?: number });
}
export class GcpSecretManagerProvider implements SecretProvider {
  constructor(opts: { projectId: string; ttlMs?: number });
}
```

**Cache:** Each provider maintains a `Map<key, { value, expiresAt }>`. On `get()`, if `Date.now() < expiresAt`, return the cached value. Otherwise fetch, store, and return.

**Redaction:** `SecretProvider.get()` never logs values. All log calls inside providers use `[REDACTED]` as the value placeholder.

**Secret rotation:** Each provider emits a `rotate` event when its TTL expires. Callers (e.g., `PgPool`) listen for this event and call a provided `onRotate` callback (e.g., recycle pool connections).

**Startup retry:** If a provider fails on first access, it retries with exponential backoff for 60 seconds (10 attempts at 1s, 2s, 4s, 8s, ... capped at 10s) before exiting with code 1.

---

### 40. Service Mesh & Auto-Scaling Metrics (`cloud/`)

**Service mesh compatibility:** No code changes required for transparent sidecar injection. The HTTP/2 server already emits correct ALPN negotiation (`h2`, `http/1.1`) via `node:tls`. `STREET_READINESS_DELAY_MS` env var adds a startup delay before the readiness probe returns `up`.

**Auto-scaling metrics endpoint:** `GET /metrics/autoscale` returns metrics in the [Kubernetes External Metrics API](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) JSON format:

```json
{ "kind": "ExternalMetricValueList", "items": [
  { "metricName": "http_requests_per_second", "value": "42" },
  { "metricName": "active_connections", "value": "120" },
  { "metricName": "queue_depth", "value": "5" }
]}
```

**Internal retry disable:** When `ISTIO_META_MESH_ID` or `LINKERD_PROXY_INJECTION_ENABLED` is detected, `RetryPolicy.enabled` defaults to `false` for all circuit breakers.

---

### 41. Edge Runtime Adapter (`cloud/edge-adapter.ts`)

```typescript
// @streetjs/edge — separate package, tree-shakeable
export function handleEdgeRequest(
  request: Request,  // Web Fetch API Request
  app: StreetApp
): Promise<Response>;
// Maps Web Fetch Request → StreetContext → runs pipeline → builds Response from ctx
```

**Tree-shaking:** The edge build uses `"browser"` condition exports in `package.json` to replace `node:net`, `node:cluster`, `node:fs` imports with no-op stubs that throw `FeatureUnavailableInEdgeRuntimeError` when instantiated.

```typescript
export class FeatureUnavailableInEdgeRuntimeError extends Error {
  constructor(feature: string) {
    super(`Feature '${feature}' is not available in edge runtimes.`);
  }
}
```

**Supported features in edge:** routing, middleware pipeline, DI container, request/response, JSON, validation, LRU cache, JWT verification. **Not supported:** PgPool, WebSocket server, Cluster coordinator, SSE with persistent connections, filesystem operations.

---

## v2.2 — Enterprise Platform

### 42. Feature Flags (`enterprise/feature-flags.ts`)

```typescript
export interface FlagRule {
  type: 'user_id' | 'role' | 'percentage' | 'environment';
  value: string | number;
  enabled: boolean;
}

export interface FeatureFlag {
  name: string; enabled: boolean; rules?: FlagRule[];
}

export class FeatureFlagService {
  constructor(opts: { pool: PgPool; cache: LruCache<string, boolean>; ttlMs?: number });
  async isEnabled(flagName: string, context?: FlagContext): Promise<boolean>;
  // Returns false + logs warn if flag not found in DB
  async invalidateCache(flagName: string): Promise<void>;
}

export interface FlagContext {
  userId?: string; roles?: string[]; environment?: string;
}
```

**Percentage rollout:** `isEnabled` for a `percentage` rule uses a stable hash: `createHash('sha256').update(flagName + userId).digest('hex')`. The first 8 hex characters are converted to a number mod 100. Same user always sees the same result.

**Admin API:** `PATCH /admin/feature-flags/:name` forces cache invalidation. Protected by `requireRoles('admin')`.

---

### 43. Audit Logging (`enterprise/audit-logger.ts`)

```typescript
export type AuditCategory = 'auth' | 'data_access' | 'data_mutation' | 'config_change' | 'admin_action' | 'security_violation';

export class AuditLogger {
  constructor(opts: { pool: PgPool; signingKey: string });
  async log(opts: AuditLogOptions): Promise<void>;
  // Writes to street_audit_log; signs the batch with HMAC-SHA256
  async export(from: Date, to: Date, format: 'jsonl' | 'csv'): Promise<Readable>;
}

export interface AuditLogOptions {
  category: AuditCategory;
  actorId: string;
  action: string;
  resource?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  // Fields annotated with @Sensitive() are redacted
}
```

**Tamper detection:** Each batch of 100 audit log entries is signed. The signature covers `SHA256(previousSignature + batchJSON)`, chaining signatures. Verification reads batches in sequence and checks the chain.

**Append-only enforcement:** No `DELETE` or `UPDATE` SQL is generated by `AuditLogger`. The `street_audit_log` table has a `RULE` or `TRIGGER` at the database level to enforce this.

**`@Sensitive()` decorator:** Marks entity fields as sensitive. `AuditLogger.log()` checks field metadata and replaces values with `"[REDACTED]"` before writing.

---

### 44. Data Retention, Encryption Policies & Classification (`enterprise/data-policy.ts`)

```typescript
export function RetainFor(duration: string): PropertyDecorator;
// e.g. @RetainFor('90 days') — stores metadata; retention job reads it

export function Encrypt(): PropertyDecorator;
// Transparent AES-256-GCM field encryption using vault key
// Repository layer intercepts create()/update() to encrypt and findById()/findAll() to decrypt

export function Classify(level: 'public' | 'internal' | 'confidential' | 'restricted'): PropertyDecorator;
// Logger checks classification level; fields above LOG_CLASSIFICATION_THRESHOLD are redacted

export class RetentionJob {
  constructor(opts: { pool: PgPool; batchSize?: number });
  async run(): Promise<{ deleted: number }>;
  // Reads entity decorator metadata, generates DELETE WHERE created_at < NOW() - interval
  // Operates in bounded batches to avoid long-running transactions
}

export class ComplianceReporter {
  static report(entities: Constructor[]): ComplianceReport;
  // Generates per-field report: name, classification, encrypted, retentionPeriod
}
```

---

### 45. Backup Framework & Disaster Recovery (`enterprise/backup.ts`)

```typescript
export interface StorageAdapter {
  write(key: string, stream: Readable): Promise<void>;
  read(key: string): Promise<Readable>;
  list(): Promise<string[]>;
}

// Implementations: LocalStorageAdapter, S3StorageAdapter, GcsStorageAdapter

export class BackupService {
  constructor(opts: { pool: PgPool; storage: StorageAdapter; scheduler?: CronScheduler });
  async backup(): Promise<BackupRecord>;
  // Streams pg_dump output (via wire protocol COPY TO STDOUT) to storage adapter
  // Computes SHA-256 checksum; stores in street_backups

  async restore(backupId: string, targetPool: PgPool): Promise<void>;
  // Fetches from storage, verifies checksum, applies SQL stream to target DB
}
```

**`pg_dump` via wire protocol:** The framework uses the PostgreSQL `COPY (SELECT ...) TO STDOUT` command over the existing `PgConnection` to stream table data without spawning an external process. Schema is dumped by querying `information_schema`. This preserves the zero-external-binary constraint.

**Checksum:** SHA-256 of the entire backup stream, computed incrementally via `createHash('sha256').update(chunk)`.

---

## v3.0 — Next Generation

### 46. Distributed Cache & Global Config Service (`platform/distributed-cache.ts`)

```typescript
export interface CacheTransport {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  subscribe(channel: string, handler: (msg: string) => void): Promise<() => void>;
  publish(channel: string, msg: string): Promise<void>;
}

export class DistributedCache {
  constructor(opts: { transport: CacheTransport; maxMemoryMb?: number });
  async get<T>(key: string): Promise<T | null>;
  async set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  async delete(key: string): Promise<void>;
  async invalidate(key: string): Promise<void>;
  // Publishes invalidation message; all nodes receive and evict their local copy
  // Invalidation propagated within 100ms (via pub/sub channel)
}

// Adapters: RedisTransport, MemcachedTransport, InProcessTransport
```

**Bounded memory:** When `maxMemoryMb` is set, the local in-memory replica of distributed cache entries is limited using the existing `LruCache` eviction policy.

**Global Config Service:**
```typescript
export class GlobalConfigService extends EventEmitter {
  constructor(opts: { transport: CacheTransport; instanceId?: string });
  async get(key: string): Promise<string | null>;
  async set(key: string, value: string): Promise<void>;
  // Publishes 'config:changed' event; all nodes emit { key, oldValue, newValue }
  // Propagation within 500ms via pub/sub
}
```

---

### 47. Event Streaming & Realtime Analytics (`platform/event-streaming.ts`)

```typescript
export class EventStreamPublisher {
  constructor(opts: { transport: StreamTransport });
  async publish(topic: string, payload: unknown): Promise<void>;
  // Wraps payload in envelope { id, topic, timestamp, version, payload }
}

export class EventStreamConsumer {
  constructor(opts: { transport: StreamTransport; groupId: string; maxLagThreshold?: number });
  subscribe(topic: string, handler: (env: EventEnvelope) => Promise<void>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  // Emits 'stream:lag' if consumer lag exceeds maxLagThreshold
}

// Adapters: KafkaTransport, KinesisTransport, InProcessTransport

export class RealtimeAggregator {
  constructor(opts: { windowMs: number; maxSubscriptions?: number });
  aggregate(topic: string, fn: AggregatorFn): string;   // returns aggregatorId
  subscribe(aggregatorId: string): SseConnection;
  // Pushes aggregate results to SSE subscribers on each window tick
}
```

---

### 48. Multi-Region Replication (`platform/replication.ts`)

```typescript
export interface RegionConfig {
  name: string; pool: PgPool; weight: number; isPrimary: boolean;
}

export class ReplicationCoordinator {
  constructor(opts: { regions: RegionConfig[]; healthCheckIntervalMs?: number });
  getWritePool(): PgPool;     // always the primary region
  getReadPool(preferredRegion?: string): PgPool;  // routes by weight or X-Preferred-Region
  async checkHealth(): Promise<Map<string, 'healthy' | 'unhealthy'>>;
  async promotePrimary(regionName: string): Promise<void>;
  // Updates routing table; emits 'region:promoted' event
}
```

**Failover detection:** `setInterval(() => checkHealth(), healthCheckIntervalMs)` pings each region's `ConnectionDiagnostics.ping()`. Primary failure detected within `healthCheckIntervalMs` (configurable, default: 10s). On failure, `promotePrimary(nextHealthyReplica)` is called automatically.

**`X-Preferred-Region` routing:** A middleware reads the header and looks up the preferred region's pool in `ReplicationCoordinator`. Falls back to default read pool if the region is unavailable.

**Replication lag metric:** `db_replication_lag_seconds` gauge is collected by querying `pg_stat_replication` on the primary and reported to `MetricsRegistry`.

---

### 49. AI Infrastructure Toolkit & Agent Framework (`platform/ai/`)

```typescript
// LLM Client
export interface LlmClient {
  complete(opts: CompletionOptions): Promise<CompletionResult>;
  stream(opts: CompletionOptions): AsyncIterator<string>;
}

// Implementations: OpenAiClient, AnthropicClient, OllamaClient
// All use node:https internally — no SDK dependencies

// Tool Registry
export class ToolRegistry {
  register<T extends object>(name: string, fn: TypedToolFn<T>, schema: ToolSchema): void;
  // schema is a JSON Schema object auto-generated from TypeScript types at build time
  toFunctionList(): LlmFunctionDef[];
}

// Agent Executor
export class AgentExecutor {
  constructor(opts: { llm: LlmClient; tools: ToolRegistry; maxSteps?: number; maxTokens?: number });
  async run(systemPrompt: string, userMessage: string, ctx?: StreetContext): Promise<AgentResult>;
  // Implements ReAct: think → act → observe loop
  // Emits SSE events to ctx.res if ctx is provided
  // Summarizes history when token limit is exceeded
}

export interface AgentResult {
  answer: string; steps: AgentStep[]; tokensUsed: number;
}

export interface AgentStep {
  type: 'thought' | 'action' | 'observation' | 'final';
  content: string;
}
```

**Streaming SSE events:** When `ctx` is provided, `AgentExecutor.run()` emits `{ type, content }` events via `createSse(ctx.res)` for each intermediate step, allowing the client to stream the agent's reasoning in real time.

**Rate limit handling:** HTTP 429 from the LLM provider is caught; the `Retry-After` header value is parsed and used as the backoff delay.

**Bounded memory:** Conversation history is measured in estimated tokens (characters / 4). When it exceeds `maxTokens * 0.8`, a summarization prompt is sent to the LLM and the history is replaced with the summary.

---

### 50. Plugin Marketplace & Extension SDK (`platform/plugins/`)

```typescript
export abstract class PluginModule {
  abstract name: string;
  abstract version: string;
  onInstall?(app: StreetApp): Promise<void>;
  onLoad?(app: StreetApp): Promise<void>;
  onUnload?(app: StreetApp): Promise<void>;
}

// The app.use(plugin) method accepts a PluginModule
// The plugin receives a SandboxedApp with restricted API surface:
export interface SandboxedApp {
  use(middleware: MiddlewareFn): void;
  registerController(ctor: Constructor): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  // No access to: container internals, pool internals, process.env
}

export class PluginInstaller {
  constructor(opts: { registryUrl: string; pluginsDir: string });
  async install(name: string, version: string): Promise<void>;
  // Fetches from registry, verifies checksum + Ed25519 marketplace signature
  // Throws on invalid signature
  async list(): Promise<InstalledPlugin[]>;
}
```

**Signature verification:** Uses `node:crypto`'s `verify()` with the marketplace's Ed25519 public key (bundled with the framework). Any plugin with an invalid or missing signature is rejected.

**Load isolation:** Each plugin is loaded via `await import(path)` in a separate dynamic import. The plugin module scope cannot access framework internals outside the `SandboxedApp` interface.

**Round-trip property:** `app.use(plugin)` followed by `plugin.onUnload(app)` must restore the app to its pre-load state. This is enforced by `PluginModule.onUnload()` contract; the test suite verifies it by comparing middleware stack snapshots before and after.

---

## Cross-Cutting Design Concerns

### Requirement 51: Absolute Implementation Policy — Enforcement Architecture

Every module in this design enforces the policy through the following structural decisions:

**No stubs:** Each module has a complete `destroy()` / `close()` / `stop()` method. Nothing is left as a TODO.

**Memory bounds:** Every stateful class declares its maximum memory footprint:
- `LruCache`: `maxEntries`
- `RouteProfiler`: 10,000 samples per route
- `OtelTracer`: 1,000 span buffer
- `TenantMetricsRegistry`: 10,000 tenant entries
- `JobQueue`: bounded by DB table (no in-memory queue beyond `concurrency` slots)
- `DistributedCache`: `maxMemoryMb` enforced via `LruCache` eviction

**Resource cleanup:** All `setInterval` timers use `.unref()`. All `EventEmitter` listeners are removed in `destroy()`/`stop()`. All sockets are closed. All streaming iterators have `return()` methods.

**Test infrastructure:** Every module with database interaction ships with a `tests/` directory using `node:test` and `node:assert/strict`. Tests connect to real databases (PostgreSQL, MySQL, SQLite via WASM) and real HTTP servers. No mocks.

**CI/CD integration:** Every new module's tests are added to the GitHub Actions workflow in `.github/workflows/ci-cd.yml`. Security audit scripts run via `npm audit`. Benchmark scripts are added to `benchmarks/` and run against Express, Fastify, NestJS, Hono, Fiber, and Gin.

---

## Database Schema Summary

All framework-managed tables use the `street_` prefix:

| Table | Purpose | Version |
|---|---|---|
| `street_migrations` | Migration tracking | v1.0 |
| `street_jobs` | Job queue | v1.5 |
| `street_dead_letter_queue` | Failed jobs | v1.5 |
| `street_job_history` | Job execution history | v1.5 |
| `street_workflows` | Workflow state | v1.5 |
| `street_api_events` | API analytics | v1.6 |
| `street_webhook_endpoints` | Registered webhook targets | v1.6 |
| `street_webhook_deliveries` | Delivery log | v1.6 |
| `street_tenants` | Tenant registry | v1.7 |
| `street_tenant_usage` | Per-tenant usage metrics | v1.7 |
| `street_tenant_daily_stats` | Daily aggregates | v1.7 |
| `street_feature_flags` | Feature flag definitions | v2.2 |
| `street_audit_log` | Immutable audit trail | v2.2 |
| `street_backups` | Backup manifest | v2.2 |
| `street_refresh_tokens` | Refresh token store | v1.4 |
| `street_sessions` | Server-side session store | v1.4 |
| `street_api_keys` | API key store (hashes only) | v1.4 |
| `street_webauthn_credentials` | Passkey public keys | v1.4 |
| `street_seed_runs` | Seed tracking | v1.2 |
| `street_events` | Event store (CQRS/ES) | v2.0 |
| `street_schema_versions` | Schema version tracking (diff) | v1.2 |

---

## Public API Extensions

All new exports are added to `packages/core/src/index.ts` under clearly named section headers. Existing v1.0 exports remain unchanged (no breaking changes). New packages (`@streetjs/edge`, `@streetjs/grpc`) are added as separate workspace packages in `packages/`.

---

## Security Architecture

Every new authentication/authorization feature follows these invariants from the v1.0 codebase:
- All secret comparisons use `timingSafeEqual`
- All random values use `node:crypto`'s `randomBytes`
- All parameterized SQL uses `$N` positional placeholders
- All outbound HTTP requests are validated for SSRF (reusing `validateWebhookUrl` pattern)
- All session data is AES-256-GCM encrypted (reusing `SessionManager`)
- All private keys and tokens are never logged (using `[REDACTED]` convention)
- All headers are validated and sanitized before use

---

## Components and Interfaces

This section summarizes the key components introduced across the roadmap, grouped by module. Each component is a concrete class or interface added to `packages/core/src` (or a new workspace package). Full per-feature signatures appear in the version sections above.

### Developer Experience (v1.1)
- `Scaffolder` — generates controllers, services, and modules from templates.
- `OpenApiGenerator` — reflects decorator metadata into an OpenAPI 3.1 document.
- `SdkGenerator` — emits typed client SDKs from the OpenAPI document.
- `DevServer` — file-watching reload server wrapping the core HTTP server.

### Database Platform (v1.2)
- `QueryBuilder` — fluent, parameterized SQL builder (`$N` placeholders).
- `Seeder` / `SeedRunner` — idempotent seed execution tracked in `street_seed_runs`.
- `SchemaDiffer` — computes migration diffs against `street_schema_versions`.
- `ReplicaPool` — read/write splitting over multiple `PgPool` instances.

### Observability (v1.3)
- `OtelTracer` — bounded (1,000-span) OpenTelemetry-compatible span exporter.
- `MetricsRegistry` — Prometheus-format counters, gauges, histograms.
- `RouteProfiler` — per-route latency sampling (10,000-sample ring buffer).
- `AnalyticsCollector` — writes API events to `street_api_events`.

### Auth & Authorization (v1.4)
- `RefreshTokenService`, `ApiKeyService`, `WebAuthnService`, `SessionManager`.
- `rbacGuard` / `AuditWriter` — permission enforcement and immutable audit trail.

### Background Processing (v1.5)
- `JobQueue`, `Worker`, `Scheduler`, `WorkflowEngine` — DB-backed queue with DLQ.

### API Platform (v1.6)
- `WebhookManager` (`webhook/manager.ts`) — delivery with backoff and dead-letter.
- `RateLimiter` — per-route `@RateLimit` enforcement with standard headers.

### Multi-Tenancy (v1.7)
- `TenantProvisioner`, `TenantMetricsRegistry`, `TenantBillingAdapter`.

### Microservices (v2.0)
- `GrpcServer` (`microservices/grpc/`) — proto parser, HTTP/2 framing, server.
- Transports: `RedisTransport`, `MemcachedTransport`, `KinesisTransport`, `RabbitMqTransport`, `KafkaStreamTransport`.

### Cloud Native (v2.1)
- `CloudRuntime` — shutdown hooks, autoscale metrics, service-mesh detection.
- Storage: `S3StorageAdapter`, `GcsStorageAdapter` (SigV4 / bearer auth).

### Enterprise & Next-Gen (v2.2 / v3.0)
- `FeatureFlagService`, `BackupManager`, `SecretProvider` implementations, `@streetjs/edge` runtime.

---

## Data Models

The persistent data model is defined by the framework-managed tables in the [Database Schema Summary](#database-schema-summary) above (all `street_`-prefixed). This section describes the primary in-memory and transport data structures that cross module boundaries.

### Core Domain Types

```typescript
interface JobRecord {
  id: string;
  type: string;
  payload: unknown;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'dead';
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  createdAt: Date;
}

interface WebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  payload: unknown;
  status: 'pending' | 'delivered' | 'failed' | 'dead';
  attempts: number;
  nextRetryAt: Date | null;
}

interface TenantRecord {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  plan: string;
  createdAt: Date;
}

interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  resource: string;
  outcome: 'success' | 'failure';
  metadata: Record<string, unknown>;
  createdAt: Date;
}
```

### Transport Wire Models

Messaging transports serialize to protocol-native wire formats, implemented from scratch over Node core sockets (zero runtime dependencies):

- **RabbitMQ** — AMQP 0-9-1 frames (`method`, `header`, `body`, `heartbeat`) encoded/decoded in `transports/rabbitmq/codec.ts`.
- **Kafka** — Kafka binary protocol requests/responses with `RecordBatch` v2 (varint zigzag, CRC32C) in `transports/kafka/recordbatch.ts` and `primitives.ts`.
- **Redis** — RESP (REdis Serialization Protocol) framing.
- **gRPC** — Protobuf-encoded messages over HTTP/2 length-prefixed frames.

All transports normalize to a common `Message` envelope before delivery to application handlers:

```typescript
interface TransportMessage {
  topic: string;
  partition?: number;
  offset?: string;
  key: Buffer | null;
  value: Buffer;
  headers: Record<string, Buffer>;
  ack(): Promise<void>;
  nack(requeue: boolean): Promise<void>;
}
```

---

## Correctness Properties

These invariants hold across the roadmap implementation and are validated by tests:

### Property 1: Codec round-trip
For every transport codec, `decode(encode(x))` equals `x` for all valid messages. Verified by unit tests for AMQP frames, Kafka `RecordBatch`, and RESP.

**Validates: Requirements 36.5, 47.2**

### Property 2: CRC integrity
Kafka `RecordBatch` CRC32C is computed over the batch body and re-validated on decode; corrupted batches are rejected.

**Validates: Requirements 47.2**

### Property 3: At-least-once delivery
A consumed message is only removed/acknowledged after the handler resolves. Handler failure triggers `nack`/redelivery (RabbitMQ) or offset non-commit (Kafka).

**Validates: Requirements 36.5, 47.2**

### Property 4: Offset monotonicity
Kafka committed offsets for a `(group, topic, partition)` never move backward across a normal session.

**Validates: Requirements 47.2**

### Property 5: Idempotent migrations/seeds
Running a migration or seed twice produces no additional changes (tracked in `street_migrations` / `street_seed_runs`).

**Validates: Requirements 12.1, 12.2**

### Property 6: Bounded memory
Every stateful registry enforces a hard entry cap with LRU/ring-buffer eviction; memory does not grow unbounded under sustained load.

**Validates: Requirements 51.1**

### Property 7: Token safety
All secret comparisons are constant-time (`timingSafeEqual`); no token or private key is ever logged.

**Validates: Requirements 14.1, 51.1**

### Property 8: Audit immutability
`street_audit_log` rows are append-only; the `AuditWriter` issues only `INSERT`s.

**Validates: Requirements 21.5**

### Property 9: Tenant isolation
Queries scoped to a tenant never return another tenant's rows (enforced via mandatory tenant predicate).

**Validates: Requirements 33.1**

### Property 10: Graceful shutdown
After `stop()`/`destroy()`, no timers, sockets, or listeners remain (all `setInterval` use `.unref()` and are cleared).

**Validates: Requirements 51.1**

---

## Error Handling

The framework uses a consistent, typed error strategy with graceful degradation:

### Error Taxonomy
- **`StreetError`** (base) — all framework errors extend it, carrying a stable `code` and HTTP `status`.
- **Validation errors** (`400`) — request/schema validation failures, returned with field-level detail.
- **Auth errors** (`401`/`403`) — surfaced by guards; failures are audited but never leak token material.
- **Transport errors** — connection, protocol, and serialization failures are wrapped with the originating broker context.

### Strategies
- **Retries with backoff:** Webhooks, job workers, and transports retry transient failures with exponential backoff and jitter, capped by `maxAttempts`.
- **Dead-lettering:** Exhausted retries route to a dead-letter destination (`street_dead_letter_queue`, AMQP DLX, or Kafka DLQ topic) rather than dropping data.
- **Reconnect logic:** Transport connection managers detect socket loss (heartbeat timeout / read error) and reconnect with backoff, re-establishing channels, subscriptions, and consumer assignments.
- **Graceful degradation:** Observability exporters (tracing/metrics) drop samples when buffers are full rather than blocking the request path. Analytics writes are best-effort and never fail a request.
- **Fail-closed security:** Authorization defaults to deny; SSRF validation rejects unknown hosts; missing secrets cause startup failure rather than silent insecure operation.
- **Integration test skips:** When external infrastructure is unavailable, integration tests call `t.skip()` rather than failing, keeping the suite green while still exercising codecs via unit tests.

---

## Testing Strategy

Testing follows the Absolute Implementation Policy: no mocks pretending to be production, and every protocol implementation is verified against real infrastructure.

### Layers
1. **Unit tests** (`node:test` + `node:assert/strict`) — codec round-trips, CRC validation, varint/zigzag encoding, query builders, backoff math, and pure logic. No external dependencies; run on every commit.
2. **Integration tests** — exercise real systems:
   - Databases: real PostgreSQL, MySQL, and SQLite (WASM).
   - HTTP/gRPC: real servers with real HTTP/1.1 and HTTP/2 round-trips.
   - Messaging: real RabbitMQ and Kafka brokers via docker-compose.
   - Tests use `t.skip()` when infrastructure is unavailable so suites stay green locally.
3. **Contract tests** — for cloud services without local emulators (AWS Secrets Manager, Vault, Azure Key Vault, GCP Secret Manager), request signing and response parsing are verified against recorded contracts and mock server harnesses.
4. **Compatibility tests** — browser/bundler exports validated against Vite, Rollup, Webpack, and ESBuild.

### Infrastructure
- `docker-compose.rabbitmq.yml` and `docker-compose.kafka.yml` (KRaft single broker) provide reproducible broker environments.
- Integration suites live under `packages/core/src/integration/<service>/`.

### CI/CD
- GitHub Actions workflows run build, lint (`tsc --noEmit`), unit tests, and per-service integration jobs: `rabbitmq-integration.yml`, `kafka-integration.yml`, and a browser-compatibility job.
- Benchmarks run against Express, Fastify, NestJS, Hono, Fiber, and Gin.
- Coverage target for transport modules is ≥ 90%.
