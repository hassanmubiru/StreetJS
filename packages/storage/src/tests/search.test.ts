// Unit tests for search filtering wired into the storage facade (task 18.1).
//
// Verifies the Requirement 16 semantics over the zero-dependency `memory`
// provider, exercised through `storage.search`:
//
//  - Filtering supports prefix, contentType, owner, tenant, size range,
//    updated-time range, and custom metadata (16.1).
//  - Multiple filters combine with AND semantics: only objects satisfying
//    EVERY supplied filter are returned (16.2).
//  - When no object satisfies the filters, an empty result set is returned
//    (16.3).
//  - Reserved internal keys (.versions/ etc.) are excluded from broad searches.
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 16.1, 16.2, 16.3

import test from "node:test";
import assert from "node:assert/strict";

import { createStorage } from "../facade.js";
import { searchObjects } from "../search.js";
import { MemoryStorageDriver } from "../drivers/memory.js";
import type { StorageListItem } from "../types.js";

/** A fixed clock so updatedAt values are deterministic for time-range filters. */
function fixedClock(now: number) {
  return () => now;
}

/** Build a facade backed by a fresh in-memory driver with a fixed clock. */
function makeStorage(now = 1000) {
  const driver = new MemoryStorageDriver({ clock: fixedClock(now) });
  return { storage: createStorage({ provider: "memory", driver }), driver };
}

/** Collect the sorted keys from a list of StorageListItem results. */
function keysOf(items) {
  return items.map((item) => item.key).sort();
}

test("search returns exactly the objects satisfying EVERY supplied filter (16.2)", async () => {
  const { storage } = makeStorage();

  // Two objects share owner "alice"; one also matches the content type and size.
  await storage.put("photos/a.jpg", "aa", { contentType: "image/jpeg", owner: "alice" }); // size 2
  await storage.put("photos/b.png", "bbbbb", { contentType: "image/png", owner: "alice" }); // size 5
  await storage.put("photos/c.jpg", "cccc", { contentType: "image/jpeg", owner: "bob" }); // size 4
  await storage.put("docs/readme.txt", "hello", { contentType: "text/plain", owner: "alice" });

  // Conjunctive filter: prefix AND contentType AND owner AND size range.
  const result = await storage.search({
    prefix: "photos/",
    contentType: "image/jpeg",
    owner: "alice",
    minSize: 1,
    maxSize: 3,
  });

  // Only photos/a.jpg satisfies all four constraints at once.
  assert.deepEqual(keysOf(result), ["photos/a.jpg"]);
});

test("each filter dimension narrows results independently (16.1)", async () => {
  const { storage } = makeStorage(5000);

  await storage.put("t1/x", "a", { owner: "alice", tenant: "acme", contentType: "text/plain" });
  await storage.put("t1/y", "bb", { owner: "bob", tenant: "acme", contentType: "text/plain" });
  await storage.put("t2/z", "ccc", { owner: "alice", tenant: "globex", contentType: "image/png" });

  assert.deepEqual(keysOf(await storage.search({ owner: "alice" })), ["t1/x", "t2/z"]);
  assert.deepEqual(keysOf(await storage.search({ tenant: "acme" })), ["t1/x", "t1/y"]);
  assert.deepEqual(keysOf(await storage.search({ contentType: "image/png" })), ["t2/z"]);
  assert.deepEqual(keysOf(await storage.search({ prefix: "t1/" })), ["t1/x", "t1/y"]);
  // Size range: only the 2-byte and 3-byte objects.
  assert.deepEqual(keysOf(await storage.search({ minSize: 2 })), ["t1/y", "t2/z"]);
});

test("search matches on updated-time range and custom metadata (16.1)", async () => {
  const { storage } = makeStorage(2000);

  await storage.put("k1", "one", { custom: { category: "invoice", region: "eu" } });
  await storage.put("k2", "two", { custom: { category: "receipt", region: "eu" } });

  // Custom metadata filter (AND across supplied custom fields).
  const invoices = await storage.search({ metadata: { category: "invoice" } });
  assert.deepEqual(keysOf(invoices), ["k1"]);

  const euReceipts = await storage.search({ metadata: { category: "receipt", region: "eu" } });
  assert.deepEqual(keysOf(euReceipts), ["k2"]);

  // Time range covering the fixed clock value returns all; a window before it none.
  assert.deepEqual(keysOf(await storage.search({ updatedAfter: 1000, updatedBefore: 3000 })), [
    "k1",
    "k2",
  ]);
  assert.deepEqual(await storage.search({ updatedBefore: 1000 }), []);
});

test("search returns an empty set when no object matches (16.3)", async () => {
  const { storage } = makeStorage();
  await storage.put("photos/a.jpg", "aa", { contentType: "image/jpeg", owner: "alice" });

  // A filter combination no object satisfies.
  assert.deepEqual(await storage.search({ owner: "nobody" }), []);
  assert.deepEqual(await storage.search({ contentType: "image/jpeg", owner: "bob" }), []);
  assert.deepEqual(await storage.search({ minSize: 100 }), []);

  // Searching an empty store also yields an empty set.
  const { storage: empty } = makeStorage();
  assert.deepEqual(await empty.search({}), []);
});

test("search excludes reserved internal keys from broad searches", async () => {
  const { storage, driver } = makeStorage();
  await storage.put("photos/a.jpg", "aa", { owner: "alice" });
  // Simulate framework bookkeeping written directly to the driver.
  await driver.put(".versions/photos/a.jpg/v1", new Uint8Array([1]), {});
  await driver.put(".multipart/upload-1/1", new Uint8Array([2]), {});

  // A broad, unfiltered search surfaces only the user-visible object.
  const all = await storage.search({});
  assert.deepEqual(keysOf(all), ["photos/a.jpg"]);

  // But an explicit search into the reserved space still finds those keys.
  const versions = await searchObjects(driver, { prefix: ".versions/" });
  assert.deepEqual(keysOf(versions), [".versions/photos/a.jpg/v1"]);
});
