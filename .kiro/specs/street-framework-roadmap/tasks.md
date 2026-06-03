# Implementation Tasks: Street Framework Roadmap v1.1 – v3.0

- [ ] 1. v1.1 — Hot Reload Development Server
  - [ ] 1.1 Create `packages/core/src/dev/watcher.ts` with `DevWatcher` class: `FSWatcher` handle management, `WatcherOptions` interface, `start()` and `stop()` methods, stores all watcher handles in an array for cleanup
  - [ ] 1.2 Implement incremental TypeScript compilation in `DevWatcher`: spawn `tsc --incremental` as a child process, capture stdout/stderr, return boolean success/failure from `compile()`
  - [ ] 1.3 Implement graceful server restart in `DevWatcher.restartServer()`: send `SIGTERM` to the current server process, wait for drain up to `drainTimeoutMs` (default 5000ms), then spawn fresh process
  - [ ] 1.4 Wire `DevWatcher` into `packages/cli/src/commands/dev.ts`: read `--watch` flag, instantiate `DevWatcher`, call `start()`, register `SIGINT`/`SIGTERM` handlers that call `stop()`
  - [ ] 1.5 Write integration tests in `packages/cli/src/tests/dev.test.ts`: verify FSWatcher handles are closed on stop, verify recompile triggers on file save, verify error output on type errors keeps previous server running
  - [ ] 1.6 Export `DevWatcher` and `WatcherOptions` from `packages/core/src/index.ts`

- [ ] 2. v1.1 — Code Generators (middleware, gateway, migration)
  - [ ] 2.1 Create generator templates in `packages/cli/templates/generate/`: `middleware.ts.tpl`, `gateway.ts.tpl`, `migration-up.sql.tpl`, `migration-rollback.sql.tpl`
  - [ ] 2.2 Implement `generateMiddleware(name, cwd)` in `packages/cli/src/commands/generate.ts`: validate name with `/^[a-z][a-z0-9_-]*$/`, check target file existence (exit 1 if exists), write typed `StreetMiddleware` function scaffold to `src/middleware/<name>.middleware.ts`
  - [ ] 2.3 Implement `generateGateway(name, cwd)`: write `@Injectable()` + `@WebSocketGateway` scaffold with `onConnect`, `onMessage`, `onDisconnect` handlers to `src/gateways/<name>.gateway.ts`
  - [ ] 2.4 Implement `generateMigration(name, cwd)`: create timestamped `migrations/<timestamp>_<name>.sql` and `migrations/<timestamp>_<name>.rollback.sql` files
  - [ ] 2.5 Extend `GenerateCommand.execute()` switch to route `middleware`, `gateway`, `migration` sub-types to their respective functions
  - [ ] 2.6 Write tests in `packages/cli/src/tests/generate.test.ts`: verify each generator creates the correct files, verify exit 1 on duplicate, verify name validation rejects uppercase/special chars

- [ ] 3. v1.1 — Configuration Validation Engine
  - [ ] 3.1 Create `packages/core/src/config/validator.ts`: define `FieldType` union (`string | number | boolean | url | port`), `ConfigFieldDef` interface, `ConfigSchema` type, `ConfigResult<S>` mapped type
  - [ ] 3.2 Implement `defineConfig<S extends ConfigSchema>(schema: S): ConfigResult<S>`: reads `process.env`, validates each field against its type and constraints, collects ALL errors before throwing, throws `ConfigValidationError` with the full error list
  - [ ] 3.3 Implement `ConfigValidationError` class extending `Error` with `errors: string[]` property
  - [ ] 3.4 Add `url` type validation (uses `new URL()`) and `port` type validation (integer 1–65535) to the field validator
  - [ ] 3.5 Apply default values only when the variable is absent; treat present-but-invalid values as errors regardless of default
  - [ ] 3.6 Export `defineConfig` and `ConfigValidationError` from `packages/core/src/index.ts`
  - [ ] 3.7 Write unit tests covering: missing required field, invalid port range, malformed URL, default applied on absent var, error on present-but-invalid var, multi-error collection

