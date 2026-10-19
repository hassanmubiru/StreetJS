# ADR 0012: Let app-owned containers close during application shutdown

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** `Container`, `streetApp`, `streetHttp2App`, and executable bootstrap

## Problem

Application-scoped containers could be passed to `StreetApp`, but the framework
did not express or enforce who owned their shutdown. Bootstrap therefore had to
manually close each registered resource, and repeated application shutdown was
not uniformly idempotent.

## Existing behavior

`Container.dispose()` closed `dispose()`/`close()` resources, while some existing
framework resources such as telemetry expose `destroy()`. `StreetApp.close()`
only closed the HTTP server. The executable bootstrap manually closed pool,
WebSocket, and telemetry resources.

## Decision

Add `containerOwnership: 'external' | 'app'` to application options.

- `external` remains the default and preserves existing global/caller-owned
  behavior.
- `app` creates a container when one is not supplied, and `app.close()` disposes
  the selected container exactly once after the server closes.
- `Container.dispose()` recognizes `dispose()`, `close()`, and synchronous
  `destroy()` resource hooks.
- HTTP2 follows the same ownership rule.
- The executable bootstrap opts into app ownership and removes duplicate manual
  closes for resources registered in that container.

## Alternatives considered

1. **Always dispose the selected container:** rejected because existing callers
   may share an external container across applications.
2. **Keep manual shutdown lists in bootstrap:** rejected; ownership would remain
   duplicated and drift as services are added.
3. **Treat only `close()` as cleanup:** rejected because existing first-party
   telemetry uses `destroy()`.

## Compatibility impact

Default behavior is unchanged. Only applications selecting `containerOwnership:
'app'` receive automatic container disposal. Existing `app.close()` behavior is
preserved for external containers, with successful close now idempotent.

## Migration path

Scaffolds should opt into app ownership and register long-lived services in the
application container. Request scopes and plugin resource registries remain
separate follow-up contracts.

## Evidence

Container tests cover destroy-only resources. Core tests verify app-owned
container disposal exactly once across repeated `app.close()` calls. Core build,
lint, and the 40-test roadmap suite pass.
