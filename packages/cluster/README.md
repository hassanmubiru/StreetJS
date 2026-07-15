# @streetjs/cluster

The clustering foundation for StreetJS: a **primary-process cluster coordinator** that
spawns workers across CPU cores with IPC heartbeat monitoring and auto-restart, plus
worker-side heartbeat/ready helpers.

**Zero runtime dependencies.** Built on Node.js core (`cluster`, `os`) only, matching the
StreetJS minimal, carefully curated dependency footprint.

```bash
npm install @streetjs/cluster
```

> This is the standalone home of the coordinator that also backs the `streetjs/cluster`
> subpath; the `streetjs` framework re-exports it, so there is a single implementation.

## Usage

```ts
import cluster from 'node:cluster';
import { ClusterCoordinator, workerHeartbeat, signalReady } from '@streetjs/cluster';

if (cluster.isPrimary) {
  const coordinator = new ClusterCoordinator({
    workers: 4,                 // default: number of CPUs
    heartbeatIntervalMs: 10_000,
    heartbeatTimeoutMs: 30_000,
    onWorkerStart: (w) => log(`worker ${w.process.pid} up`),
    onWorkerExit: (w, code) => log(`worker ${w.process.pid} exited (${code})`),
  });
  coordinator.start();
  process.on('SIGTERM', () => coordinator.shutdown());
} else {
  startServer();
  signalReady();        // tell the primary this worker is ready
  workerHeartbeat();    // periodic liveness ping
}
```

## Behavior

- **Spawns** `workers` child processes (default = CPU count) from the primary.
- **Heartbeat monitoring** — workers ping via `workerHeartbeat()`; the primary kills and
  replaces any worker that misses `heartbeatTimeoutMs`.
- **Auto-restart** — a worker that exits is respawned after a short delay (avoids tight
  restart loops).
- **Clean shutdown** — `shutdown()` removes cluster listeners, clears the heartbeat timer,
  and `SIGTERM`s all workers.
- **Idempotent start** — a second `start()` is ignored (prevents listener pile-up);
  calling `start()` off the primary throws.

`IpcMessage` (`heartbeat | ready | shutdown | telemetry`) is the worker↔primary message
shape and is exported for typing custom IPC.

## Dependency injection

Exports a `CLUSTER_COORDINATOR` token (a global `Symbol`):

```ts
import { CLUSTER_COORDINATOR, ClusterCoordinator } from '@streetjs/cluster';
container.register(CLUSTER_COORDINATOR, new ClusterCoordinator());
```

## Public API

`ClusterCoordinator` · `workerHeartbeat` · `signalReady` · `ClusterOptions` ·
`IpcMessage` · `CLUSTER_COORDINATOR` token.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design notes, and
`src/examples/integration.ts` for a runnable primary/worker example.

## License

MIT © street contributors
