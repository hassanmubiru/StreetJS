# Changelog

All notable changes to `@streetjs/core` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

> Repository-level governance, security, and organization hardening. **No
> `@streetjs/core` runtime, public API, or published-package path changed** — these
> are repo structure, CI, and security-control changes only (backward compatible).

### Security
- **Rotated the official plugin-signing key** (embedded anchor in
  `packages/core/src/platform/plugins/official-key.ts`); re-signed all 21 plugins
  so every `manifest.pub` matches the new anchor. The previously-leaked key is
  distrusted. See `security/KEY-ROTATION-RUNBOOK.md`.
- Added CI security gates: `secrets-guard` (rule #1 in `ci-cd.yml`, gates the
  release chain), `block-private-keys.yml`, `repository-policy.yml`,
  `security-baseline.yml`.
- Hardened `.gitleaks.toml` (PEM private-key + cloud-credential rules; removed the
  false signing-key allowlist; commit-scoped accept for the known historical blob),
  `.gitignore` (RESTRICTED + local-artifact patterns), and `dependabot.yml`
  (npm web apps + Docker dirs).
- Bumped scaffold/example **vite** `^5.4.0` → `^6.4.3` (+ `@vitejs/plugin-react`
  `^4.7.0`) to clear the `server.fs.deny` Windows-ADS advisory; digest-pinned all
  Docker base images.
- Added per-plugin `SECURITY.md` (21) and `LICENSE` (21).

### Changed
- Reorganized the repository to mature-framework layout: `infra/`
  (`docker/`, `compose/`, `kubernetes/`, `helm/`, `examples/`, `monitoring/`),
  `security/`, `audits/`, `governance/`, `plans/`. Root `.md` files reduced 45 → 7.
  All script/CI/doc references updated and validated.
- Standardized CI workflow hygiene across all 38 workflows: every workflow now
  declares a top-level `concurrency` group (`<workflow>-${{ github.ref }}`;
  `cancel-in-progress: true` for PR/push verification + security gates, `false`
  for release/deploy/admin/soak runs), and every `upload-artifact` step sets an
  explicit `retention-days` (coverage 14, evidence/verification 30,
  release/SBOM/signed/certificate 90, SARIF 5).
- Stopped tracking generated artifacts (`sbom.json`, `release-inputs.json`).
- Untracked the 4 stale `verification-artifacts/` files committed before the
  ignore rule (`git rm --cached`); the directory is gitignored and regenerated
  in CI (`deploy-verify` writes `cloud/`, the `upgrade-codemods` job writes
  `upgrade/`). The SBOM remains a CI-uploaded release asset.

### Added (governance docs)
- `governance/CHARTER.md`, `governance/REPOSITORY-ORGANIZATION.md`,
  `security/SECURITY-CLASSIFICATION.md`, `security/PLUGIN-SECURITY-STANDARD.md`,
  and audit deliverables under `audits/` and `security/`.

---

## [1.0.25] - 2026-06-22

### Added
- Production-grade **SaaS starter** (`street create --starter saas`). The default
  scaffold is **dependency-minimal** — it ships only `@streetjs/plugin-htmx` for
  the server-rendered dashboard — with heavier integrations behind opt-in flags:
  `--with-billing` adds `@streetjs/plugin-stripe`, and `--with-admin-ui` adds
  `@streetjs/auth-ui` + `@streetjs/admin-ui`.
- The starter composes a full multi-tenant SaaS surface: a `tenantResolver`
  middleware (org_id row scoping + membership gate), hashed-at-rest **API keys**
  (`002_api_keys.sql` + `ApiKeyService` + `apiKeyAuth`), per-org/user **settings**
  (`003_settings.sql` + `SettingsService`), append-only **audit logs**, tokenized
  **invitations**, a signature-verified + idempotent **Stripe** billing webhook,
  opt-in **email notifications**, and a server-rendered **htmx dashboard**.
- Default **RBAC** is composed from core `requireRoles` (no bespoke permission
  engine). Composition-only release; `001_saas.sql` and the `--starter`/
  `--template` alias system are unchanged.

## [1.0.23] - 2026-06-22

