# ADR 0021: Roll back failed application plugin loads

- **Status:** Accepted
- **Date:** 2026-10-20
- **Scope:** HTTP/HTTP2 application plugin loaders

## Decision

`streetApp.loadPlugin()` and `streetHttp2App.loadPlugin()` treat a failed
`onLoad` as an incomplete load. Middleware, listeners, and synchronous cleanup
registrations made during that attempt are disposed in reverse registration
order, cleanup continues after individual failures, and all failed-attempt
registrations are removed. A retry therefore receives a fresh sandbox.

When rollback succeeds, the original startup value is rethrown unchanged. If
cleanup fails, the loader throws `AggregateError` with the startup value as
`cause` and errors ordered as `[startupValue, ...cleanupFailures]`.

HTTP/2 now provides the same functional `on()` and `addCleanup()` ownership
contract as HTTP/1.1. HTTP/2 still does not expose a plugin-event emission API;
its event registrations are retained so they can be removed safely.

## Compatibility and boundaries

Cleanup callbacks remain synchronous per ADR 0014. Existing successful load,
unload, and manual-disposer behavior is preserved. This decision does not make
dependency-graph startup transactional, add cancellation, or change shutdown
ordering. A throwing `onUnload` during a successful unload remains a separate
failure-path review. The HTTP/2 regression coverage exercises lifecycle state
without opening a TLS listener; live HTTP/2 request parity remains unverified.

## Evidence

```sh
npm run build -w packages/core
node --test packages/core/dist/src/tests/roadmap-completion.test.js
```

The focused suite passes 42 tests, including HTTP/1.1 and HTTP/2 failed-load
rollback, cleanup ordering and continuation, error aggregation, retry, and
normal unload coverage.
