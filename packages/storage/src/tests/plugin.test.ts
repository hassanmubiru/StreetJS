// src/tests/plugin.test.js
// Unit tests for StoragePlugin load/unload (task 23.2).
//
// These cover the two behaviors the task mandates:
//
//   1. After `onLoad`, the plugin exposes the live Storage facade through its
//      `storage` accessor and that facade is usable (put/get round-trips)
//      (Requirements 20.1, 20.3).
//   2. After `onUnload`, resources are released: the `storage` accessor becomes
//      `undefined`, the facade's `close()` is called (which stops the
//      observability refresh timer), and any declarative `wireBridges` detach
//      functions are invoked (Requirement 20.3).
//
// A minimal SandboxedApp-like stub is passed to the hooks — the plugin ignores
// the app beyond the hook signatures, resolving its metrics/health registries
// from the plugin options instead. Uses the Node.js built-in test runner
// (node:test); executed via `node --test dist/tests/*.test.js`.
//
// Requirements: 20.1, 20.3

import test from "node:test";
import assert from "node:assert/strict";

import { HealthCheckRegistry, MetricsRegistry } from "streetjs";

import {
  StoragePlugin,
  STORAGE_HEALTH_CHECK_NAME,
  STORAGE_UPLOADS_METRIC,
} from "../index.js";

/** A minimal SandboxedApp-like stub: exposes only `use` / `on`. */
function fakeApp() {
  return { use() {}, on() {} };
}

test("onLoad exposes a usable Storage facade via the `storage` accessor (Req 20.1, 20.3)", async () => {
  const plugin = new StoragePlugin({ provider: "memory" });

  // No facade before load.
  assert.equal(plugin.storage, undefined, "no facade before load");

  await plugin.onLoad(fakeApp());

  // The accessor now exposes the live facade.
  const storage = plugin.storage;
  assert.ok(storage, "facade exposed after load");
  if (!storage) throw new Error("unreachable: facade must be defined after load");

  // The exposed facade is actually usable — a put/get round-trips.
  const written = await storage.put("greeting.txt", "hello world");
  assert.equal(written.key, "greeting.txt");

  const read = await storage.get("greeting.txt");
  assert.equal(read.found, true);
  assert.equal(Buffer.from(read.bytes).toString("utf8"), "hello world");

  await plugin.onUnload(fakeApp());
});

test("onUnload releases resources: accessor cleared, close() called, detachers invoked (Req 20.3)", async () => {
  let attached = 0;
  let detached = 0;
  let bridgedStorage;

  const plugin = new StoragePlugin({
    provider: "memory",
    wireBridges: [
      (storage) => {
        attached += 1;
        bridgedStorage = storage;
        // Returning a detach function that MUST be called on unload.
        return () => {
          detached += 1;
        };
      },
      () => {
        attached += 1;
        // A bridge that returns nothing is allowed (no detach registered).
      },
    ],
  });

  await plugin.onLoad(fakeApp());

  assert.equal(attached, 2, "both wireBridges attach fns ran on load");
  assert.equal(bridgedStorage, plugin.storage, "the attach fn received the live facade");
  assert.equal(detached, 0, "detach not called before unload");

  // Spy on the facade's close() so we can assert it is called on unload.
  const facade = plugin.storage;
  assert.ok(facade, "facade exposed after load");
  let closeCalls = 0;
  const originalClose = facade.close.bind(facade);
  facade.close = async () => {
    closeCalls += 1;
    return originalClose();
  };

  await plugin.onUnload(fakeApp());

  // The accessor is cleared, close() ran exactly once, and the returned detach
  // function was invoked.
  assert.equal(plugin.storage, undefined, "facade accessor cleared after unload");
  assert.equal(closeCalls, 1, "facade close() called on unload");
  assert.equal(detached, 1, "the returned detach function was called on unload");
});

test("observability from plugin-option registries loads and unloads cleanly (Req 20.3)", async () => {
  const metrics = new MetricsRegistry();
  const health = new HealthCheckRegistry();

  const plugin = new StoragePlugin({ provider: "memory", metrics, health });

  await plugin.onLoad(fakeApp());

  // Observability wired from the plugin-option registries on load: the storage
  // health check is registered and the storage metrics are present.
  const live = await health.runLiveness();
  assert.ok(
    STORAGE_HEALTH_CHECK_NAME in live.checks,
    "storage health check registered on load",
  );
  assert.equal(metrics.has(STORAGE_UPLOADS_METRIC), true, "storage metrics registered on load");

  // Unload releases cleanly (stops the observability refresh timer) without throwing.
  await assert.doesNotReject(() => plugin.onUnload(fakeApp()));
  assert.equal(plugin.storage, undefined, "facade cleared after unload");
});

test("onLoad is idempotent — a second load reuses the same facade", async () => {
  const plugin = new StoragePlugin({ provider: "memory" });

  await plugin.onLoad(fakeApp());
  const first = plugin.storage;

  await plugin.onLoad(fakeApp());
  assert.equal(plugin.storage, first, "facade identity unchanged on a second onLoad");

  await plugin.onUnload(fakeApp());
});

test("onUnload is a no-op when never loaded", async () => {
  const plugin = new StoragePlugin({ provider: "memory" });
  await assert.doesNotReject(() => plugin.onUnload(fakeApp()));
  assert.equal(plugin.storage, undefined);
});
