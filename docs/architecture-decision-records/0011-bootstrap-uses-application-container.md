# ADR 0011: Bootstrap core services in the application container

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** core bootstrap and CLI command construction

## Problem

`src/main.ts` created core services and registered them in the process-global
container even though `StreetApp` could now use an application-scoped container.
That left the main framework bootstrap isolated from the new application model.

## Existing behavior

Configuration, pools, telemetry, WebSocket services, repositories, security
services, migration services, and controllers were registered/resolved through
the global container. CLI command handlers also always resolved through the
global container.

## Decision

Bootstrap creates one `createContainer()` instance and uses it for:

- configuration;
- database pool;
- telemetry and WebSocket services;
- repositories and services;
- migrations and security services;
- cache/webhook services;
- HTTP controller construction;
- CLI command construction.

The global container remains available for compatibility in direct library use,
tests, and applications that do not pass an explicit container.

## Alternatives considered

1. **Remove the global container immediately:** rejected because it is a public
   compatibility API and many internal callers still use it.
2. **Copy registrations into both containers:** rejected; duplicate service graphs
   would create inconsistent singleton identity and unclear ownership.
3. **Make `streetApp` implicitly discover the bootstrap container:** rejected;
   explicit container injection keeps ownership visible.

## Compatibility impact

The executable bootstrap now owns an isolated service graph. Direct consumers of
the exported global container are unchanged. CLI construction accepts a container
option but continues defaulting to the global container.

## Migration path

Future scaffolded applications should use the same application container and
dispose it during shutdown. Request scopes and full resource ownership remain
separate follow-up changes.

## Evidence

Core builds, the 39-test roadmap suite, and lint pass after the bootstrap and CLI
container changes.
