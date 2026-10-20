# ADR 0022: Expose cooperative request cancellation

- **Status:** Accepted
- **Date:** 2026-10-20
- **Scope:** `@streetjs/context`, HTTP/1.1, and HTTP/2 request handling

## Decision

Every `StreetContext` exposes an additive `signal: AbortSignal`. Existing
five-argument `createContext()` calls remain valid; callers may optionally
provide a signal as the sixth argument. Transport handlers own the associated
`AbortController`: HTTP/1.1 aborts on request abort/early close or unfinished
response close, and HTTP/2 aborts on stream termination.

Handlers and middleware may observe the signal and stop cooperative work. The
framework does not forcibly cancel arbitrary promises or infer cancellation
semantics for downstream libraries. Request-scoped containers are still
disposed in the request `finally` path after an abort.

Transport listeners are removed after request completion, including when scope
disposal fails. A context created outside a transport receives a non-aborted
signal unless the caller supplies one.

## Compatibility and boundaries

The context property and optional argument are additive. Normal completed
requests keep their signal active and retain existing response behavior. This
does not define a framework-wide cancellation contract for queues, workflows,
database drivers, or plugin cleanup. HTTP/2 lifecycle coverage does not open a
TLS listener; live HTTP/2 abort behavior remains a follow-up.

## Evidence

```sh
npm run build --workspace packages/context
npm run build --workspace packages/core
npm test --workspace packages/context
./node_modules/.bin/tsc -p packages/core/tsconfig.json
node --test packages/core/dist/src/tests/request-abort.test.js
```

The context suite passes 19 tests. The focused HTTP suite covers normal
completion and a real HTTP/1.1 client disconnect, including signal notification,
transport-listener cleanup, and request-scope disposal.
