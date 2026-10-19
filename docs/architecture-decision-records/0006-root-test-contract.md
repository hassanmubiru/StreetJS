# ADR 0006: Make the root test command clean-checkout safe

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** root workspace scripts and core test scripts

## Problem

The root `npm test` delegated directly to a generated core test file. On a clean
checkout, that file did not exist until the full TypeScript test build had been
run manually. The command therefore described a test workflow that was not
self-sufficient.

## Existing behavior

`npm test` ran `packages/core`'s `test` script, which executed
`dist/tests/integration.test.js`. The core library build emitted `dist` library
output but not the test tree; `test:run` was the existing command that compiled
the full source/test tree before execution. PostgreSQL suites skipped when the
service was not configured.

## Decision

- Root `npm test` delegates to a core `test:offline` script.
- Core `test:offline` clears `PG_HOST` for the child command, runs the existing
  full test compiler, and executes the integration file. This runs offline
  HTTP/router/container contracts and reports external PostgreSQL suites as
  skipped.
- Root `npm run test:integration` preserves an explicit path to the existing
  core integration script for environments that have configured infrastructure.
- `.nvmrc` pins Node 22, matching package engines and the CI baseline.

## Alternatives considered

1. **Only change the root command to point at an existing dist file:** rejected;
   it would still fail on a clean checkout.
2. **Hide skipped PostgreSQL tests:** rejected; the existing skip output remains
   visible and integration execution is explicitly named.
3. **Replace the integration suite with a new test runner:** rejected; the
   existing suite already contains the relevant offline contracts.

## Compatibility impact

The default root command now builds test artifacts and runs offline by default.
The existing package `test` command remains available for compatibility. CI or
developers needing database-backed execution should use the explicit integration
path with PostgreSQL configuration.

## Evidence

After removing core `dist`, `npm test` rebuilt the test tree and passed 16 tests
with four PostgreSQL suites explicitly skipped. Root build and lint also pass.
