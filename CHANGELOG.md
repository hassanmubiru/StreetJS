# Changelog

All notable changes to `@streetjs/core` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.11] - 2026-06-17

### Changed
- Repository rename: updated all `repository`/`bugs` URLs, documentation links,
  CI badges, and the GitHub Pages base URL from `hassanmubiru/street` to
  `hassanmubiru/StreetJS` so npm provenance validation matches the renamed
  repository. Hardened the release workflow's `@streetjs/core` deprecation step
  to skip re-applying an unchanged message (avoids a benign E422 annotation).
  No API changes.

## [1.0.10] - 2026-06-17

### Changed
- Documentation: modernized the GitHub and npm READMEs (accurate dependency count
  of 3, 47-package monorepo, 19 official plugins; added hero, comparison table,
  Official Plugins, and Security & Supply Chain sections). No API changes.

## [Unreleased]

### Added

**Messaging transports (from scratch, zero dependencies)**
- `RabbitMqTransport` / `RabbitMqConnectionManager` / `RabbitMqPublisher` /
  `RabbitMqConsumer` — a full AMQP 0-9-1 client over `node:net` with publisher
  confirms, dead-letter routing, reconnect with backoff, heartbeats, and an
  `EventBusTransport` adapter. Verified against a real broker via
  `docker-compose.rabbitmq.yml` and a runnable integration suite.
- `KafkaClient` / `KafkaProducer` / `KafkaConsumer` / `KafkaStreamTransport` —
  the Kafka binary protocol over `node:net` (Metadata v1, Produce v3, Fetch v4,
  ListOffsets v1, FindCoordinator v0, OffsetCommit v2, OffsetFetch v1,
  InitProducerId v0), RecordBatch v2 with CRC32C, a batching + idempotent
  producer, and a consumer-group offset-committing consumer. Verified against a
  real broker via `docker-compose.kafka.yml` and a runnable integration suite.

**Browser / edge builds**
- `"browser"` export conditions in `@streetjs/core` mapping the main entry to a
  node-free `dist/browser.js` and Node-only subpaths to a throwing stub.
  Validated by an esbuild-based browser-bundle compatibility test suite.

**Cloud & enterprise**
- `AzureKeyVaultProvider` secret provider and `SecretRotationManager` (TTL-based
  rotation with `rotate` events + `onRotate` for pool connection recycling);
  contract tests for Vault/AWS/Azure/GCP via a local mock-server harness, plus
  non-retryable (4xx) error classification.
- `FieldEncryptor` transparent AES-256-GCM field encryption wired into the
  repository layer, and `redactByClassification` for classification-aware log
  redaction.
- `TenantUsageAggregator` nightly usage→daily-stats aggregation job.
- `EventStreamConsumer` lag monitoring (`stream:lag` events).
- `AuditLogger` append-only trigger in the migration, `@Sensitive` redaction in
  `log()`, and a public `flush()`.

### Fixed
- `BackupService.restore()` no longer drops the first data statement when it
  shares a segment with the backup's leading comment header.

### CI
- New workflows: `rabbitmq-integration.yml`, `kafka-integration.yml`,
  `browser-compat.yml`; a `policy-checks` job (placeholder-marker scan +
  high-severity `npm audit`) added to `ci-cd.yml`.

---

## [1.0.9] — 2026-06-14

### Changed
- **Guarded auto-publish on `main`** — the publish job now runs on pushes to
  `main` as well as on `v*` tags. Publishing remains safe via idempotent steps:
  a version already on npm is skipped, so `main` only publishes after a version
  bump. The version check verifies all packages are in lockstep (and matches the
  tag on a tag push), and the provenance attestation gate still applies.
- The `npm deprecate @streetjs/core` step is now non-fatal (idempotent re-runs
  return E422, which must not fail a release).

---

## [1.0.8] — 2026-06-14

### Added
- **Official plugin trust store** — `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM` and
  `officialPluginPublicKey()` exported from core so a `PluginHost` verifies
  official `@streetjs/plugin-*` signatures out-of-the-box.

### Changed
- **Release hardening** — the npm publish job now enforces a **provenance gate**
  (fails if any published package lacks an attestation), regenerates a per-release
  CycloneDX **SBOM** artifact, and makes each publish step **idempotent**.

### Ecosystem (separate `@streetjs/plugin-*` packages)
- Published **18 official, Ed25519-signed, dependency-free plugins** with npm
  provenance: redis, s3, r2, stripe, sendgrid, twilio, auth0, nats, kafka,
  rabbitmq, postgres, mysql, mongodb, paypal, openai, clerk, supabase, firebase.
  `scripts/verify-official-signatures.mjs` verifies all 18 against the official key.

