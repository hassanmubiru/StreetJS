# StreetJS Lifecycle and Resource Ownership Report

**Audit date:** 2026-10-20  
**Scope:** framework-owned long-lived resources identified across the 99
workspace packages

## Ownership criteria

Every row was reviewed against these questions:

1. Who creates the resource?
2. Who owns it?
3. Who closes it?
4. What happens on partial startup failure?
5. Is close idempotent?
6. Is close awaited?
7. Can plugin unload leak it?
8. Can application shutdown leak it?
9. Can application instances interfere?
10. Is ownership testable?

## Resource matrix

| Resource | Creates/owns | Close path | Partial failure | Idempotent/awaited | Isolation/testability | Assessment |
|---|---|---|---|---|---|---|
| HTTP server | `streetApp()` creates the server; app owns it | `StreetApp.close()` transitions through `DRAINING`, drains the listener, and disposes an app-owned container | Failed listen returns to `CREATED`; close cleanup failure preserves `DRAINING` | Lifecycle state is explicit; close is memoized/idempotent and container disposal is awaited | Per-app state; focused lifecycle tests cover pre-listen, concurrent close, active drain, and failure | **Mostly conformant; see ADR 0023** |
| HTTP/2 server | HTTP/2 factory creates and owns server state | HTTP/2 `close()` follows the same lifecycle state and app-owned container rule | Failed listen returns to `CREATED`; close cleanup failure preserves `DRAINING` | Lifecycle state is explicit; close is memoized/idempotent and container disposal is awaited | Per-app state; TLS integration covers completion, reset, scope disposal, listener cleanup, session reuse, and drain | **Mostly conformant; see ADRs 0022–0023** |
| WebSocket server | `StreetWebSocketServer` owns sockets and heartbeat timer | `close()` stops heartbeat and closes active connections/server | Connection setup failure paths are locally handled | Async close is memoized/idempotent; application shutdown hook has a bounded grace deadline | Instance-local state; unit/integration tests exist | **Mostly conformant; no forced close deadline on the standalone server** |
| Queue workers | `Queue` creates workers and scheduler; queue owns them | `Queue.close()` stops workers, scheduler, then driver | Driver-init failure tests exercise unload/close behavior | Closed guard is idempotent; all close calls are awaited | Queue instances own their drivers; lifecycle tests exist | **Conformant** |
| Queue scheduler/timers | Queue scheduler owns promotion/cron timers | Scheduler stop is called by queue close | Scheduler startup is coupled to queue startup | Stop is awaited by queue close | Instance-local; scheduler tests exist | **Conformant** |
| Database pools | `Pool` creates idle sweep timer and connections; pool owns them | `Pool.close()` clears timer and closes resources | Pool tests cover failure and cleanup paths | Async close exists; close behavior is tested | Instance-local; injected connection factory enables tests | **Conformant** |
| Redis queue/realtime/event adapters | Adapter constructors create client connections; adapter/facade owns them | Adapter/facade `close()` paths | Redis integration is unavailable in this environment; local failure behavior is tested selectively | Async close exists; facade/plugin unload awaits it | Instance-local; Redis suites are explicit external skips | **Conformant with unavailable-service evidence** |
| Cache clients | Cache implementations own client state when a client is created | Package-specific close/dispose paths vary | Not covered by one common lifecycle contract | Requires package-specific review | Tests are package-local | **P2 standardization review** |
| Events observability | Events facade owns refresh timer and event store | `events.close()` and plugin `onUnload()` | Plugin tests cover no-op unload and loaded unload | Close is async and awaited | Instance-local; plugin tests cover unload | **Conformant** |
| Storage observability/client | Storage facade owns refresh timer, driver, and bridge resources | `storage.close()`; plugin detaches bridges then awaits close | Driver and plugin tests cover cleanup, including bridge detach | Async close is awaited and repeated plugin lifecycle is tested | Instance-local; storage suite has 374 tests | **Conformant** |
| Realtime facade/health | Realtime facade owns adapter and health refresh timer | Realtime facade/plugin close paths; adapter close | Redis path requires explicit integration service; memory path is tested | Async close exists; plugin unload awaits facade close | Instance-local; memory and Redis paths are separable | **Mostly conformant; P2 common timer contract** |
| Workflow engine | Workflow engine owns runtime state and active timers; plugin owns engine reference | Engine `close()`; plugin unload closes it after bridge detach | Workflow tests cover plugin lifecycle and runtime failure behavior | Async close and plugin unload are awaited | Instance-local; fake stores/clocks support deterministic tests | **Conformant** |
| Telemetry tracker | `TelemetryTracker` creates an unref'd interval; tracker owns it | Explicit `destroy()` clears interval | Constructor has no multi-resource startup sequence | Destroy is synchronous and repeat-safe at the timer API level; not part of common app close | Instance-local; deterministic state but no app shutdown integration test | **P2 integration gap** |
| Metrics/health refresh | Facades register refresh timers against supplied registries | Facade close paths stop timers | Registration failures are generally best-effort; partial registry failure needs matrix coverage | Close is package-specific and generally awaited through facade close | Shared registry by design; timer ownership remains facade-local | **P2 contract clarity gap** |
| Plugin resources/listeners | Plugin host/server creates sandbox registrations; plugin or host owns cleanup | `SandboxedApp.addCleanup()` and listener unsubscribe; host unloads plugin | Formal `PluginHost` and HTTP/HTTP2 application loaders roll back failed install/load sandbox registrations; enabled dependencies remain owned by the host | Synchronous cleanup is idempotent, reverse-ordered, exhaustive during failed-load rollback; throwing unload paths remain incomplete | Focused host and application tests cover retained registrations and retry; live HTTP/2 TLS request parity not proven | **Mostly conformant; see ADRs 0020–0021** |
| Tracing exporters | Package-specific exporter/transport ownership | No single common close contract proven across all tracing implementations | Requires per-exporter review | Not enough evidence for a universal assertion | Package-local tests only | **P2 audit follow-up** |