- [ ] 4. v1.1 — Enhanced Error Diagnostics
  - [ ] 4.1 Create `packages/core/src/diagnostics/reporter.ts`: `DiagnosticsReporter` class extending `EventEmitter`, `DiagnosticEvent` interface with `errorClass`, `message`, `stack[]`, `correlationId`, `ts` fields
  - [ ] 4.2 Implement `DiagnosticsReporter.report(err, correlationId?)`: serialize to JSON, strip Node.js internal frames (filter lines matching `/node:internal|node_modules\/node/`), emit `diagnostic` event, write to `process.stderr`
  - [ ] 4.3 Replace `console.error` in `packages/core/src/router/router.ts`'s `errorHandler` with `DiagnosticsReporter.report()`
  - [ ] 4.4 Enrich `Container.resolve()` error message with the full dependency chain on resolution failure: `"Cannot resolve X → Y → Z: <reason>"`
  - [ ] 4.5 Add `DatabaseConnectionError` class to `packages/core/src/http/exceptions.ts` with a `suggestion` field; throw it from `PgPool.initialize()` on `ECONNREFUSED` with relevant env var names
  - [ ] 4.6 Export `DiagnosticsReporter` and `DiagnosticEvent` from `packages/core/src/index.ts`
  - [ ] 4.7 Write tests: verify `diagnostic` event fires on unhandled route error, verify stack frames are cleaned, verify dependency chain appears in DI error messages

- [ ] 5. v1.1 — CLI Operational Commands (info, doctor, env validate, audit)
  - [ ] 5.1 Create `packages/cli/src/commands/info.ts` with `InfoCommand`: read `package.json` for Street version, read `process.version` for Node, detect TypeScript version from `node_modules/typescript/package.json`, print aligned table
  - [ ] 5.2 Create `packages/cli/src/commands/doctor.ts` with `DoctorCommand`: check Node.js >= 20, TypeScript >= 5.0, required env vars from `.env.example`, attempt DB connectivity ping via `PgConnection.connect()`; print ✓/✗ per check with versions and upgrade hints
  - [ ] 5.3 Create env-validate logic in `DoctorCommand` (or separate `EnvValidateCommand`): dynamic-import `street.config.ts` from the project root, call `defineConfig()`, report per-variable pass/fail, exit code 0 or 1
  - [ ] 5.4 Create `packages/cli/src/commands/audit.ts` with `AuditCommand`: spawn `npm audit --json`, parse JSON output, format CVE findings as a table with package name, severity, and fix recommendation
  - [ ] 5.5 Register all new commands (`info`, `doctor`, `env`, `audit`) in `packages/cli/src/index.ts` switch
  - [ ] 5.6 Write tests for `InfoCommand` (reads correct versions), `DoctorCommand` (detects old Node version as failure), `AuditCommand` (parses npm audit JSON output)


- [ ] 6. v1.2 — MySQL Wire Protocol Driver
  - [ ] 6.1 Create `packages/core/src/database/mysql/wire.ts`: implement MySQL Client/Server Protocol v4.1 handshake over `node:net`; parse server greeting packet (capabilities, server version, auth plugin)
  - [ ] 6.2 Implement `mysql_native_password` authentication: `SHA1(password) XOR SHA1(seed + SHA1(SHA1(password)))` using `node:crypto`
  - [ ] 6.3 Implement `caching_sha2_password` authentication: full SHA-256 challenge-response using `node:crypto`
  - [ ] 6.4 Implement `MysqlConnection.query(sql, params)`: use parameterized COM_STMT_PREPARE + COM_STMT_EXECUTE; return `DbResult { rows, rowCount, command }`
  - [ ] 6.5 Implement `MysqlConnection.queryStream(sql)`: return a `Readable` that emits row objects with backpressure via `socket.pause()`/`socket.resume()`
  - [ ] 6.6 Create `packages/core/src/database/mysql/pool.ts` with `MysqlPool`: same min/max/acquire/idle-sweep API as `PgPool`
  - [ ] 6.7 Create `packages/core/src/database/mysql/mariadb.ts`: `MariaDbConnection` subclass handling MariaDB-specific capability flags; `MysqlConnection.connect()` detects server greeting and returns the appropriate subclass
  - [ ] 6.8 Write integration tests against a real MySQL instance: connection, simple query, parameterized query, transaction commit, transaction rollback, concurrent queries
  - [ ] 6.9 Export `MysqlConnection`, `MysqlPool`, `MariaDbConnection` from `packages/core/src/index.ts`

- [ ] 7. v1.2 — SQLite Driver (WASM worker)
  - [ ] 7.1 Bundle a SQLite WASM binary (`sqlite3.wasm`) into `packages/core/src/database/sqlite/`; document the source and build steps in `CONTRIBUTING.md`
  - [ ] 7.2 Create `packages/core/src/database/sqlite/worker.ts`: load and instantiate the WASM module inside a `node:worker_threads` worker; handle `query` and `transaction` messages via `MessageChannel`
  - [ ] 7.3 Create `packages/core/src/database/sqlite/pool.ts` with `SqlitePool`: constructor accepts `{ filePath, maxWorkers? }`; routes queries to available worker threads; supports `query()` and `transaction()` methods
  - [ ] 7.4 Implement `DbResult` as a shared type across all three drivers (PG, MySQL, SQLite) in `packages/core/src/database/types.ts`; update existing `PgResult` to be an alias
  - [ ] 7.5 Write integration tests against a real SQLite file: create table, insert, query, transaction rollback, concurrent reads
  - [ ] 7.6 Export `SqlitePool` from `packages/core/src/index.ts`

