# StreetJS Observability Contract Ownership

**Decision date:** 2026-10-20  
**Scope:** core facade, `@streetjs/metrics`, and `@streetjs/health`

## Decision

StreetJS keeps two intentionally distinct observability contract families:

1. **Framework-integrated observability** is owned by `streetjs`.
   `HealthCheckRegistry` and the Prometheus `MetricsRegistry` are coupled to
   `StreetApp`, core middleware, core HTTP routes, and existing queue,
   realtime, storage, and workflow integrations.
2. **Standalone observability foundations** are owned by `@streetjs/metrics`
   and `@streetjs/health`. They are framework-agnostic packages for libraries,
   adapters, and applications that want independent registries and
   transport-neutral reporting.

Neither family is a drop-in implementation of the other. No import narrowing,
aliasing, inheritance, or package merge is justified by the current evidence.

## Contract comparison

| Concern | Core `streetjs` contract | Standalone packages | Compatibility implication |
|---|---|---|---|
| Metrics registration | `counter`, `gauge`, `histogram` methods | `register(Collectable)` | Different construction models |
| Metrics collection | `collect()` returns Prometheus text | `collect()` returns snapshots; `render()` returns text | Incompatible return contracts |
| Metrics lifecycle | Core middleware owns HTTP metrics and a heap interval | Standalone registry is timer-free | Core integration owns extra resources |
| Health registration | `addCheck(name, fn, { type, timeoutMs })` | `register({ name, check, kind, critical, timeoutMs })` | Different options and result semantics |
| Health status | `up` / `down`, aggregated to `ok` / `degraded` | `pass` / `warn` / `fail`, with `health+json` | Status and transport shapes differ |
| Health timing | Core uses `Date.now()` | Standalone health accepts an injectable clock | Different determinism contracts |
| HTTP integration | Core provides `/metrics`, `/health/live`, `/health/ready` | Standalone packages are transport-neutral | Different integration ownership |
| Runtime identity | Core classes and DI tokens | Standalone classes and DI tokens | Registries must not be mixed by `instanceof` or token |

## Compatibility guarantees

- Existing `streetjs` exports remain stable.
- Existing `@streetjs/metrics` and `@streetjs/health` exports remain stable.
- Core integrations continue to consume core registry types.
- Standalone registries remain usable without loading the core framework.
- No application lifecycle behavior changes.

## Evidence

Core compatibility is covered by the core Prometheus, health, observability
pack, subsystem, and no-database-bootstrap tests. Standalone compatibility is
covered by the metrics registry/metric tests and health registry/unit tests.

A future bridge requires explicit adapters and tests for registration,
collection, status mapping, timeout behavior, routes, and lifecycle ownership.
