# Contributing to StreetJS

Thank you for your interest in contributing. This document explains how to set up the development environment, run tests, and submit pull requests.

---

## Development setup

```bash
git clone https://github.com/hassanmubiru/StreetJS.git
cd StreetJS
npm install
```

Start a local PostgreSQL instance:

```bash
docker run -d \
  --name street-dev-db \
  -e POSTGRES_DB=street_dev \
  -e POSTGRES_USER=street \
  -e POSTGRES_PASSWORD=street \
  -p 5432:5432 \
  postgres:16-alpine
```

### SQLite WASM binary

The SQLite driver uses the official pre-built SQLite WebAssembly binary from the
[`@sqlite.org/sqlite-wasm`](https://www.npmjs.com/package/@sqlite.org/sqlite-wasm)
npm package, **version `3.47.2-build1` (SQLite 3.47.2)**. Two files are required
at runtime (co-located with the compiled driver output):

| File | Purpose |
|---|---|
| `sqlite3.wasm` | SQLite compiled to WebAssembly (850,827 bytes) |
| `sqlite3-node.mjs` | Emscripten JS glue — loads and initialises the WASM binary in Node.js |

Both files are **committed into the repository** at
`packages/core/src/database/sqlite/`, so no network access or extra build step
is needed to use the SQLite driver. To regenerate `sqlite3.wasm` (e.g. to
upgrade to a newer SQLite release), run:

```bash
node packages/core/src/database/sqlite/download-wasm.mjs
```

The script downloads **only `sqlite3.wasm`** from the jsDelivr CDN and prints its
SHA-256 checksum for verification:

```
URL:     https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.47.2-build1/sqlite-wasm/jswasm/sqlite3.wasm
SHA-256: 246fd886c2989ccc7959ca415f9fbb0daa01b0d99d7c8ef9f9fa37c68c345584
```

The JS glue `sqlite3-node.mjs` is taken from the same package's `jswasm/`
directory. To bump the version, update `WASM_URL` in `download-wasm.mjs`, re-run
it, and copy a matching `sqlite3-node.mjs` from the package. Because both files
are checked in, the wasm binary must remain un-ignored by `.gitignore`.

After downloading, copy both files to the `dist/database/sqlite/` directory
before running tests (the build step does not copy binary files automatically):

```bash
cp packages/core/src/database/sqlite/sqlite3.wasm \
   packages/core/src/database/sqlite/sqlite3-node.mjs \
   packages/core/dist/database/sqlite/
```

#### SQLite WASM limitations on Node.js

The `@sqlite.org/sqlite-wasm` Emscripten build uses an in-process virtual
filesystem (MEMFS) for each worker thread instance.  This means:

- **File-based databases are per-worker-instance** — each `worker_threads`
  worker gets its own isolated virtual FS.  `SqlitePool` therefore defaults to
  `maxWorkers: 1` so all operations share one Emscripten instance.
- **In-memory databases** (`:memory:`) work as expected within a single worker.
- **Files are not persisted to the real filesystem** by the WASM build; the
  data lives in the worker's in-memory virtual FS for the lifetime of the
  process.  For durable SQLite storage on Node.js >= 22.5, use
  `node:sqlite` directly.

Copy and configure environment:

```bash
cp packages/core/.env.example .env
# Fill in values — PG_HOST=localhost is already correct for the Docker setup above
```

Build and verify:

```bash
npm run build
npm run test -w packages/core
```

---

## Code standards

- **TypeScript strict mode** — all `strict`, `noImplicitAny`, `noUnusedLocals` flags must pass
- **No new runtime dependencies** — street's dependency count (2) is intentional
- **Memory bounds required** — every new collection, queue, or cache must have an explicit upper bound
- **No `any` casts** — use typed generics or unknown with type guards
- **`.js` extensions on imports** — NodeNext ESM requires explicit extensions in source

Run the type-checker before committing:

```bash
npm run lint -w packages/core
```

---

## Testing

All new features must include integration tests in `packages/core/tests/integration.test.ts` using only `node:test` and `node:assert`.

Tests must:
- Connect to a real PostgreSQL instance
- Clean up all created data in `after()` hooks
- Close all connections and servers explicitly
- Not use `setTimeout` for timing-dependent assertions (use proper async/await)

Run tests:

```bash
cd packages/core && \
PG_HOST=localhost PG_USER=street PG_PASSWORD=street PG_DATABASE=street_dev \
  JWT_SECRET="test-secret-at-least-32-chars-here!!" \
  SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  node --test dist/tests/integration.test.js
```

---

## Test suite reference

street has three layers of testing. All run with `node:test` and `node:assert/strict` — no test framework dependencies.

### Integration tests

**File:** `packages/core/tests/integration.test.ts` \
**Requires:** PostgreSQL (see [Development setup](#development-setup)) \
**Coverage:** IoC container, HTTP server, router, PostgreSQL wire protocol, PgPool, repository, migrations, schema \
**Run:**

```bash
cd packages/core && \
PG_HOST=localhost PG_USER=street PG_PASSWORD=street PG_DATABASE=street_dev \
  JWT_SECRET="test-secret-at-least-32-chars-here!!" \
  SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  node --test dist/tests/integration.test.js
```

### Wire protocol & memory stress tests

These test the PostgreSQL wire protocol and connection stress-handling using **mocked sockets** — no database required.

| File | What it tests | Command |
|---|---|---|
| `packages/core/tests/wire-protocol.test.ts` | Wire protocol parsing, param encoding, extended query flow | `node --test packages/core/dist/tests/wire-protocol.test.js` |
| `packages/core/tests/wire-stream.test.ts` | Socket streaming, chunked reads, `queryStream()` lifecycle | `node --test packages/core/dist/tests/wire-stream.test.js` |
| `packages/core/tests/memory-leak.test.ts` | Pool acquire/release cycles, connection leak detection | `node --test packages/core/dist/tests/memory-leak.test.js` |
| `packages/core/tests/stress.test.ts` | Concurrent pool operations, graceful shutdown, O(n) bounds | `node --test packages/core/dist/tests/stress.test.js` |

### System tests (six suites)

Six standalone test suites covering security, performance, and fault tolerance. Can be run individually or via the unified runner.

**Unified runner** (recommended for CI):

```bash
# All suites
node packages/core/dist/tests/system/runner.js

# CI mode with JSON output, skip PostgreSQL-dependent suites
node packages/core/dist/tests/system/runner.js --ci --json --skip-pg

# Single suite by name
node packages/core/dist/tests/system/runner.js security
node packages/core/dist/tests/system/runner.js fuzz-testing
```

| Suite | File | Covers | Needs PG? |
|---|---|---|---|
| `security` | `packages/core/tests/system/security.test.ts` | JWT sign/verify/expiry, session encrypt/decrypt/CSRF, vault encrypt/decrypt, XSS sanitize (HTML/JS/unicode/null-bytes), rate-limiter (rolling-window/concurrent), auth middleware (roles/permissions), CORS, constant-time comparison | no |
| `memory-safety` | `packages/core/tests/system/memory-safety.test.ts` | LRU bounds, eviction order, clear/delete, concurrent access, heap caps, pool max-connections, fixed-size buffers, stream high-water-mark, max listeners | no |
| `load-testing` | `packages/core/tests/system/load-testing.test.ts` | Concurrent HTTP (500×1.5k requests), router throughput (1k dispatches), pool concurrent queries (20 clients), sustained SSE heartbeat load, batch memory | no |
| `fuzz-testing` | `packages/core/tests/system/fuzz-testing.test.ts` | SSE random payloads/empty/close/unicode/binary, WebSocket random/huge/malformed/multiframe, multipart boundary fuzzing, field overflow, chunk boundary | no |
| `chaos-testing` | `packages/core/tests/system/chaos-testing.test.ts` | Fault injection (connect/dns/timeout), shutdown (graceful/forced), resource exhaustion (FDs/memory), worker crash, heart-attack recovery | no |
| `infrastructure` | `packages/core/tests/system/infrastructure.test.ts` | Container resolution (nested/circular/override), CLI commands (migrate/user), WebhookDispatch, TelemetryTracker, OpenAPI generation, cluster coordinator lifecycle | **yes** |

### Running everything in one go

```bash
# Build the core package
npm run build -w packages/core

# Integration (requires PG)
npm run test -w packages/core

# System (unified runner)
npm run test:system -w packages/core

# System suites individually
npm run test:security -w packages/core
npm run test:fuzz -w packages/core
npm run test:chaos -w packages/core
npm run test:memory -w packages/core
npm run test:load -w packages/core
npm run test:infra -w packages/core   # requires PG

# Wire protocol & stress (no PG needed)
node --test packages/core/dist/tests/wire-protocol.test.js \
          packages/core/dist/tests/wire-stream.test.js \
          packages/core/dist/tests/memory-leak.test.js \
          packages/core/dist/tests/stress.test.js
```

---

## CI/CD — composite action pattern

The CI/CD pipeline is consolidated into a single workflow file:

```
.github/workflows/ci-cd.yml
```

All 7 jobs use a reusable composite action that eliminates ~18 lines of boilerplate per job:

```
.github/actions/setup/action.yml
```

### What the composite action does

It wraps three steps that every job needs into a single `uses:` reference:

| Step | Action |
|---|---|
| Checkout source | `actions/checkout` with `persist-credentials: false` |
| Setup Node.js | `actions/setup-node` with `npm` caching |
| Install dependencies | `npm ci` with `shell: bash` |

### How to use it in a new job

**Simplest form** (defaults to Node 20, no registry):

```yaml
steps:
  - uses: ./.github/actions/setup
```

**With a specific Node version** (e.g., from a matrix):

```yaml
steps:
  - uses: ./.github/actions/setup
    with:
      node-version: ${{ matrix.node }}
```

**With npm registry for publish** (e.g., npmjs.com):

```yaml
steps:
  - uses: ./.github/actions/setup
    with:
      node-version: '20'
      registry-url: 'https://registry.npmjs.org'
```

### Best practices

1. **Always use the composite action** rather than repeating checkout/setup/ci manually — it ensures consistent SHA pinning, caching, and security defaults across all jobs.
2. **Pass `node-version` when using a matrix** — the default is `'20'`, so jobs relying on the default don't need to pass it explicitly, but matrix jobs must pass `${{ matrix.node }}`.
3. **Only pass `registry-url` when publishing** — the default is empty, which leaves the default npm config intact.
4. **Don't override `uses:` of the composite action steps** — if your job needs a different version of a step, add a separate step rather than modifying the composite action.
5. **Pin all new `uses:` references to immutable SHAs** — the security-lint job (zizmor) will flag mutable tags in CI. See the schema test below.

### Schema validation

The composite action schema is validated programmatically in:

```
packages/core/tests/action-schema.test.ts
```

Run it locally:

```bash
npm run build:app -w packages/core && node --test packages/core/dist/tests/action-schema.test.js
```

This test covers:
- Top-level structure (`name`, `description`, `inputs`, `runs: using: composite`)
- Input defaults (`node-version: '20'`, `registry-url: ''`, both optional)
- Step count (exactly 3 steps)
- Each step's action, name, and `with:` values
- SHA pinning on every `uses:` reference
- No mutable tag references (e.g., `@v1`, `@latest`)
- Security invariants (`persist-credentials: false`, `shell: bash`)

---

## Pull request checklist

- [ ] `npm run lint -w packages/core` passes with zero errors
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] `packages/core/CHANGELOG.md` updated under `[Unreleased]`
- [ ] No new runtime dependencies introduced
- [ ] Memory bounds documented for any new data structures
- [ ] Public API additions exported from `packages/core/src/index.ts`
- [ ] If adding a new CI job, use `uses: ./.github/actions/setup` for the setup steps

---

## Code review and branch protection

All changes land through **reviewed pull requests** — please do not push directly
to `main`:

1. Create a feature branch and push it.
2. Open a pull request; the `.github/CODEOWNERS` owner is requested automatically.
3. A maintainer reviews and **approves** before the PR is merged.
4. Merge once required status checks pass.

`main` is protected to require a pull request with at least one approving review
and passing checks. This is also what lets the OpenSSF Scorecard `Code-Review`
and `Branch-Protection` checks credit changes as reviewed. For solo/maintainer
changes, a second maintainer (or a designated reviewer) provides the approval —
GitHub does not allow approving your own pull request.

---

## Commit message format

```
type(scope): short description

Longer explanation if needed.

Fixes #123
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`

Examples:
```
feat(database): add SCRAM-SHA-256 authentication support
fix(pool): prevent acquire queue memory leak on pool close
docs(websocket): add heartbeat configuration example
perf(lru): switch eviction to O(1) doubly-linked list
```

---

## Releasing (maintainers only)

Patch release:

```bash
npm run version:patch          # bumps 1.0.0 → 1.0.1
git add packages/core/package.json packages/core/CHANGELOG.md
git commit -m "chore: release v1.0.1"
git tag v1.0.1
git push origin main --tags    # triggers npm-publish workflow
```