### Docs
- Migration guides from Express, NestJS, and Fastify.

---

## [1.0.7] — 2026-06-11

### Fixed
- **Published package was un-importable.** The `streetjs` tarball's `files`
  allow-list had drifted out of sync with the export surface: the root barrel
  (and `router.js`) imported ~19 directories — `testing`, `devx`, `diagnostics`,
  `observability`, `verification`, `release`, `config`, `dev`, `auth`, `jobs`,
  `tenancy`, `microservices`, `transports`, `cloud`, `enterprise`, `platform`,
  `versioning`, `sdk-gen`, `graphql` — that were never published, so a clean
  `import('streetjs')` crashed with `ERR_MODULE_NOT_FOUND` (e.g.
  `dist/testing/chaos.js`, `dist/diagnostics/reporter.js`). The `files` list now
  ships every directory the public API references (tests still excluded).

### Added
- **Consumer Platform Security** subsystems (all exported from the package root):
  runtime input validation (`validate`/`validated`/`validateEnv`/`validateArgv`,
  Zod-backed), scoped rate limiting (`rateLimit` global/per-IP/per-user, in-memory
  or Redis-backed), security-header override/disable, the `UploadGuard`
  (magic-byte + size + MIME + image-only + EXIF-strip + malware hook), field-level
  encryption (`Keyring`/`FieldCipher`, AES-256-GCM envelope encryption with KEK
  rotation and tamper detection), the `AbuseEngine` (lockout / signup throttle /
  password-spray / scoring), the `ModerationToolkit` (report/block/mute +
  append-only audit), pluggable `SecretProvider` adapters with log redaction and a
  required-secret startup gate, and `PrivacyControls` (export/delete/retention/
  consent). Documented at `docs/security/consumer-platform.md`.
- Official dating reference packages composing the above: `@streetjs/dating-auth`,
  `@streetjs/dating-profiles`, `@streetjs/dating-messaging`,
  `@streetjs/dating-moderation`.
- `zod` added as a runtime dependency (used by the runtime input Validator).

### CI
- New `package-integrity` job (every PR/push) and publish-time gates that
  `verify:pack` the tarball (every shipped module's relative imports must resolve
  within the package) and run a clean-install `import` smoke test for `streetjs`,
  `@streetjs/cli`, and the `@streetjs/core` compat shim — so a missing-from-tarball
  regression can never reach npm again.

---

## [1.0.4] — 2026-05-29

### Fixed

**@streetjs/cli — `street generate repository` log message**
- Success message printed `src/repositorys/` (naive `type + 's'`) instead of
  `src/repositories/`. Fixed by routing through the existing `toPlural()` helper,
  which correctly handles the `y → ies` rule. The generated file path was always
  correct — only the console output was wrong.

**@streetjs/cli — version bump to 1.0.2**

---

## [1.0.3] — 2026-05-29

### Fixed

**@streetjs/core — publish artifact pollution (critical)**
- `package.json` `"files"` array replaced the wildcard `"dist/**/*.js"` with
  explicit per-subdirectory globs (`"dist/cache/**/*.js"`, `"dist/cli/**/*.js"`,
  etc.). The wildcard was matching `dist/src/**` (stale artifact from running
  `tsc` without `rootDir`) and `dist/tests/**` (all test files), shipping
  ~600 kB of unwanted code to consumers. Published package is now 73.9 kB
  (down from 205.8 kB) with 113 files (down from 305).
- `prepublishOnly` script now runs `npm run clean` before `npm run build` to
  guarantee `dist/src/` and `dist/tests/` are never present at publish time.

**@streetjs/cli — publish artifact pollution (critical)**
- `package.json` `"files"` array replaced `"dist/**/*.js"` with explicit paths
  (`"dist/argv.js"`, `"dist/index.js"`, `"dist/commands/**/*.js"`) to prevent
  `dist/tests/*.js` from being published. Package is now 24.5 kB / 43 files
  (down from 29.5 kB / 49 files).
- Source maps (`dist/**/*.js.map`) are now correctly included in the published
  package — they were previously excluded by the missing glob.

**@streetjs/cli — generated project structure**
- `street create <name>` now generates `tests/` at the project root instead of
  `src/tests/` — matches the documented expected structure.
- `migrations/` directory now includes a `.gitkeep` so git tracks the empty
  directory.
