/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * A minimal primary/worker layout. The primary spawns one worker, which signals
 * readiness and heartbeats; after a moment the coordinator shuts down.
 * (Runs real child processes, so it exits itself when done.)
 */

import cluster from 'node:cluster';
import { ClusterCoordinator, workerHeartbeat, signalReady } from '../index.js';

if (cluster.isPrimary) {
  const coordinator = new ClusterCoordinator({
    workers: 1,
    onWorkerStart: (w) => process.stdout.write(`primary: spawned worker pid=${w.process.pid}\n`),
  });
  coordinator.start();
  setTimeout(() => {
    process.stdout.write('primary: shutting down\n');
    coordinator.shutdown();
    process.exit(0);
  }, 400);
} else {
  // Worker: announce readiness and start heartbeating.
  signalReady();
  const timer = workerHeartbeat(100);
  process.stdout.write(`worker ${process.pid}: ready + heartbeating\n`);
  setTimeout(() => {
    clearInterval(timer);
    process.exit(0);
  }, 300);
}