### Added
- **`street create --frontend htmx`** scaffolds a server-rendered frontend into
  the backend: a `src/views/` tree (layouts + partials + pages), a
  `ViewsController`, an `HTMX.md` wiring guide, and the `@streetjs/plugin-htmx`
  dependency. The app renders HTML and uses [HTMX](https://htmx.org) to swap
  fragments — no SPA and no client build step. Pairs with the newly published
  [`@streetjs/plugin-htmx`](https://www.npmjs.com/package/@streetjs/plugin-htmx)
  (dependency-free view engine + `HX-*` helpers + CSRF form fields).

## [1.0.22] - 2026-06-21

### Added
- Richer **realtime** and **marketplace** starters: `street create --starter
  realtime` now scaffolds a channels/members/messages migration + `REALTIME.md`;
  `--starter marketplace` scaffolds a catalog/inventory/carts/orders/payments
  migration + `COMMERCE.md`. Consistent with the SaaS starter overlay.

## [1.0.21] - 2026-06-21

### Added
- Richer **SaaS starter** (`street create --starter saas`): now scaffolds a
  multi-tenant schema migration (`migrations/001_saas.sql` — organizations, teams,
  memberships, invitations, subscriptions, audit logs, notifications), an
  architecture guide (`SAAS.md`), and a Stripe billing env sample
  (`.env.saas.example`). Templates can now ship multiple overlay files.

## [1.0.20] - 2026-06-21

### Added
- `street create --starter <name>` flag (alias of `--template`) with friendly
  aliases (`realtime`→`realtime-chat`, `marketplace`→`ecommerce`,
  `dating`→`dating-app`), plus a new **`ai`** starter overlaying `@streetjs/ai`
  (chat, embeddings, RAG scaffolding). Non-breaking — `--template` still works.

## [1.0.19] - 2026-06-20

### Changed
- Added the StreetJS logo to the `streetjs` package README (and across all
  `@streetjs/*` package READMEs) using a raster PNG at an absolute URL, so the
  logo renders on npmjs.com (npm blocks SVG images in READMEs). Refreshed the
  `streetjs` README header and removed legacy marketing phrasing from the tagline.

## [1.0.18] - 2026-06-18

### Fixed
- Next.js starter dev experience: the dev server now runs on port **3001**
  (`next dev -p 3001`) so it no longer collides with the backend's default 3000,
  which caused `/auth/*` requests to self-proxy (ECONNRESET).
- Added `/health` to the Next rewrite proxy (was returning 404).
- Pinned `turbopack.root` in `next.config.mjs` so Next no longer warns about
  multiple lockfiles / inferring a parent workspace root.

## [1.0.17] - 2026-06-18

### Changed
- `--frontend next` starter redesigned as a premium framework landing page
  (hero with dynamic version, quick-start with copy, six core-feature cards,
  live framework-status cards, "Why StreetJS" highlights, "Built for Developers",
  resources, and footer). Adds dark-mode support via `prefers-color-scheme`,
  professional typography, and subtle gradients — no new runtime dependencies.

## [1.0.16] - 2026-06-18

### Changed
- `--frontend next` starter replaced with a polished developer dashboard: hero,
  live system-status cards (backend / database / realtime / auth), an API health
  demo, auth readiness, a realtime indicator, a feature showcase, resource links,
  and a footer — styled with a bundled `app/globals.css` (no new dependencies).
  It never renders raw `null`/`undefined` and shows graceful fallback states.

## [1.0.15] - 2026-06-18

### Fixed
- `--frontend next`/`--frontend react` scaffolds add an `overrides` pin for
  `postcss ^8.5.10`, clearing GHSA-qx2v-qp2m-jg93 (transitive via the build
  tooling); a freshly generated project now reports `0 vulnerabilities`.
- Pre-seeded the Next web `tsconfig.json` (`jsx: react-jsx`, `resolveJsonModule`,
  `isolatedModules`, `allowJs`, `.next/dev/types`) so `next build` no longer
  rewrites it on first run.

## [1.0.14] - 2026-06-18

### Changed
- `--frontend next` scaffold now uses **Next.js 16** with **React 19** (was Next
  14 / React 18), clearing the high-severity advisory carried by the older Next
  release. Verified a generated project passes `npm install` + `npm run build`.

## [1.0.13] - 2026-06-18

Fix the `--frontend next` (and `--frontend react`) scaffold failing to build with
`Module not found: Can't resolve './providers.js'`.

### Fixed
- Generated frontend source no longer uses hardcoded `.js` extensions on local
  imports: Next `app/layout.tsx` imports `./providers` and React `src/main.tsx`
  imports `./App` (bundler/TypeScript resolution; Vite and Next App Router).
- Added regression tests asserting no local `.js`-extension imports in either
  frontend scaffold, plus App Router structure checks. Verified a generated Next
  project passes `npm install` + `npm run build`.

## [1.0.12] - 2026-06-18

Secure-by-default scaffold boot. The `street create` scaffold no longer fails on
first run with `password authentication failed for user "postgres"`.

### Changed
- `@streetjs/cli` scaffold now defaults to **SQLite** (zero-config) so a freshly
  created project starts with no database server or credentials. Added
  `street create --database <sqlite|postgres>`.
- PostgreSQL scaffold validates `PG_USER`/`PG_PASSWORD`/`PG_DATABASE` before
  connecting and degrades gracefully (the dev server starts; database-backed
  routes return 503) instead of crashing on a connection failure.
- Generated apps derive valid ephemeral JWT/session keys in development when
  unset (required explicitly in production), removing two more first-run crashes.
- Driver-aware `.env.example` / `docker-compose.yml`; non-wildcard CORS via
  `CORS_ORIGINS`; unauthenticated example-route notice.
- Added an integration test that scaffolds, compiles, and boots a generated
  project, asserting it serves a request with no auth failure.

## [1.0.11] - 2026-06-17

Repository rename and release-pipeline hardening. No API changes.

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