- `README.md` template updated to show the correct project tree.

**@streetjs/cli — version test**
- `src/tests/index.test.ts`: `VERSION_OUTPUT` constant now reads the version
  dynamically from `package.json` instead of being hardcoded as `'street v1.0.0'`,
  so the test does not break on every version bump.

### Changed

**CI/CD — `test-and-publish` job**
- Now publishes both `@streetjs/core` and `@streetjs/cli` (previously only core).
- Verifies that both `packages/core/package.json` and `packages/cli/package.json`
  versions match the git tag before publishing.
- Added pack validation steps: asserts no `dist/tests/` or `dist/src/` in either
  tarball, and that CLI tarball contains `bin/street.js` and `templates/`.
- Added scaffolding smoke test: runs `street create smoke-test` and validates all
  14 required paths exist before publishing.
- `needs` changed from `[build-and-test]` to `[build-and-test, migration-integration]`
  so CLI unit tests must also pass before publish.

**Release tooling**
- Added `scripts/release.sh` — interactive release script that bumps versions,
  rebuilds, validates packs, runs smoke tests, commits, tags, and publishes.
- Added `scripts/validate-publish.sh` — standalone pre-publish validation (9
  sections, 30+ checks). Safe to run at any time.
- Added `scripts/post-publish-verify.sh` — post-publish verification that polls
  the npm registry, installs the published CLI globally, and validates the
  generated project end-to-end.

---

## [1.0.3] — 2026-05-28

### Fixed

**CI publish workflow robustness**
- Split combined "Run system tests" step into separate per-suite steps (security, memory-safety, infrastructure) with `--test-concurrency=1` — helps identify which test suite fails and prevents a timeout in one suite from blocking the others
- Increased workflow `timeout-minutes` from 15 → 20 to accommodate the sequential test execution

### Changed

**CI infrastructure**
- `.github/workflows/publish.yml`: each test suite now runs in its own `node --test` step with isolated output and error reporting

---

## [1.0.2] — 2026-05-28

### Fixed

**Critical: empty package fix**
- `package.json`: corrected `"files"` pattern from `dist/src/**/*.js` → `dist/**/*.js` — the published v1.0.1 tarball contained only metadata/migrations with zero compiled JS files. Anyone installing `@streetjs/core@1.0.1` got a broken package.
- `package.json`: updated all 20+ `"exports"` subpath mappings to remove the spurious `src/` segment (e.g., `"./dist/src/http/server.js"` → `"./dist/http/server.js"`)

### Added

**Database — SASL/SCRAM-SHA-256 authentication (wire protocol)**
- Full multi-round SCRAM-SHA-256 handshake (`SASL` → `SASLContinue` → `SASLFinal`) in the native PostgreSQL wire protocol client
- Client-first-message generation with `gs2-header` and secure random client nonce (`randomBytes`)
- Server-first-message parsing: nonce verification (RFC 5802 §7 — MITM protection), salt + iteration validation
- Password normalization via SASLprep (NFKC) with RFC 4013 §3 character prohibition checks
- `pbkdf2Sync`-based `Hi()` function for SaltedPassword derivation
- ClientKey / StoredKey / ClientProof / ClientSignature computation using `createHmac('sha256')`
- Server signature verification with `timingSafeEqual` — timing side-channel protection
- `xorBuffers()`, `validateSASLprep()`, `parseScramParams()`, `parseSASLMechanisms()` utility functions (exported for testing)
- Exported `buildSASLInitialResponse()`, `buildSASLResponse()` message builders
- New `AuthType` constants: `SASL (10)`, `SASLContinue (11)`, `SASLFinal (12)`

**Security — SQL injection prevention**
- `user.repository.ts`: replaced manual string escaping (`.replace(/'/g, "''")`) with parameterized queries using `$1` / `$2` placeholders across all queries (`findByEmail`, `emailExists`, `updatePassword`)

**Testing infrastructure**
- New comprehensive system tests: fuzz-testing, load-testing, chaos-testing, security-testing, memory-safety, infrastructure, wire protocol, wire stream, stress tests
- `tests/system/runner.ts`: shared system test runner
- `CONTRIBUTING.md`: added "Test suite reference" section documenting test layers

**Infrastructure**
- `docker-compose.yml`: added for local development with PostgreSQL
- `.github/workflows/`: new workflows for publish (npm on tags), system-tests, yaml-lint, security-lint, memory-leak
- `.github/dependabot.yml`: automated dependency updates for GitHub Actions and npm
- `.githooks/pre-commit`: pre-commit hook for workflow YAML validation
- `scripts/validate-workflows.sh`: standalone YAML validation script
- `scripts/test-setup.sh`: test environment setup
- `docker-init/001_enable_pgcrypto.sql`: init script for enabling pgcrypto extension

