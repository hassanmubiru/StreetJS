# ADR 0023: Define application lifecycle state and graceful close semantics

- **Status:** Accepted
- **Date:** 2026-10-20
- **Scope:** `streetApp()`, `streetHttp2App()`, and `StreetApp`

## Decision

HTTP/1.1 and HTTP/2 applications expose an additive
`lifecycleState` property with these states:

```text
CREATED → STARTING → RUNNING → DRAINING → CLOSED
```

`listen()` moves an application from `CREATED` to `STARTING`, then to
`RUNNING` after the transport reports readiness. Concurrent `listen()` calls
during `STARTING` share the same startup promise. Listening while `RUNNING`,
`DRAINING`, or `CLOSED` is rejected. A failed listen returns the state to
`CREATED` so the transport's normal retry behavior remains possible.

`close()` is legal from `CREATED`, `STARTING`, and `RUNNING`. It is idempotent:
all calls share one promise. A pre-listen close skips transport shutdown and
disposes an app-owned container. A close during startup waits for startup; if
startup fails, the application closes without masking that startup failure.
For a running application, transition to `DRAINING`, stop accepting new work
through the transport's existing `server.close()` behavior, wait for active
connections to drain, dispose an app-owned container, and then transition to
`CLOSED`.

If transport or owned-resource cleanup fails, the original error is preserved
and the state remains `DRAINING`; the memoized close promise is not converted
to a false success. Repeated close calls do not retry failed cleanup or
double-close resources.

## Boundaries

This slice does not add a shutdown timeout or force-cancel active work. It does
not define lifecycle state for standalone queues, WebSockets, telemetry,
storage, or workflow engines, and it does not aggregate multiple independent
application-resource failures. Those require package-specific evidence and a
separate bounded slice. Existing app-owned container disposal remains the
resource owner, preserving the external-container compatibility default.

## Evidence

```sh
./node_modules/.bin/tsc -p packages/core/tsconfig.json
node --test packages/core/dist/src/tests/app-lifecycle.test.js
```

The focused suite covers pre-listen close, repeated/concurrent close,
concurrent listen, active HTTP/1.1 request draining, HTTP/2 pre-listen parity,
listen-after-close rejection, and cleanup failure state preservation.
