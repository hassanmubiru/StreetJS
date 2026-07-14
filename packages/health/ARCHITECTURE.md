# @streetjs/health — Architecture

## Goals

- A single, generic health-check foundation every StreetJS package/app can build on.
- Zero runtime dependencies (Node.js core only), matching the framework's minimal,
  carefully curated footprint.
- HTTP-framework-agnostic: produce a status + report; the caller wires the response.
- Standard output: IETF `health+json`.
- Strongly typed, interface-first; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  types.ts     Public interfaces: statuses, check options, outcome, report, response.
  status.ts    Severity ordering, aggregation rules, HTTP status mapping.
  timeout.ts   withTimeout + TimeoutError (unref'd timer).
  check.ts     normalizeCheck (validate/default) + runCheck (bounded execution).
  report.ts    buildReport (group + aggregate) + toEndpointResponse + content type.
  registry.ts  HealthRegistry: register/run/liveness/readiness/startup/endpoint.
  index.ts     Curated public API. Internals are not exported.
```

## Dependency graph (acyclic)

```
types   ← status, timeout, check, report, registry
status  ← report
timeout ← check
check   ← registry
report  ← registry
registry ← index
index   → everything public
```

One direction only. `status` and `report` are usable independently of the registry, so
aggregation and rendering can be tested and reused in isolation.

## Execution model

`HealthRegistry.run(kind?)`:

1. Select registered checks (all, or those matching `kind`).
2. Run them **concurrently** (`Promise.all`); each check goes through `runCheck`.
3. `runCheck` wraps the check in `Promise.resolve().then(...)` so synchronous throws are
   caught too, bounds it with `withTimeout`, and records duration from the injected
   clock. Return value → status/output/observedValue/details; throw → `fail` with the
   message; timeout → `fail` with `timed out after Nms`. It never throws.
4. `buildReport` groups outcomes by component name and computes the overall status.

## Aggregation rules

Severity order is `pass < warn < fail`. The overall status is the worst outcome, with
one nuance: a **non-critical** check that fails degrades the overall status only to
`warn`, never `fail`. This lets a service stay "ready" (HTTP 200) when a best-effort
dependency (e.g. a cache) is down, while a critical dependency failure returns 503.

## HTTP mapping

`httpStatusFor` maps `fail → 503` and `pass`/`warn → 200`. `toEndpointResponse` bundles
the code, the `application/health+json` content type, and the serialized report so the
caller can respond with any HTTP server without this package importing one.

## Timeouts

`withTimeout` races the check against a timer. The timer is `unref`'d, so a check that
never settles cannot keep the process alive; its promise is abandoned and the outcome is
recorded as a timeout `fail`. Default per-check timeout is 5s, overridable per check.

## Extension points

- **Custom checks** are just functions returning a `CheckResult` (or throwing). Package
  authors ship check factories (e.g. a DB ping) that applications register by name.
- **Deterministic time** via the injectable `clock` (used throughout the test suite).
- **Downstream StreetJS packages** accept a `HealthRegistry` by interface and receive one
  via the `HEALTH_REGISTRY` DI token; they depend on `@streetjs/health`, never the reverse.

## Testing

`node --test` over real behavior with an injected clock: pass/warn/fail outcomes,
returned-result mapping (status/output/observedValue/details), throwing and non-Error
throwables, non-critical degradation, real timeout behavior, kind isolation
(liveness/readiness/startup + run-all), endpoint 200/503 mapping, register/unregister/
get/list/clear, duplicate and invalid registrations, and the status/report/timeout units
in isolation. Coverage is enforced at ≥90% (`c8 check-coverage`); the declaration-only
`types.ts` is excluded as it emits no executable code.
