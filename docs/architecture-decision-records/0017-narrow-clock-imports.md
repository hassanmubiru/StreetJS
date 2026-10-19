# ADR 0017: Move shared clock imports to the store contract

- **Status:** Accepted
- **Date:** 2026-10-20
- **Scope:** `@streetjs/workflow`, `@streetjs/events`, `@streetjs/storage`, `@streetjs/gateway`

## Problem

Several packages imported the shared `Clock` and `systemClock` symbols from the
broad `streetjs` facade even though those contracts are owned by
`@streetjs/store`. This made dependency ownership implicit and kept package
builds coupled to the facade for a foundational time abstraction.

## Decision

Import `Clock` and `systemClock` directly from `@streetjs/store` in workflow,
events, storage, and gateway production code. Add `@streetjs/store` as an
explicit runtime dependency of each package. Keep `streetjs` imports where the
package still consumes contracts without a verified narrow public owner.

## Compatibility impact

No runtime or public API behavior changes. The facade continues to re-export
the clock contract for consumers; only internal dependency ownership becomes
explicit.

## Evidence

The workflow and storage package builds and lint checks pass. The storage suite
passes 374 tests (367 passed, 7 skipped), and the root offline suite passes 18
tests with four PostgreSQL suites skipped because PostgreSQL is unavailable.
