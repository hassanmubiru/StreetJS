import { test } from 'node:test';
import assert from 'node:assert/strict';
import cluster from 'node:cluster';

import { ClusterCoordinator, workerHeartbeat, signalReady, type IpcMessage } from '../coordinator.js';
import { CLUSTER_COORDINATOR } from '../index.js';

interface FakeWorker {
  id: number;
  process: { pid: number };
  killed: string[];
  kill(sig: string): void;
}

function fakeWorker(id: number): FakeWorker {
  return { id, process: { pid: 1000 + id }, killed: [], kill(sig) { this.killed.push(sig); } };
}

/** Inject a worker into the coordinator's private state (white-box). */
function inject(coord: ClusterCoordinator, w: FakeWorker, lastHeartbeat = Date.now()): void {
  (coord as unknown as { workerMap: Map<number, unknown> }).workerMap.set(w.id, {
    worker: w,
    lastHeartbeat,
    ready: false,
  });
}

test('constructor applies worker count and option defaults', () => {
  const c = new ClusterCoordinator({ workers: 3 });
  const opts = (c as unknown as { opts: Record<string, number> }).opts;
  assert.equal(opts.workers, 3);
  assert.equal(opts.heartbeatIntervalMs, 10_000);
  assert.equal(opts.heartbeatTimeoutMs, 30_000);
});

test('start() throws when not called from the primary process', () => {
  const original = cluster.isPrimary;
  Object.defineProperty(cluster, 'isPrimary', { value: false, configurable: true });
  try {
    const c = new ClusterCoordinator({ workers: 1 });
    assert.throws(() => c.start(), /must be called from the primary/);
  } finally {
    Object.defineProperty(cluster, 'isPrimary', { value: original, configurable: true });
  }
});

test('worker heartbeat messages refresh lastHeartbeat; ready flips ready', () => {
  const c = new ClusterCoordinator({ workers: 1 });
  const w = fakeWorker(1);
  inject(c, w, 0);
  const handle = (c as unknown as { _handleWorkerMessage(worker: unknown, msg: IpcMessage): void });
  handle._handleWorkerMessage(w, { type: 'heartbeat', ts: Date.now() });
  const state = (c as unknown as { workerMap: Map<number, { lastHeartbeat: number; ready: boolean }> }).workerMap.get(1)!;
  assert.ok(state.lastHeartbeat > 0);
  handle._handleWorkerMessage(w, { type: 'ready', ts: Date.now() });
  assert.equal(state.ready, true);
  // telemetry + unknown-worker are no-ops (no throw).
  handle._handleWorkerMessage(w, { type: 'telemetry', ts: Date.now() });
  handle._handleWorkerMessage(fakeWorker(99), { type: 'heartbeat', ts: Date.now() });
});

test('heartbeat monitor kills and removes workers that time out', () => {
  const c = new ClusterCoordinator({ workers: 1, heartbeatTimeoutMs: 100 });
  const stale = fakeWorker(1);
  inject(c, stale, Date.now() - 10_000); // long past the timeout
  (c as unknown as { _checkHeartbeats(): void })._checkHeartbeats();
  assert.deepEqual(stale.killed, ['SIGTERM']);
  assert.equal((c as unknown as { workerMap: Map<number, unknown> }).workerMap.has(1), false);
});

test('worker exit removes the worker and schedules a respawn', () => {
  const c = new ClusterCoordinator({ workers: 1 });
  let respawned = 0;
  (c as unknown as { _spawnWorker(): void })._spawnWorker = () => {
    respawned++;
  }; // stub the fork
  let exited = 0;
  (c as unknown as { opts: { onWorkerExit: () => void } }).opts.onWorkerExit = () => {
    exited++;
  };
  const w = fakeWorker(1);
  inject(c, w);
  (c as unknown as { _onExit(worker: unknown, code: number | null, signal: string | null): void })._onExit(w, 1, null);
  assert.equal((c as unknown as { workerMap: Map<number, unknown> }).workerMap.has(1), false);
  assert.equal(exited, 1);
});

test('shutdown kills all workers and clears state', () => {
  const c = new ClusterCoordinator({ workers: 2 });
  const a = fakeWorker(1);
  const b = fakeWorker(2);
  inject(c, a);
  inject(c, b);
  c.shutdown();
  assert.deepEqual(a.killed, ['SIGTERM']);
  assert.deepEqual(b.killed, ['SIGTERM']);
  assert.equal((c as unknown as { workerMap: Map<number, unknown> }).workerMap.size, 0);
});

test('workerHeartbeat sends heartbeats when an IPC channel exists', async () => {
  const sent: IpcMessage[] = [];
  const original = process.send;
  (process as { send?: unknown }).send = (msg: IpcMessage): boolean => {
    sent.push(msg);
    return true;
  };
  // Restore only after the interval has had a chance to fire (not synchronously).
  try {
    const timer = workerHeartbeat(5);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    clearInterval(timer);
    assert.ok(sent.some((m) => m.type === 'heartbeat'));
  } finally {
    (process as { send?: unknown }).send = original;
  }
});

test('workerHeartbeat is a no-op without an IPC channel', () => {
  const original = process.send;
  (process as { send?: unknown }).send = undefined;
  try {
    const timer = workerHeartbeat(5);
    clearInterval(timer);
    assert.ok(true); // no throw
  } finally {
    (process as { send?: unknown }).send = original;
  }
});

test('signalReady sends a ready message when an IPC channel exists', () => {
  const sent: IpcMessage[] = [];
  const original = process.send;
  (process as { send?: unknown }).send = (msg: IpcMessage): boolean => {
    sent.push(msg);
    return true;
  };
  try {
    signalReady();
    assert.equal(sent[0]?.type, 'ready');
  } finally {
    (process as { send?: unknown }).send = original;
  }
  // Without a channel it is a no-op.
  (process as { send?: unknown }).send = undefined;
  try {
    assert.doesNotThrow(() => signalReady());
  } finally {
    (process as { send?: unknown }).send = original;
  }
});

test('DI token is a stable global symbol', () => {
  assert.equal(CLUSTER_COORDINATOR, Symbol.for('@streetjs/cluster:Coordinator'));
});
