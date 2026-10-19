# StreetJS Verification Matrix

**Audit date:** 2026-10-20

## Authoritative command

```bash
npm ci
npm run verify
```

`npm run verify` is implemented by `scripts/verify.mjs` and reports these
stages independently:

1. BUILD
2. LINT
3. TYPECHECK
4. OFFLINE TESTS (CORE)
5. OFFLINE TESTS (CLI)
6. INTEGRATION TESTS
7. EXTERNAL SERVICE TESTS

The external stage is explicitly `SKIPPED` unless:

```bash
STREETJS_RUN_EXTERNAL=1 npm run verify
```

## Current verification evidence

| Stage/check | Command or evidence | Result |
|---|---|---|
| Clean install | `npm ci` | PASS; npm reports 5 vulnerabilities (1 moderate, 4 high) |
| Build | `npm run build` | PASS after CLI TypeScript pin |
| Root lint | `npm run lint` | PASS |
| Workspace typecheck | `npm run lint --workspaces --if-present` | PASS |
| Core offline tests | `npm test` | PASS; 18 tests, PostgreSQL suites explicitly skipped |
| CLI offline tests | `npm run test:cli` | PASS; 351 tests across the two CLI test invocations |
| Core integration tests | `npm run test:integration` | PASS; 18 tests, PostgreSQL suites explicitly skipped |
| External service stage | default `npm run verify` | SKIPPED explicitly; requires `STREETJS_RUN_EXTERNAL=1` |
| SQLite asset | `node packages/core/src/database/sqlite/download-wasm.mjs --verify` | PASS; pinned SHA-256 verified |
| CI enforcement | `.github/workflows/ci-cd.yml` → `framework-verify` | Configured to run `npm run verify` on Node 22 |
| Formatting/diff hygiene | `git diff --check` | PASS |
| Docker image build | `docker build ...` | NOT RUN; Docker is unavailable in the audit environment |

## Coverage boundaries

The current authoritative build stage builds core and CLI, while the
TYPECHECK stage covers workspace packages that expose a `lint` script. It does
not build every optional package in one invocation. Package-local build/test
commands remain the authoritative checks for those packages until a future
matrix extension adds them explicitly.

The external stage is opt-in because it can require PostgreSQL, Redis, Kafka,
RabbitMQ, NATS, cloud credentials, or other services. A service absence must be
reported as `SKIPPED` or `UNAVAILABLE`, never silently counted as a pass.

## Reproducibility notes

- `.nvmrc` pins Node 22.
- Root engines require Node `>=22` and npm `>=10`.
- The CLI compiler range is pinned to TypeScript `^5.9.3` because its tests use
  that compiler API.
- Docker builder images are pinned Node 22 Alpine images.
- SQLite WASM is committed and hash-verified; downloading is a maintenance path
  only when the committed asset is missing or invalid.
