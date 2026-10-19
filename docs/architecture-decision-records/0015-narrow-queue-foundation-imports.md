# ADR 0015: Move queue foundation imports to narrow contracts

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** `@streetjs/queue`

## Problem

Queue code imported `systemClock`, `Clock`, `RateLimitStore`,
`InMemoryRateLimitStore`, and `parseWindow` from the broad `streetjs` facade.
Those contracts already have dedicated public owners.

## Decision

Queue imports those symbols from:

- `@streetjs/store` for clock and rate-limit store contracts/implementation;
- `@streetjs/ratelimit` for `parseWindow`.

Health and metrics registry imports remain on the broad facade because the current
narrow packages do not expose structurally equivalent registry contracts.

The queue package now declares the two first-party runtime dependencies explicitly.

## Compatibility impact

No runtime behavior or public queue API changes. The package still depends on the
core facade for contracts that do not yet have narrow owners. Backward-compatibility
tests were updated to permit public first-party package imports and verify that no
third-party runtime dependencies were introduced.

## Evidence

The complete queue suite passes with 125 tests and 6 Redis integration skips.
