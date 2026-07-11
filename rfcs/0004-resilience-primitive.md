---
rfc: 0004
title: Consolidated resilience primitive (retry / backoff / circuit breaker)
status: Draft
authors: ["@hassanmubiru"]
created: 2026-07-11
tracking-issue:
---

# RFC 0004 — Consolidated resilience primitive (retry / backoff / circuit breaker)

## Summary

Unify the retry/backoff/circuit-breaker logic that is currently reimplemented in
~7 places into one internal core module, exposed through a small stable public
API. Migrate the existing call sites to it behind their current tests so behavior
is preserved. This is a **technical-debt** consolidation (TD-1/TD-4), Low impact,
not a defect fix.

## Motivation

Verified duplication (grep across `packages/*/src`):
- Two independent `CircuitBreaker` classes:
  `packages/gateway/src/circuit-breaker.ts` and
  `packages/core/src/microservices/circuit-breaker.ts`.
- Multiple ad-hoc retry helpers with their own backoff logic:
  `gateway/src/retry.ts` (`runWithRetry`, `computeRetryDelay`),
  `core/src/testing/chaos.ts` (`retryWithBackoff`),
  `core/src/observability/otel.ts` (`exportWithRetry`),
  `core/src/cloud/secret-providers.ts` (four `_fetchWithRetry` with a hardcoded
  `[1000,2000,4000,8000,10000]` delay ladder), plus transport-local
  `_connectWithRetry`/`_produceWithRetry` in rabbitmq/kafka.

Each is individually correct and tested, but the pattern is maintained in
parallel, and the hardcoded ladders (TD-4) are unreviewable in aggregate.

## Guide-level explanation

```typescript
import { computeBackoff, withRetry, CircuitBreaker } from 'streetjs/resilience';

// pure, injectable delay — same contract as gateway's computeRetryDelay
const delayMs = computeBackoff({ baseDelayMs: 100, multiplier: 2, maxDelayMs: 10_000 }, attempt);

const result = await withRetry(
  (attempt, signal) => doThing(signal),
  { maxAttempts: 5, isRetryable: (e) => e.code === 'ETIMEDOUT' },
);

const breaker = new CircuitBreaker({ failureThreshold: 5, openMs: 30_000 });
```

## Reference-level explanation

- New internal module `packages/core/src/resilience/` exporting:
  - `computeBackoff(policy, attempt): number` (pure) — supersedes
    `computeRetryDelay`; injectable `delay` for tests.
  - `withRetry(fn, policy, opts?)` — supersedes `runWithRetry`/`retryWithBackoff`;
    accepts `isRetryable`, `maxAttempts`, method matching, and an injectable delay.
  - `class CircuitBreaker` — the union of the gateway + microservices semantics
    (states closed/open/half-open, failure threshold, open window, half-open
    probe), event-emitting.
- Re-export the stable surface from `streetjs` as a `./resilience` subpath.
  Gateway's already-public `runWithRetry`/`computeRetryDelay` remain exported
  from `@streetjs/gateway` as thin re-exports (or deprecation-aliased) so the
  gateway public API does not break.
- Migrate call sites (`secret-providers`, `otel`, `chaos`, transports, gateway,
  microservices) to the shared implementation, one at a time, keeping each
  package's existing tests green as the regression guard.
- The two `CircuitBreaker` classes collapse to one; the microservices/gateway
  imports repoint to the core module.

## Backward compatibility

**Non-breaking, additive.** No public export is removed: `@streetjs/gateway`
keeps `runWithRetry`/`computeRetryDelay` as re-exports (optionally
`@deprecated`-annotated pointing at `streetjs/resilience`). New `streetjs/resilience`
subpath is additive. Ships in a **1.x minor**. Any eventual removal of the gateway
aliases waits for 2.0.

## Security considerations

None new — this is internal consolidation of control-flow logic. No secret/PII
handling changes. Reduces the surface that must be audited by removing duplicate
implementations.

## Testing & verification

- The existing per-site suites (gateway `retry.test.ts` /
  `retry.property.test.ts`, microservices circuit-breaker tests, queue
  `retry-backoff.property.test.ts`, secret-providers tests) are the regression
  guard: they must stay green after each call site is migrated.
- Add property-based tests for `computeBackoff` (monotonic within cap, honors
  `maxDelayMs`, jitter bounds if added) and the `CircuitBreaker` state machine.
- Full `packages/core` + `packages/gateway` suites must pass before merge; the
  registry subpath-import gate must show the new `streetjs/resilience` subpath
  loads.

## Alternatives considered

- **A separate published `@streetjs/resilience` package:** deferred. Keeping it an
  internal core module + `streetjs/resilience` subpath avoids adding a 55th
  published package and a new lockstep/versioning obligation for a Low-impact
  consolidation. Can be promoted to a standalone package later if demand appears.
- **Leave as-is:** rejected only mildly — the duplication is Low impact, so this
  RFC is P2 and should not destabilize certified code; migration is incremental
  and test-guarded, not a big-bang rewrite.

## Unresolved questions

- Whether to add jitter to `computeBackoff` by default (changes observable delays;
  keep opt-in to preserve current behavior).
- Exact deprecation policy/timeline for the gateway retry re-exports.
- Whether transport-local reconnect loops fully fit the generic `withRetry`
  contract or need a transport-specific wrapper.
