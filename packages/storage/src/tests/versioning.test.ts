// Unit tests for the versioning manager wired into the storage facade
// (task 14.1).
//
// Verifies the Requirement 12 semantics over the zero-dependency `memory`
// provider (which has no native `versioning` capability, so the manager
// simulates version snapshots over the driver primitives under reserved
// `.versions/<key>/<versionId>` keys):
//
//  - overwriting a versioned key snapshots the prior content; unlimited
//    Versions are retained (12.1).
//  - listVersions returns the retained Version identifiers for a key (12.2).
//  - restoreVersion makes a listed Version's content the current content (12.3).
//  - deleteVersion removes only that Version and retains the rest (12.4).
//  - a versioning-mechanism failure allows the overwrite to proceed WITHOUT
//    creating a Version (12.5).
//  - with versioning disabled no Versions are recorded.
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 12.1, 12.2, 12.3, 12.4, 12.5

import test from "node:test";
import assert from "node:assert/strict";

import { createStorage } from "../facade.js";
import { VersioningManager } from "../versioning.js";
import { MemoryStorageDriver } from "../drivers/memory.js";
import { NotFoundError } from "../errors.js";
import type { StorageDriver } from "../driver.js";

const fixedClock = () => 1_700_000_000_000;

test("overwrite snapshots prior content and retains unlimited Versions (Req 12.1)", async () => {
  const storage = createStorage({ provider: "memory", versioning: true, clock: fixedClock });

  await storage.put("doc", "v1", { contentType: "text/plain" });
  await storage.put("doc", "v2", { contentType: "text/plain" });
  await storage.put("doc", "v3", { contentType: "text/plain" });

  // Three writes → the two overwrites each snapshot the prior content.
  const versions = await storage.listVersions("doc");
  assert.equal(versions.length, 2);

  // Current content is the latest write.
  const got = await storage.get("doc");
  assert.equal(Buffer.from(got.bytes!).toString(), "v3");
});

test("first write to a key creates no Version (Req 12.1)", async () => {
  const storage = createStorage({ provider: "memory", versioning: true, clock: fixedClock });
  await storage.put("fresh", "only");
  assert.deepEqual(await storage.listVersions("fresh"), []);
});

test("listVersions returns retained Version identifiers (Req 12.2)", async () => {
  const storage = createStorage({ provider: "memory", versioning: true, clock: fixedClock });
  await storage.put("k", "a");
  await storage.put("k", "b");

  const versions = await storage.listVersions("k");
  assert.equal(versions.length, 1);
  assert.equal(typeof versions[0].versionId, "string");
  assert.ok(versions[0].versionId.length > 0);
  assert.equal(versions[0].size, Buffer.byteLength("a"));
});

test("restoreVersion makes a Version's content current (Req 12.3)", async () => {
  const storage = createStorage({ provider: "memory", versioning: true, clock: fixedClock });
  await storage.put("k", "original", { contentType: "text/plain" });
  await storage.put("k", "changed", { contentType: "text/plain" });

  const [v1] = await storage.listVersions("k");
  const meta = await storage.restoreVersion("k", v1.versionId);

  assert.equal(meta.key, "k");
  const got = await storage.get("k");
  assert.equal(Buffer.from(got.bytes!).toString(), "original");
});

test("restoreVersion of an unknown Version throws NotFoundError", async () => {
  const storage = createStorage({ provider: "memory", versioning: true, clock: fixedClock });
  await storage.put("k", "x");
  await assert.rejects(() => storage.restoreVersion("k", "nope"), NotFoundError);
});

test("deleteVersion removes only that Version and retains the rest (Req 12.4)", async () => {
  const storage = createStorage({ provider: "memory", versioning: true, clock: fixedClock });
  await storage.put("k", "a");
  await storage.put("k", "b");
  await storage.put("k", "c");

  const versions = await storage.listVersions("k");
  assert.equal(versions.length, 2);

  await storage.deleteVersion("k", versions[0].versionId);

  const remaining = await storage.listVersions("k");
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].versionId, versions[1].versionId);
});

test("versioning failure allows the overwrite to proceed without a Version (Req 12.5)", async () => {
  // A driver whose get() throws simulates a versioning-mechanism failure while
  // snapshotting. The overwrite must still succeed and record no Version.
  const base = new MemoryStorageDriver({ clock: fixedClock });
  let failNextGet = false;
  const flaky: StorageDriver = {
    ...base,
    name: "flaky",
    put: (key, bytes, meta) => base.put(key, bytes, meta),
    get: (key) => {
      if (failNextGet) {
        return Promise.reject(new Error("snapshot storage constraint"));
      }
      return base.get(key);
    },
    exists: (key) => base.exists(key),
    delete: (key) => base.delete(key),
    stat: (key) => base.stat(key),
    list: (prefix, options) => base.list(prefix, options),
    putStream: (key, stream, meta) => base.putStream(key, stream, meta),
    getStream: (key) => base.getStream(key),
  };

  const storage = createStorage({ provider: "custom", driver: flaky, versioning: true });

  await storage.put("k", "v1");
  // Force the snapshot read to fail on the overwrite.
  failNextGet = true;
  const meta = await storage.put("k", "v2");
  failNextGet = false;

  assert.equal(meta.key, "k");
  const got = await storage.get("k");
  assert.equal(Buffer.from(got.bytes!).toString(), "v2");
  // No Version was created because the snapshot failed (listVersions reads
  // succeed again once the flag is cleared).
  assert.deepEqual(await storage.listVersions("k"), []);
});

test("with versioning disabled no Versions are recorded", async () => {
  const storage = createStorage({ provider: "memory", clock: fixedClock });
  await storage.put("k", "a");
  await storage.put("k", "b");
  assert.deepEqual(await storage.listVersions("k"), []);
});

test("VersioningManager is exported and constructible", () => {
  const manager = new VersioningManager(new MemoryStorageDriver({ clock: fixedClock }));
  assert.ok(manager instanceof VersioningManager);
});
