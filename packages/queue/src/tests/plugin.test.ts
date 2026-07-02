// src/tests/plugin.test.ts
// Task 13.2 — unit tests for `QueuePlugin.onLoad` wiring (Req 12.1, 12.2).
//
// These tests assert that `QueuePlugin.onLoad`:
//   - constructs the Queue facade (exposed through the public `plugin.queue`
//     accessor, which is `undefined` before load), and
//   - registers the queue health check (Req 12.1) and the five queue metrics
//     (Req 12.2) against the app's registries — resolved from `QueueOptions`
//     because the `SandboxedApp` exposes only `use`/`on` —
// all WITHOUT modifying core: everything the test needs is imported from the
// `streetjs` core package (the fresh `HealthCheckRegistry` / `MetricsRegistry`)
// and from this package (`QuePlugin` + the observability metric-name constants).
//
// The `SandboxedApp` handed to `onLoad`/`onUnload` is a minimal fake — `{ use,
// on }` — matching the real sandbox surface, so no application/host machinery is
// needed to exercise the plugin.
//
// Nothing is mocked: the facade is the real `createQueue` default (a real
// MemoryDriver), and the health/metrics registries are the real core subsystems.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HealthCheckRegistry, MetricsRegistry } from 'streetjs';
import type { SandboxedApp } from 'streetjs';

import { QueuePlugin } from '../plugin.js';
import type { Queue } from '../facade.js';
import {
  QUEUE_HEALTH_CHECK_NAME,
  QUEUE_LENGTH_METRIC,
  QUEUE_WORKER_STATUS_METRIC,
  QUEUE_JOB_LATENCY_METRIC,
  QUEUE_PROCESSED_METRIC,
  QUEUE_FAILURES_METRIC,
} from '../observability.js';

/** The five queue metrics that `onLoad` must register against the registry (Req 12.2). */
const QUEUE_METRICS = [
  QUEUE_LENGTH_METRIC,
  QUEUE_WORKER_STATUS_METRIC,
  QUEUE_JOB_LATENCY_METRIC,
  QUEUE_PROCESSED_METRIC,
  QUEUE_FAILURES_METRIC,
] as const;

/**
 * A minimal fake of the `SandboxedApp` the plugin host hands to a plugin. The
 * real sandbox exposes only `use(middleware)` and `on(event, handler)`; the
 * queue plugin touches neither in `onLoad`/`onUnload` (it resolves its
 * registries from `QueueOptions`), so no-op implementations suffice.
 */
function makeFakeApp(): SandboxedApp {
  return { use() {}, on() {} } as unknown as SandboxedApp;
}

// ── onLoad wires the facade + observability against the app's registries ───────

test('onLoad constructs the facade and registers the health check + metrics (Req 12.1, 12.2)', async () => {
  const health = new HealthCheckRegistry();
  const metrics = new MetricsRegistry();
  const plugin = new QueuePlugin({ health, metrics });
  const app = makeFakeApp();

  // Before load, the facade is not yet constructed.
  assert.equal(plugin.queue, undefined, 'plugin.queue is undefined before onLoad');

  await plugin.onLoad(app);

  // The facade is now constructed and exposed through the accessor.
  const facade = plugin.queue;
  assert.notEqual(facade, undefined, 'plugin.queue is a defined Queue after onLoad');
  assert.equal(typeof facade?.dispatch, 'function', 'the exposed value is a Queue facade');

  // Req 12.1: the `queue` health check is registered and reports `up` for the
  // default Memory driver through the core registry.
  const liveness = await health.runLiveness();
  assert.ok(
    QUEUE_HEALTH_CHECK_NAME in liveness.checks,
    `the '${QUEUE_HEALTH_CHECK_NAME}' check is registered against the app's health registry`,
  );
  const queueCheck = liveness.checks[QUEUE_HEALTH_CHECK_NAME]!;
  assert.equal(queueCheck.status, 'up', 'the Memory driver reports up');

  // Req 12.2: all five queue metrics are registered against the app's metrics
  // registry.
  for (const name of QUEUE_METRICS) {
    assert.equal(
      metrics.has(name),
      true,
      `${name} is registered against the app's metrics registry`,
    );
  }

  await plugin.onUnload(app);
});

// ── onLoad is idempotent: a second load reuses the same facade ─────────────────

test('a second onLoad without unload reuses the facade and does not throw (Req 12.1, 12.2)', async () => {
  const health = new HealthCheckRegistry();
  const metrics = new MetricsRegistry();
  const plugin = new QueuePlugin({ health, metrics });
  const app = makeFakeApp();

  await plugin.onLoad(app);
  const firstFacade = plugin.queue;
  assert.ok(firstFacade, 'the facade is constructed on the first onLoad');

  // A second load without an intervening unload must not throw and must reuse
  // the already-constructed facade (identity unchanged).
  await assert.doesNotReject(async () => {
    await plugin.onLoad(app);
  }, 'a second onLoad does not throw');
  assert.equal(plugin.queue, firstFacade, 'the facade identity is unchanged on a second onLoad');

  // The metrics remain registered exactly once (reused, not duplicated) and the
  // health check still reports up.
  for (const name of QUEUE_METRICS) {
    assert.equal(metrics.has(name), true, `${name} remains registered after the second onLoad`);
  }
  const liveness = await health.runLiveness();
  assert.equal(liveness.checks[QUEUE_HEALTH_CHECK_NAME]?.status, 'up', 'health check still up');

  await plugin.onUnload(app);
});

// ── onUnload tears the facade down gracefully ──────────────────────────────────

test('onUnload closes gracefully and clears the exposed facade (Req 12.1, 12.2)', async () => {
  const health = new HealthCheckRegistry();
  const metrics = new MetricsRegistry();
  const plugin = new QueuePlugin({ health, metrics });
  const app = makeFakeApp();

  await plugin.onLoad(app);
  assert.ok(plugin.queue, 'the facade is constructed after onLoad');

  await assert.doesNotReject(async () => {
    await plugin.onUnload(app);
  }, 'onUnload closes without throwing');
  assert.equal(plugin.queue, undefined, 'plugin.queue is undefined after onUnload');
});

// ── onUnload when never loaded is a no-op ──────────────────────────────────────

test('onUnload is a no-op when the plugin was never loaded', async () => {
  const plugin = new QueuePlugin({
    health: new HealthCheckRegistry(),
    metrics: new MetricsRegistry(),
  });
  const app = makeFakeApp();

  assert.equal(plugin.queue, undefined, 'plugin.queue is undefined before any load');
  await assert.doesNotReject(async () => {
    await plugin.onUnload(app);
  }, 'onUnload on a never-loaded plugin does not throw');
  assert.equal(plugin.queue, undefined, 'plugin.queue remains undefined');
});
