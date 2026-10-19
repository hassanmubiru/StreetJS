# ADR 0016: Move realtime rate-limit imports to narrow contracts

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** `@streetjs/realtime`

## Problem

The realtime rate-limit module imported `RateLimitStore`,
`InMemoryRateLimitStore`, and `parseWindow` from the broad `streetjs` facade even
though all three contracts already have dedicated public owners.

## Decision

Import rate-limit storage symbols from `@streetjs/store` and `parseWindow` from
`@streetjs/ratelimit`. Add those first-party packages as explicit runtime
dependencies while retaining `streetjs` for realtime-specific contracts that do
not yet have narrow equivalents.

## Compatibility impact

No realtime runtime or public API behavior changes. This only makes dependency
ownership explicit and preserves the existing facade for unresolved contracts.

## Evidence

The complete realtime suite passes 65 tests with four Redis integration tests
skipped because Redis was unavailable; lint and build pass.
