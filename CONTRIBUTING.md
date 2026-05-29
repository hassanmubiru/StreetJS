# Contributing to street

Thank you for your interest in contributing. This document explains how to set up the development environment, run tests, and submit pull requests.

---

## Development setup

```bash
git clone https://github.com/your-org/street.git
cd street
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

## Pull request checklist

- [ ] `npm run lint -w packages/core` passes with zero errors
- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] `packages/core/CHANGELOG.md` updated under `[Unreleased]`
- [ ] No new runtime dependencies introduced
- [ ] Memory bounds documented for any new data structures
- [ ] Public API additions exported from `packages/core/src/index.ts`

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
