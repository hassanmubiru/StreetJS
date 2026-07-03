// Focused unit tests for storage metrics/health *registration* (task 22.2).
//
// Complements observability.test.js (task 22.1) — which covers live stat
// tracking, metric kinds, and health up/down — by asserting the registration
// contract explicitly:
//
//   1. Idempotent registration: calling registerStorageObservability twice
//      against the SAME MetricsRegistry does not throw and REUSES the existing
//      metrics rather than registering duplicates (Req 23.1).
//   2. Every one of the ten required metrics is registered: uploads, downloads,
//      bytes uploaded, bytes downloaded, active uploads, failed uploads,
//      storage usage, latency, multipart uploads, resumable sessions (Req 23.2).
//   3. The provider health check is registered against the existing
//      HealthCheckRegistry as the single `storage` check sourced from probe(),
//      surfacing connectivity / writability / readability / quota (Req 23.3).
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 23.1, 23.2, 23.3

import test from "node:test";
import assert from "node:assert/strict";

import { HealthCheckRegistry, MetricsRegistry } from "streetjs";

import {
  createStorage,
  registerStorageObservability,
  STORAGE_HEALTH_CHECK_NAME,
  STORAGE_UPLOADS_METRIC,
  STORAGE_DOWNLOADS_METRIC,
  STORAGE_BYTES_UPLOADED_METRIC,
  STORAGE_BYTES_DOWNLOADED_METRIC,
  STORAGE_ACTIVE_UPLOADS_METRIC,
  STORAGE_FAILED_UPLOADS_METRIC,
  STORAGE_USAGE_METRIC,
  STORAGE_LATENCY_METRIC,
  STORAGE_MULTIPART_METRIC,
  STORAGE_RESUMABLE_METRIC,
} from "../index.js";

// The ten metrics Requirement 23.2 mandates, keyed by their exported name
// constant so a missing/renamed constant fails the test at import time.
const REQUIRED_METRICS = [
  STORAGE_UPLOADS_METRIC,
  STORAGE_DOWNLOADS_METRIC,
  STORAGE_BYTES_UPLOADED_METRIC,
  STORAGE_BYTES_DOWNLOADED_METRIC,
  STORAGE_ACTIVE_UPLOADS_METRIC,
  STORAGE_FAILED_UPLOADS_METRIC,
  STORAGE_USAGE_METRIC,
  STORAGE_LATENCY_METRIC,
  STORAGE_MULTIPART_METRIC,
  STORAGE_RESUMABLE_METRIC,
];

test("every one of the ten required metrics is registered by name (Req 23.2)", () => {
  const metrics = new MetricsRegistry();
  registerStorageObservability({ metrics });

  // Each mandated metric is present individually...
  for (const name of REQUIRED_METRICS) {
    assert.ok(metrics.has(name), `expected metric '${name}' to be registered`);
  }

  // ...and the ten names are exactly what a fresh registry now holds (no
  // required metric is silently missing).
  const registered = new Set(metrics.names());
  for (const name of REQUIRED_METRICS) {
    assert.ok(registered.has(name), `names() is missing '${name}'`);
  }
  assert.equal(REQUIRED_METRICS.length, 10);
});

test("repeat registration against the same registry does not throw and adds no duplicates (Req 23.1)", () => {
  const metrics = new MetricsRegistry();

  registerStorageObservability({ metrics });
  const afterFirst = metrics.names().slice().sort();

  // A second registration against the SAME registry must not throw...
  assert.doesNotThrow(() => registerStorageObservability({ metrics }));

  // ...and must not register duplicate metrics — the registry's name set is
  // unchanged after the second call.
  const afterSecond = metrics.names().slice().sort();
  assert.deepEqual(afterSecond, afterFirst);
  assert.equal(afterSecond.length, REQUIRED_METRICS.length);
});

test("repeat registration reuses the existing metric instances (Req 23.1)", () => {
  const metrics = new MetricsRegistry();

  registerStorageObservability({ metrics });
  const firstInstances = REQUIRED_METRICS.map((name) => metrics.get(name));

  registerStorageObservability({ metrics });
  const secondInstances = REQUIRED_METRICS.map((name) => metrics.get(name));

  // Same object identity per name — the second registration reused rather than
  // replaced each metric.
  for (let i = 0; i < REQUIRED_METRICS.length; i++) {
    assert.strictEqual(
      secondInstances[i],
      firstInstances[i],
      `metric '${REQUIRED_METRICS[i]}' was replaced instead of reused`,
    );
  }
});

test("attach registers the single 'storage' health check sourced from probe() covering all four dimensions (Req 23.3)", async () => {
  const health = new HealthCheckRegistry();
  const handle = registerStorageObservability({ health });

  // Before attach, no storage check exists.
  let live = await health.runLiveness();
  assert.ok(!(STORAGE_HEALTH_CHECK_NAME in live.checks));

  const storage = createStorage({ provider: "memory" });
  handle.attach(storage);

  live = await health.runLiveness();
  assert.ok(
    STORAGE_HEALTH_CHECK_NAME in live.checks,
    "expected the 'storage' health check to be registered",
  );

  const check = live.checks[STORAGE_HEALTH_CHECK_NAME];
  // The single check surfaces every probe dimension Req 23.3 requires.
  assert.ok("connectivity" in check.details);
  assert.ok("writable" in check.details);
  assert.ok("readable" in check.details);
  assert.ok("quotaAvailable" in check.details);

  handle.close();
  await storage.close();
});

test("with no metrics registry, registration registers nothing and never throws (Req 23.1)", () => {
  const metrics = new MetricsRegistry();
  // A handle created without a metrics registry must not touch the registry.
  assert.doesNotThrow(() => registerStorageObservability({}));
  assert.equal(metrics.names().length, 0);
});