- [ ] 8. v1.2 — Type-Safe Query Builder
  - [ ] 8.1 Create `packages/core/src/database/query-builder.ts` with `QueryBuilder<T extends object>` class: internal AST state with arrays for `selects`, `wheres`, `joins`, `orderBys`, `groupBys`, `havings`; `limit` and `offset` number fields
  - [ ] 8.2 Implement all fluent methods: `select()`, `from()`, `where()`, `join()`, `leftJoin()`, `orderBy()`, `groupBy()`, `having()`, `limit()`, `offset()`, `subquery()`; each returns `this`
  - [ ] 8.3 Implement `build()`: render all accumulated state into `{ sql: string; params: unknown[] }` with positional `$1`/`?` placeholders per `SqlDialect` enum
  - [ ] 8.4 Add compile-time column name enforcement: `select(...cols: (keyof T & string)[])` and `where()` column parameter typed as `keyof T & string`; non-existent column produces a TypeScript error
  - [ ] 8.5 Implement idempotent build: calling `build()` twice on the same unmodified builder produces identical output
  - [ ] 8.6 Write tests: select with where and limit, join with subquery, idempotent build, parameterized placeholder count matches params array length, dialect-specific placeholder style

- [ ] 9. v1.2 — Schema Introspection
  - [ ] 9.1 Create `packages/core/src/database/schema-inspector.ts`: define `ColumnMeta`, `IndexMeta`, `FkMeta`, `TableSchema`, `DatabaseSchema` interfaces
  - [ ] 9.2 Implement PostgreSQL introspection queries: batch `information_schema.columns`, `pg_indexes`, `information_schema.table_constraints`, `information_schema.referential_constraints` into minimal round-trips; complete within 1 second for 500-table schemas
  - [ ] 9.3 Implement MySQL introspection queries using `information_schema` catalog tables
  - [ ] 9.4 Implement SQLite introspection using `PRAGMA table_info()`, `PRAGMA index_list()`, `PRAGMA foreign_key_list()`
  - [ ] 9.5 Implement result caching: `Map<pool, { schema: DatabaseSchema; expiresAt: number }>` with 60-second default TTL; `invalidateCache(pool)` removes the entry
  - [ ] 9.6 Write integration tests: inspect a known schema, verify all column types and nullable flags, verify 60s cache TTL, verify invalidation forces re-fetch

- [ ] 10. v1.2 — Migration Diffing, Seeding, Query Profiling, and Connection Diagnostics
  - [ ] 10.1 Create `packages/core/src/database/migrations.ts` additions: `MigrationDiffer.diff(pool, entities)` reads live schema via `SchemaInspector`, compares to entity decorator metadata, returns `{ safe: string[], destructive: string[] }`
  - [ ] 10.2 Add `street migrate:diff` CLI command: call `MigrationDiffer.diff()`, write generated SQL to timestamped file; require `--confirm-destructive` flag before writing any destructive statements
  - [ ] 10.3 Create `packages/core/src/database/seeder.ts` with `StreetSeeder.run(pool, seedFile)`: wrap execution in `pool.transaction()`; track runs in `street_seed_runs` table using file content hash; skip already-applied seeds
  - [ ] 10.4 Add `street db:seed <file>` CLI command wired to `StreetSeeder`
  - [ ] 10.5 Create `packages/core/src/database/profiler.ts` with `QueryProfiler`: ring buffer of 10,000 `QueryRecord` entries; `enable(pool)` wraps `pool.query()` with a timing decorator via composition (no prototype patching); `getSlowQueries(thresholdMs)` returns sorted results
  - [ ] 10.6 Implement `ConnectionDiagnostics.ping(pool)`: send `SELECT 1` and measure round-trip; `poolStats(pool)` returns `{ total, idle, inUse, waiting, avgAcquireMs }`
  - [ ] 10.7 Emit `pool:exhausted` event on `PgPool`'s internal `EventEmitter` before enqueueing a wait request when the pool is full
  - [ ] 10.8 Write tests: seed runs are idempotent (same hash → skip), diff detects added column, profiler records slow queries, `pool:exhausted` fires on pool saturation