**Developer tooling**
- `.gitignore`: added `*.tgz` pattern to prevent build artifacts from being tracked

### Changed

**Database repository — parameterized queries**
- `StreetPostgresRepository`: all CRUD methods (`findById`, `list`, `create`, `update`, `delete`) migrated from manual SQL string building + `escapeString` to parameterized queries with `$N` placeholders — eliminates SQL injection surface across the entire repository layer
- `streamAll()`: return type changed from `StreetPostgresWireStream` to `Promise<StreetPostgresWireStream>`, implementation simplified to `this.pool.stream(sql)`
- Removed deprecated helper functions: `escapeString`, `escapeValue`, `buildInsert`, `buildUpdate`
- `StreetMigrationRunner`: insert/delete queries in `run()` and `rollback()` also switched to parameterized queries

**Connection pool**
- Dead connection detection and automatic replacement in `acquire()`
- `pendingCreations` counter prevents race conditions when replenishing connections
- Wait queue stores `WaitEntry` objects with reject handlers and inactivity timers

**HTTP server**
- Request body consumption: named handler functions with explicit `req.removeListener()` cleanup to prevent memory leaks
- Server startup: `error` listener properly removed after successful bind
- `normalizePath()`: handles `undefined` inputs safely, correct root path (`'/'`) handling

**Router**
- `errorHandler`: internal error messages no longer leaked to clients — `message` field hardcoded to `'Internal Server Error'`
- `compilePath`: removed unnecessary escape character from regex

**Multipart parser**
- Event listeners refactored to named functions (`onError`, `onEnd`) with explicit removal after completion
- Removed unused `pipeline` import from `node:stream/promises`

**Cluster coordinator**
- Memory leak fix: `_started` boolean guard prevents multiple `start()` invocations and duplicate listener registration
- Explicit `_onExit` / `_onMessage` handler references instead of anonymous closures

**Dockerfile**
- Removed `COPY tests ./tests` and `RUN mkdir -p uploads` (uploads created at runtime by `MultipartParser`)

**Rate limiter**
- `RateLimitException` constructor simplified — removed `retryAfterSeconds` parameter

**SSE**
- `SseConnection`: `undefined` event data now treated as empty string instead of being passed to `JSON.stringify` (fixes value handling for optional data fields)

### Removed

**Unused types**
- `DeepReadonly<T>`, `DataKeys<T>`, `DataShape<T>` — deep immutability helpers (not used in runtime code)
- `ValidationResult<T>` — discriminated union (replaced by implicit patterns)
- `PaginationParams` — unused; pagination uses inline interfaces
- `HealthStatus` — unused; health endpoint returns ad-hoc shapes

**Deprecated module exports**
- `LedgerTransactionService` — removed from public API (replaced by direct repository patterns)
- `BoundedTransform` — removed from public API (internal implementation detail)

---

## [1.0.1] — 2026-05-27

### Fixed

**CI security bugs**
- `publish.yml`: replaced `secrets.NPM_TOKEN` in `if:` condition with an env-var workaround (GitHub Actions does not allow the `secrets` context in conditionals)
- `publish.yml`: removed `|| true` build error masking — compile failures are now correctly caught before publishing
- `ci-cd.yml`: added `permissions: contents: read` to restrict default write-all scope (Poisoned Pipeline Execution prevention)
- `ci-cd.yml`: replaced hardcoded test credentials (`POSTGRES_PASSWORD`, `JWT_SECRET`, `SESSION_KEY`, `KEK`) with `${{ secrets.XXX }}` references

### Changed

**Workflow quality-of-life**
- `ci-cd.yml`: added `concurrency` with `cancel-in-progress: true` to cancel stale duplicate CI runs
- `ci-cd.yml`: scoped `KEK` secret from workflow-level env to only the `build-and-test` job that needs it
- `ci-cd.yml`: deduplicated redundant `npx tsc --noEmit` + `npx tsc` into a single compilation step
- `ci-cd.yml`: changed `if: always()` → `if: success() || failure()` to skip artifact upload on cancelled workflows
- `ci-cd.yml`: completed the `docker-build` job — added `docker/login-action` for GHCR authentication and `docker push` for both commit-tagged and `latest` images
- `memory-leak.yml`: added `concurrency` and branch-filtered triggers to `[main, develop]` to reduce wasted runner cycles
- `publish.yml`: added `cache: 'npm'` to `setup-node` and `concurrency` to serialize publish runs
- All three workflows: pinned actions (`checkout`, `setup-node`, `upload-artifact`) to immutable commit SHAs instead of mutable `@v4` tags (supply-chain hardening)

