# ADR 0026: Shutdown Timeout Conformance

**Status:** Accepted  
**Scope:** cloud runtime graceful-shutdown hook

## Decision

`registerShutdownHook()` treats `graceMs` as a hard deadline for application and
closeable cleanup. If cleanup does not finish before the deadline, it invokes the
configured exit function with status `1` and does not run `onShutdown` or report a
successful exit afterward.

Cleanup failures before the deadline also exit with status `1`. Successful
application, closeable, and final-hook completion exits with status `0`.

## Rationale

The previous timer invoked the forced-exit callback but did not stop the async
shutdown sequence when the exit function was overridden for tests or embedding.
That could allow later cleanup and a contradictory successful exit. The bounded
race makes the deadline observable and deterministic without adding global state
or forcing every resource to implement a timeout-aware close method.

## Non-goals

- forcibly cancelling arbitrary resource promises;
- changing `StreetApp.close()` semantics;
- closing an HTTP server owned outside the application;
- certifying external services or clustered process shutdown.

## Evidence

Focused tests cover successful shutdown, deadline expiry, and closeable failure.
