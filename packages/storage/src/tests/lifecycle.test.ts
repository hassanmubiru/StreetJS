// Unit tests for the lifecycle engine wired into the storage facade (task
// 15.1).
//
// Verifies the Requirement 13 semantics over the zero-dependency `memory`
// provider (which has no native `lifecycle` capability, so the engine simulates
// rule evaluation over the driver primitives, measuring object age against the
// injected clock):
//
//  - all four rule types are supported (13.1): delete-after-days,
//    archive-after-months, expire-temp-uploads, move-to-cold.
//  - each qualifying object is actioned exactly once — a repeated evaluation
//    produces no further action on already-actioned objects (13.2).
//  - actions are simulated in memory for MemoryStorageDriver (13.3).
//  - age thresholds and optional prefixes scope which objects qualify.
//  - internal bookkeeping keys (e.g. version snapshots) are never actioned by
//    age-based rules.
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 13.1, 13.2, 13.3

import test from "node:test";
import assert from "node:assert/strict";

import { createStorage } from "../facade.js";
import { LifecycleEngine, ARCHIVE_KEY_PREFIX } from "../lifecycle.js";
import { MemoryStorageDriver } from "../drivers/memory.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

/** Build a facade + backing driver sharing a mutable clock for age control. */
function makeStorage() {
  let now = T0;
  const clock = () => now;
  const driver = new MemoryStorageDriver({ clock });
  const storage = createStorage({ provider: "memory", driver, clock });
  return {
    storage,
    driver,
    setTime: (value: number) => {
      now = value;
    },
  };
}

test("delete-after-days deletes aged objects and keeps young ones (Req 13.1)", async () => {
  const { storage, setTime } = makeStorage();

  setTime(T0);
  await storage.put("old", "a");
  setTime(T0 + 10 * DAY);
  await storage.put("young", "b");

  // Evaluate 10 days after the first write: "old" is 10 days old, "young" 0.
  const outcomes = await storage.applyLifecycle({ type: "delete-after-days", days: 5 });

  assert.deepEqual(outcomes, [{ key: "old", action: "deleted" }]);
  assert.equal(await storage.exists("old"), false);
  assert.equal(await storage.exists("young"), true);
});

test("delete-after-days applies exactly once (Req 13.2)", async () => {
  const { storage, setTime } = makeStorage();

  setTime(T0);
  await storage.put("a", "x");
  await storage.put("b", "y");
  setTime(T0 + 30 * DAY);

  const first = await storage.applyLifecycle({ type: "delete-after-days", days: 7 });
  assert.equal(first.length, 2);

  // A second evaluation finds nothing further to delete.
  const second = await storage.applyLifecycle({ type: "delete-after-days", days: 7 });
  assert.deepEqual(second, []);
});

test("delete-after-days honors the optional prefix", async () => {
  const { storage, setTime } = makeStorage();

  setTime(T0);
  await storage.put("logs/one", "x");
  await storage.put("logs/two", "y");
  await storage.put("keep/three", "z");
  setTime(T0 + 30 * DAY);

  const outcomes = await storage.applyLifecycle({
    type: "delete-after-days",
    days: 1,
    prefix: "logs/",
  });

  assert.deepEqual(
    outcomes.map((o) => o.key).sort(),
    ["logs/one", "logs/two"],
  );
  assert.equal(await storage.exists("keep/three"), true);
});

test("archive-after-months relocates aged objects under the archive prefix (Req 13.1)", async () => {
  const { storage, driver, setTime } = makeStorage();

  setTime(T0);
  await storage.put("report", "payload", { contentType: "text/plain" });
  setTime(T0 + 90 * DAY); // ~3 months

  const outcomes = await storage.applyLifecycle({ type: "archive-after-months", months: 2 });

  assert.deepEqual(outcomes, [{ key: "report", action: "archived" }]);
  // The original key no longer resolves; the content is preserved under the
  // reserved archive prefix.
  assert.equal(await storage.exists("report"), false);
  const archived = await driver.get(`${ARCHIVE_KEY_PREFIX}report`);
  assert.equal(archived.found, true);
  assert.equal(Buffer.from(archived.bytes).toString(), "payload");
});