## Cross-cutting conclusions

- No global singleton was introduced as a lifecycle shortcut.
- Application-owned containers, request scopes, plugin cleanup, queue close,
  storage close, events close, realtime close, and workflow close are explicit.
- Failed formal plugin enable and application plugin loads previously retained
  sandbox registrations; ADRs 0020–0021 fix these narrow paths. The remaining
  audit labels are not certification of all failure behavior: a cross-package
  lifecycle contract suite is still absent. Request cancellation is cooperative
  through `StreetContext.signal` per ADR 0022; arbitrary promise cancellation
  remains out of scope.
- `destroy()` versus `close()`/`dispose()` naming is inconsistent for some
  standalone capabilities. Unifying it requires an ADR and compatibility review.
- Application lifecycle state and graceful close semantics are now explicit for
  HTTP/1.1 and HTTP/2 per ADR 0023. The cloud shutdown hook now enforces a
  bounded grace deadline per ADR 0026; forced cancellation and cross-package
  resource orchestration remain unimplemented.
- ADR 0024 adds a reusable HTTP resource conformance harness covering timers,
  request listeners/scopes, plugin registrations, app-owned resources, failure
  cleanup, repeated cleanup, and cross-application isolation. This harness is
  not a certification of WebSocket, queue, storage, workflow, or telemetry
  lifecycle behavior.
- Live TLS HTTP/2 request lifecycle is covered by the runtime-generated
  certificate integration in ADR 0022. Docker and external-service lifecycle
  remain unverified or skipped.
- External-service tests are not claimed as passing when Redis/PostgreSQL or
  provider credentials are unavailable.

## Recommended P2 lifecycle work

1. Add a lifecycle harness that creates two independent application instances
   and verifies resources, timers, listeners, and containers do not cross-talk.
2. Add failure-injection tests for partial startup across HTTP/2, WebSocket,
   queue, storage, telemetry, and tracing.
3. Define a compatibility-preserving common shutdown adapter for standalone
   `destroy()` resources without forcing every package to expose the same
   implementation class.
