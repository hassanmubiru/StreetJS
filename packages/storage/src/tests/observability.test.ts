// Unit + integration tests for the storage observability wiring (task 22.1).
//
// Verifies the Requirement 23 semantics over the zero-dependency `memory`
// provider and the real core MetricsRegistry / HealthCheckRegistry:
//
//  - the facade tracks live stats (uploads/downloads/bytes/active/failed/usage/
//    multipart/resumable) surfaced by `storage.stats()` (23.2);
//  - `storage.probe()` delegates to the driver's probe or returns a sensible
//    default when the driver has no probe (23.3);
//  - registerStorageObservability registers metrics idempotently against the
//    existing MetricsRegistry (23.1, 23.2, 23.4) and a health check against the
//    existing HealthCheckRegistry sourced from probe() (23.3);
//  - configuring config.metrics/config.health wires observability on the facade
//    and drives the counters/gauges as operations occur.
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 23.1, 23.2, 23.3, 23.4

import test from "node:test";
import assert from "node:assert/strict";

import { HealthCheckRegistry, MetricsRegistry, Counter, Gauge, Histogram } from "streetjs";

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
import type { StorageObservabilityHandle } from "../index.js";
import type { StorageDriver } from "../driver.js";

test("stats() starts zeroed and is available without any registry (Req 23.2)", async () => {
  const storage = createStorage({ provider: "memory" });
  assert.deepEqual(storage.stats(), {
    uploads: 0,
    downloads: 0,
    bytesUploaded: 0,
    bytesDownloaded: 0,
    activeUploads: 0,
    failedUploads: 0,
    storageUsage: 0,
    multipartUploads: 0,
    resumableSessions: 0,
  });
});

test("put/get advance uploads/downloads and byte counters (Req 23.2)", async () => {
  const storage = createStorage({ provider: "memory" });

  await storage.put("a.txt", "hello"); // 5 bytes
  await storage.put("b.txt", "worldd"); // 6 bytes
  const got = await storage.get("a.txt");
  assert.equal(got.found, true);

  const stats = storage.stats();
  assert.equal(stats.uploads, 2);
  assert.equal(stats.bytesUploaded, 11);
  assert.equal(stats.storageUsage, 11);
  assert.equal(stats.downloads, 1);
  assert.equal(stats.bytesDownloaded, 5);
  assert.equal(stats.failedUploads, 0);
});

test("a failed upload (rejected by validation) increments failedUploads (Req 23.2)", async () => {
  const storage = createStorage({
    provider: "memory",
    validation: { maxSize: 3 },
  });

  await assert.rejects(() => storage.put("big.txt", "too-large"));
  const stats = storage.stats();
  assert.equal(stats.failedUploads, 1);
  assert.equal(stats.uploads, 0);
});

test("multipart and resumable operations advance their counters (Req 23.2)", async () => {
  const storage = createStorage({ provider: "memory" });

  await storage.createMultipartUpload("m1");
  await storage.createMultipartUpload("m2");
  await storage.startUpload("r1");

  const stats = storage.stats();
  assert.equal(stats.multipartUploads, 2);
  assert.equal(stats.resumableSessions, 1);
});

test("activeUploads returns to zero after a stream upload completes (Req 23.2)", async () => {
  const storage = createStorage({ provider: "memory" });
  const { Readable } = await import("node:stream");

  await storage.putStream("s.txt", Readable.from([Buffer.from("streamed")]));

  const stats = storage.stats();
  assert.equal(stats.activeUploads, 0);
  assert.equal(stats.uploads, 1);
  assert.equal(stats.bytesUploaded, 8);
});

test("probe() returns an all-available default when the driver has no probe (Req 23.3)", async () => {
  const storage = createStorage({ provider: "memory" });
  const probe = await storage.probe();
  assert.deepEqual(probe, {
    connectivity: true,
    writable: true,
    readable: true,
    quotaAvailable: true,
  });
});

test("probe() delegates to the driver's probe when present (Req 23.3)", async () => {
  const driverProbe = {
    connectivity: true,
    writable: false,
    readable: true,
    quotaAvailable: true,
  };
  // A minimal driver implementing the mandatory primitives + probe.
  const driver = {
    name: "fake",
    async put() {
      return {
        key: "k",
        size: 0,
        contentType: "application/octet-stream",
        etag: "e",
        checksum: "c",
        accessLevel: "private",
        createdAt: 0,
        updatedAt: 0,
        custom: {},
      };
    },
    async get() {
      return { found: false };
    },
    async exists() {
      return false;
    },
    async delete() {},
    async stat() {
      return null;
    },
    async list() {
      return [];
    },
    async putStream() {
      throw new Error("unused");
    },
    async getStream() {
      throw new Error("unused");
    },
    async probe() {
      return driverProbe;
    },
  };
  const storage = createStorage({ provider: "fake", driver });
  assert.deepEqual(await storage.probe(), driverProbe);
});