test("archive-after-months applies exactly once (Req 13.2)", async () => {
  const { storage, setTime } = makeStorage();

  setTime(T0);
  await storage.put("report", "payload");
  setTime(T0 + 90 * DAY);

  const first = await storage.applyLifecycle({ type: "archive-after-months", months: 1 });
  assert.equal(first.length, 1);

  const second = await storage.applyLifecycle({ type: "archive-after-months", months: 1 });
  assert.deepEqual(second, []);
});

test("expire-temp-uploads deletes aged transient multipart state (Req 13.1, 13.3)", async () => {
  const { storage, setTime } = makeStorage();

  setTime(T0);
  const uploadId = await storage.createMultipartUpload("big", { contentType: "text/plain" });
  await storage.uploadPart(uploadId, 1, new TextEncoder().encode("part-1"));
  setTime(T0 + 60_000);

  const outcomes = await storage.applyLifecycle({ type: "expire-temp-uploads", afterMs: 30_000 });

  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].action, "expired");
  assert.ok(outcomes[0].key.startsWith(".multipart/"));

  // Exactly once: a second evaluation finds nothing further to expire.
  const second = await storage.applyLifecycle({ type: "expire-temp-uploads", afterMs: 30_000 });
  assert.deepEqual(second, []);
});

test("expire-temp-uploads leaves young transient state untouched", async () => {
  const { storage, setTime } = makeStorage();

  setTime(T0);
  const uploadId = await storage.createMultipartUpload("big", { contentType: "text/plain" });
  await storage.uploadPart(uploadId, 1, new TextEncoder().encode("part-1"));
  setTime(T0 + 5_000);

  const outcomes = await storage.applyLifecycle({ type: "expire-temp-uploads", afterMs: 30_000 });
  assert.deepEqual(outcomes, []);
});

test("move-to-cold relocates aged objects under coldPrefix exactly once (Req 13.1, 13.2)", async () => {
  const { storage, driver, setTime } = makeStorage();

  setTime(T0);
  await storage.put("data/a", "alpha");
  setTime(T0 + 40 * DAY);

  const outcomes = await storage.applyLifecycle({
    type: "move-to-cold",
    afterDays: 30,
    coldPrefix: "cold/",
    prefix: "data/",
  });

  assert.deepEqual(outcomes, [{ key: "data/a", action: "moved" }]);
  assert.equal(await storage.exists("data/a"), false);
  const cold = await driver.get("cold/data/a");
  assert.equal(cold.found, true);
  assert.equal(Buffer.from(cold.bytes).toString(), "alpha");

  // A second evaluation does not move the already-tiered object again.
  const second = await storage.applyLifecycle({
    type: "move-to-cold",
    afterDays: 30,
    coldPrefix: "cold/",
    prefix: "data/",
  });
  assert.deepEqual(second, []);
});

test("age-based rules never action internal version-snapshot keys", async () => {
  // With versioning enabled the overwrite snapshots prior content under the
  // reserved `.versions/` key space. A delete-after-days over the whole key
  // space must action only the real object, never the snapshot.
  const versioned = createStorage({ provider: "memory", versioning: true, clock: () => T0 });
  await versioned.put("k", "v1");
  await versioned.put("k", "v2"); // snapshots prior content under `.versions/`

  assert.equal((await versioned.listVersions("k")).length, 1);

  const outcomes = await versioned.applyLifecycle({ type: "delete-after-days", days: 0 });
  // Only the real object "k" is actioned; the snapshot under `.versions/` is not.
  assert.deepEqual(outcomes, [{ key: "k", action: "deleted" }]);
  assert.equal((await versioned.listVersions("k")).length, 1);
});

test("LifecycleEngine is exported and constructible", () => {
  const engine = new LifecycleEngine({ driver: new MemoryStorageDriver({ clock: () => T0 }) });
  assert.ok(engine instanceof LifecycleEngine);
});
