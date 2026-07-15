# @streetjs/cluster — Architecture

## Goals

- A single, generic multi-process cluster coordinator for StreetJS.
- Zero runtime dependencies (Node core `cluster` + `os`).
- Resilient workers: heartbeat monitoring + auto-restart, clean shutdown.
- Strongly typed; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  coordinator.ts  ClusterCoordinator + workerHeartbeat/signalReady + IpcMessage.
  index.ts        Curated public API + CLUSTER_COORDINATOR DI token.
```

## Extraction & single source of truth

Extracted from `streetjs` core (`cluster/coordinator`). The `IpcMessage` type and the
coordinator now live here; core re-exports both (its `core/types.ts` re-exports
`IpcMessage`, and `cluster/coordinator.ts` re-exports the class + helpers), so the
`streetjs/cluster` subpath resolves to one implementation — dependency inversion, not
duplication or a shim.

## Design

- **Primary** forks `workers` children (default CPU count), tracks each in a map with its
  last heartbeat and readiness, and registers `exit`/`message` listeners once (guarded
  against duplicate `start()`).
- **Heartbeat** — workers call `workerHeartbeat()` (periodic `heartbeat` IPC) and
  `signalReady()` (a one-shot `ready`); the primary refreshes `lastHeartbeat` on each ping
  and, on an interval, `SIGTERM`s + removes any worker exceeding `heartbeatTimeoutMs`.
- **Auto-restart** — an exited worker is removed and respawned after ~500 ms (unref'd), so
  a crash loop cannot spin the CPU.
- **Shutdown** — clears the monitor timer, removes cluster listeners (no leaks), and
  `SIGTERM`s every worker.

All timers are `unref`'d so the coordinator never keeps a process alive on its own.

## Testing

`node --test`: constructor defaults, the non-primary `start()` guard (via a toggled
`cluster.isPrimary`), IPC message routing (`heartbeat`/`ready`/`telemetry`/unknown worker),
heartbeat-timeout kill+evict, worker-exit removal + respawn scheduling, `shutdown()`
teardown, and the `workerHeartbeat`/`signalReady` helpers (with and without an IPC
channel). A runnable example forks a real worker end-to-end.

Coverage thresholds (lines/statements ≥ 80, functions ≥ 80, branches ≥ 75) are lower than
the leaf packages by design: `start()` and `_spawnWorker` call `cluster.fork()` to spawn
real OS processes, which is validated by the runnable example and production dogfooding
rather than in-process unit tests. The pure coordination logic is fully covered.