test("config.metrics registers all storage metrics of the correct kind and reflects live counts (Req 23.1, 23.2)", async () => {
  const metrics = new MetricsRegistry();
  const storage = createStorage({ provider: "memory", metrics });

  // All metrics registered with the correct kind.
  assert.ok(metrics.get(STORAGE_UPLOADS_METRIC) instanceof Counter);
  assert.ok(metrics.get(STORAGE_DOWNLOADS_METRIC) instanceof Counter);
  assert.ok(metrics.get(STORAGE_BYTES_UPLOADED_METRIC) instanceof Counter);
  assert.ok(metrics.get(STORAGE_BYTES_DOWNLOADED_METRIC) instanceof Counter);
  assert.ok(metrics.get(STORAGE_FAILED_UPLOADS_METRIC) instanceof Counter);
  assert.ok(metrics.get(STORAGE_MULTIPART_METRIC) instanceof Counter);
  assert.ok(metrics.get(STORAGE_RESUMABLE_METRIC) instanceof Counter);
  assert.ok(metrics.get(STORAGE_ACTIVE_UPLOADS_METRIC) instanceof Gauge);
  assert.ok(metrics.get(STORAGE_USAGE_METRIC) instanceof Gauge);
  assert.ok(metrics.get(STORAGE_LATENCY_METRIC) instanceof Histogram);

  await storage.put("a.txt", "hello"); // 5 bytes
  await storage.get("a.txt");

  assert.match(metrics.get(STORAGE_UPLOADS_METRIC)!.render(), /storage_uploads_total 1/);
  assert.match(metrics.get(STORAGE_DOWNLOADS_METRIC)!.render(), /storage_downloads_total 1/);
  assert.match(
    metrics.get(STORAGE_BYTES_UPLOADED_METRIC)!.render(),
    /storage_bytes_uploaded_total 5/,
  );
  assert.match(
    metrics.get(STORAGE_BYTES_DOWNLOADED_METRIC)!.render(),
    /storage_bytes_downloaded_total 5/,
  );
  assert.match(metrics.get(STORAGE_USAGE_METRIC)!.render(), /storage_usage_bytes 5/);
  assert.match(metrics.get(STORAGE_LATENCY_METRIC)!.render(), /storage_operation_latency_seconds_count 2/);

  await storage.close();
});

test("config.health registers the storage health check reporting up over the memory driver (Req 23.3)", async () => {
  const health = new HealthCheckRegistry();
  const storage = createStorage({ provider: "memory", health });

  const live = await health.runLiveness();
  assert.ok(STORAGE_HEALTH_CHECK_NAME in live.checks);
  const check = live.checks[STORAGE_HEALTH_CHECK_NAME];
  assert.equal(check.status, "up");
  assert.equal(check.details.connectivity, true);
  assert.equal(check.details.writable, true);
  assert.equal(check.details.readable, true);
  assert.equal(check.details.quotaAvailable, true);

  await storage.close();
});

test("the health check reports down when the driver probe reports a failing dimension (Req 23.3)", async () => {
  const health = new HealthCheckRegistry();
  const driver = {
    name: "fake",
    async put() {
      throw new Error("unused");
    },
    async get() {
      return { found: false };
    },
    async exists() {
      return false;
    },
    async delete() {},
    async stat() {
      return null;
    },
    async list() {
      return [];
    },
    async putStream() {
      throw new Error("unused");
    },
    async getStream() {
      throw new Error("unused");
    },
    async probe() {
      return { connectivity: true, writable: false, readable: true, quotaAvailable: true };
    },
  };
  const storage = createStorage({ provider: "fake", driver, health });

  const live = await health.runLiveness();
  assert.equal(live.checks[STORAGE_HEALTH_CHECK_NAME].status, "down");
  assert.equal(live.checks[STORAGE_HEALTH_CHECK_NAME].details.writable, false);

  await storage.close();
});

test("registration is idempotent against a shared registry (Req 23.1)", async () => {
  const metrics = new MetricsRegistry();
  const first = registerStorageObservability({ metrics });
  // A second registration against the same registry must not throw.
  let second;
  assert.doesNotThrow(() => {
    second = registerStorageObservability({ metrics });
  });

  const storage = createStorage({ provider: "memory", metrics });
  first.attach(storage);
  second.attach(storage);
  await storage.put("k", "v");

  assert.doesNotThrow(() => {
    first.refresh();
    second.refresh();
    metrics.collect();
  });

  first.close();
  second.close();
  await storage.close();
});

test("with no registries, operations proceed and telemetry is a complete no-op (Req 23.4)", async () => {
  const storage = createStorage({ provider: "memory" });
  const metadata = await storage.put("k", "v");
  assert.equal(metadata.key, "k");
  assert.equal(storage.stats().uploads, 1);
  await storage.close();
});
