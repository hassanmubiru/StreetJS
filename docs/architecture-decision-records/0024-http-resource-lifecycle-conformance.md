# ADR 0024: HTTP resource lifecycle conformance harness

- **Status:** Accepted
- **Date:** 2026-10-21
- **Scope:** HTTP/1.1 and HTTP/2 application adapters and their test contract

## Decision

StreetJS maintains a reusable test-only lifecycle harness at
`packages/core/src/tests/helpers/http-resource-lifecycle.ts`. The harness is
parameterized by an application factory and real request adapter where the
transport permits it. It verifies application-owned HTTP resources across:

- timers and timer-owning container resources;
- request transport listeners;
- request-scoped dependencies;
- plugin middleware, listeners, and cleanup registrations;
- app-owned container resources.

Each adapter is exercised for normal close, cleanup failure, repeated cleanup,
cross-application isolation, and startup failure. Cleanup failures remain
observable while later cleanup still runs. App-owned resources are not shared
between application instances.

## Runtime fixes covered by the harness

- Body-parser listeners are removed on both success and rejection paths.
- Application close unloads loaded plugin registrations for HTTP/1.1 and HTTP/2.
- Plugin `onUnload` failure does not prevent remaining plugin cleanup or
  registration removal.
- App-owned containers are disposed after failed listener startup.
- Plugin and container cleanup failures are aggregated without advancing a
  failed application to `CLOSED`.

## Boundaries

This is a conformance harness, not a global lifecycle manager. It does not add
shutdown deadlines, force-cancel active work, or orchestrate WebSocket, queue,
storage, workflow, or telemetry resources. HTTP/1.1 request checks use real
network traffic. HTTP/2 lifecycle checks run without TLS network traffic because
`streetHttp2App` uses `createSecureServer`; live TLS HTTP/2 coverage remains a
separate integration concern.

## Evidence

```sh
./node_modules/.bin/tsc -p packages/core/tsconfig.json
node --test packages/core/dist/src/tests/http-resource-lifecycle.test.js
```

The harness currently passes six focused tests: three for HTTP/1.1 and three
for HTTP/2.
