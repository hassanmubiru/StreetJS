# Changelog

All notable changes to `@streetjs/events` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024

### Added

- **Typed facade** — `createEvents<AppEvents>()` with exact payload types for
  `on`/`once`/`off`/`publish`. Supports string events and class-based events
  (`class UserCreated extends Event<…>`).
- **Wildcard subscriptions** — segment matching with `*` (exactly one segment)
  and `**` (one or more segments); typed wildcard payload inference.
- **Dispatch models** — ordered synchronous delivery via `publish`
  (awaits every listener in registration order), ordered fire-and-forget via
  `emit`, and per-listener error isolation so a throwing listener never blocks
  siblings or the publisher. `flush()` drains pending async delivery.
- **Middleware pipeline** — `use(...)` composes an around-delivery pipeline with
  veto support and a next-called-twice guard.
- **Event store + replay** — pluggable `EventStore` contract with an in-memory
  implementation (`MemoryEventStore`); `replay()` re-dispatches stored events to
  current listeners in recorded order.
- **Observability** — health checks and metrics built on the core
  `HealthCheckRegistry`/`MetricsRegistry`; `stats()` exposes per-event counters.
- **Tracing** — `createEventsTracing()` propagates a context across async
  delivery via `AsyncLocalStorage`.
- **Plugin** — `EventsPlugin` with a `register` hook and declarative `bridges`.
- **Integrations** (structural, no hard package dependencies):
  - `@streetjs/events/queue` — bridge queue events into application events.
  - `@streetjs/events/realtime` — broadcast application events to realtime rooms.
  - `@streetjs/events/bus` — forward to/from a distributed bus, loop-guarded.
- **Stores** (optional submodules):
  - `@streetjs/events/redis` — `RedisEventStore`.
  - `@streetjs/events/postgres` — `PostgresEventStore` + migration SQL.
- **Testing utilities** — `FakeEvents`, `createMemoryEvents`, `TestHarness`.
- **CLI** — `make:event` and `make:listener` generators.
- **Docs & example** — `README.md` and a runnable end-to-end example
  (`examples/basic.ts`) composing events + queue + realtime, exercised by an
  automated smoke test.

### Notes

- The only runtime dependency is `streetjs` (the framework core); all
  integrations accept structural interfaces to avoid circular package deps.
- Real-broker/DB integration tests (Redis, Postgres) skip honestly with an
  explicit BLOCKED message when the server is unavailable — they never fabricate
  passes.