### Added

**Automated security linting**
- `.github/workflows/security-lint.yml`: new workflow that runs [zizmor](https://github.com/zizmorcore/zizmor) on every push/PR to `main`/`develop`, scanning all workflow files for security vulnerabilities at `medium`+ severity

**Dependency lifecycle automation**
- `.github/dependabot.yml`: Dependabot config to automatically update SHA-pinned GitHub Actions and npm dependencies via weekly grouped PRs

**Developer tooling**
- `.vscode/settings.json`: associates the official GitHub Actions JSON schema with all `.github/workflows/*.yml` files — eliminates false-positive errors on `${{ secrets.XXX }}` and `if:` syntax in VS Code
- `.vscode/extensions.json`: recommends the Red Hat YAML extension (`redhat.vscode-yaml`) to workspace contributors
- `.githooks/pre-commit`: pre-commit hook that validates workflow YAML only when workflow files are staged
- `scripts/validate-workflows.sh`: standalone YAML validation script using PyYAML
- `"lint:workflows"` npm script: run `npm run lint:workflows` to validate workflow YAML manually
- `"lint:security"` npm script: run `npm run lint:security` to run zizmor locally (if installed)
- `"prepare"` npm script: auto-configures `core.hooksPath .githooks` on `npm install` / `npm ci`

---

## [1.0.0] — 2025-12-15

### Added

**Core**
- IoC container with singleton registry, recursive dependency resolution, and circular dependency detection
- `@Injectable()` decorator using `reflect-metadata` constructor type emission
- `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Validate`, `@ApiOperation`, `@Config`, `@Command` decorators
- `StreetContext` per-request object with typed request/response API
- `streetApp()` factory: native `node:http` server, body parser (JSON + multipart), request timeout

**Database**
- PostgreSQL wire protocol v3 client (`node:net` + `node:crypto` only) — no `pg` dependency
- MD5 and cleartext authentication
- `PgConnection.query()` buffered and `PgConnection.queryStream()` streaming
- `StreetPostgresWireStream` with socket-level backpressure
- `PgPool` bounded connection pool with idle sweep and acquire queue
- `StreetPostgresRepository<T>` generic repository with CRUD + pagination
- `LedgerTransactionService` for multi-operation ACID transactions
- `StreetMigrationRunner` ordered idempotent SQL migrations with tracking table

**Security**
- `JwtService`: HMAC-SHA256 sign/verify with `timingSafeEqual`
- `SessionManager`: AES-256-GCM encrypt/decrypt with random IV per call
- Vault Mode: scrypt key derivation + AES-256-GCM for KEK-based config decryption
- `RateLimiter`: sliding-window, BigInt nanosecond precision, bounded per-IP log
- `sanitizeDeep`: recursive XSS sanitizer (strips HTML, JS protocol, event handlers)
- `authMiddleware`, `requireRoles`, `securityHeaders`, `corsMiddleware`

**Realtime**
- `StreetWebSocketServer`: heartbeat, bounded connections, broadcast, `ws` library
- `StreetSocket`: typed event emitter with bounded listener count
- `SseConnection`: SSE wrapper with heartbeat keep-alive, clean close

**Storage**
- `MultipartParser`: streaming multipart/form-data directly to disk, ≤128 KB heap per request

**Performance**
- `LruCache<K,V>`: doubly-linked-list LRU, TTL expiry, periodic sweep
- `TelemetryTracker`: ring-buffer history (1,440 samples max), P50/P99 latency, heap profiling
- `ClusterCoordinator`: `node:cluster` worker management, IPC heartbeat, auto-restart
- `WebhookDispatcher`: HMAC-SHA256 signed outbound HTTP, bounded queue, exponential backoff

**CLI**
- `CliKernel`: `@Command` decorator dispatch with DI, `parseArgv` flag parser
- Dual-mode `main.ts`: CLI when `argv` contains a command, HTTP server otherwise

**Observability**
- `/api/health` endpoint: DB check, pool stats, heap, latency
- `/api/metrics` endpoint: telemetry history
- `/api/openapi.json`: auto-generated OpenAPI 3.1 spec from route decorators
