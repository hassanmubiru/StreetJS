// Unit tests for the Directory API wired into the storage facade (task 17.1).
//
// Verifies the Requirement 15 semantics over the zero-dependency `memory`
// provider, exercised through `storage.directory`:
//
//  - mkdir(path) makes the path available as a directory prefix (15.1).
//  - listDirectory(path) returns only the IMMEDIATE children, collapsing
//    deeper keys into a single sub-directory entry (15.2).
//  - removeDirectory(path) removes every object under the prefix (15.3), and is
//    a success no-op returning { removed: false } for an empty/missing prefix
//    (15.6).
//  - walk(path) returns every object key beneath the prefix (15.4).
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6

import test from "node:test";
import assert from "node:assert/strict";

import { createStorage } from "../facade.js";
import type { Storage } from "../facade.js";
import { MemoryStorageDriver } from "../drivers/memory.js";

/** Build a facade backed by a fresh in-memory driver. */
function makeStorage() {
  const driver = new MemoryStorageDriver({});
  return createStorage({ provider: "memory", driver });
}

/** Seed the store with a small hierarchy of objects. */
async function seed(storage: Storage) {
  await storage.put("photos/a.jpg", "a");
  await storage.put("photos/b.jpg", "bb");
  await storage.put("photos/2024/c.jpg", "ccc");
  await storage.put("photos/2024/holidays/d.jpg", "dddd");
  await storage.put("docs/readme.txt", "hello");
}

test("directory getter returns a working, cached DirectoryApi", () => {
  const storage = makeStorage();
  const dir = storage.directory;
  assert.equal(typeof dir.mkdir, "function");
  assert.equal(typeof dir.listDirectory, "function");
  assert.equal(typeof dir.removeDirectory, "function");
  assert.equal(typeof dir.walk, "function");
  // Same instance is reused across accesses (lazily constructed once).
  assert.equal(storage.directory, dir);
});

test("mkdir makes the path available as a directory prefix (15.1)", async () => {
  const storage = makeStorage();
  await storage.directory.mkdir("uploads");

  // The marker key exists so the empty directory is discoverable.
  assert.equal(await storage.exists("uploads/"), true);

  // A freshly-made directory has no child entries yet.
  const listing = await storage.directory.listDirectory("uploads");
  assert.deepEqual(listing, []);
});

test("mkdir on the root/empty path is a no-op (15.1)", async () => {
  const storage = makeStorage();
  await storage.directory.mkdir("");
  await storage.directory.mkdir("/");
  // No marker keys were written for the root.
  const keys = await storage.directory.walk("");
  assert.deepEqual(keys, []);
});

test("listDirectory returns only immediate children (15.2)", async () => {
  const storage = makeStorage();
  await seed(storage);

  const listing = await storage.directory.listDirectory("photos");
  const keys = listing.map((item) => item.key).sort();

  // Immediate children of photos/: two files and one sub-directory entry;
  // deeper keys (photos/2024/holidays/...) collapse into photos/2024/.
  assert.deepEqual(keys, ["photos/2024/", "photos/a.jpg", "photos/b.jpg"]);

  // The sub-directory entry is synthesized with size 0.
  const subdir = listing.find((item) => item.key === "photos/2024/");
  assert.equal(subdir.size, 0);

  // File entries carry their real byte sizes.
  const fileA = listing.find((item) => item.key === "photos/a.jpg");
  assert.equal(fileA.size, 1);
  const fileB = listing.find((item) => item.key === "photos/b.jpg");
  assert.equal(fileB.size, 2);
});

test("listDirectory accepts leading/trailing delimiters equivalently (15.2)", async () => {
  const storage = makeStorage();
  await seed(storage);

  const a = (await storage.directory.listDirectory("photos")).map((i) => i.key).sort();
  const b = (await storage.directory.listDirectory("/photos/")).map((i) => i.key).sort();
  assert.deepEqual(a, b);
});

test("walk returns every object key beneath the prefix (15.4)", async () => {
  const storage = makeStorage();
  await seed(storage);

  const keys = (await storage.directory.walk("photos")).sort();
  assert.deepEqual(keys, [
    "photos/2024/c.jpg",
    "photos/2024/holidays/d.jpg",
    "photos/a.jpg",
    "photos/b.jpg",
  ]);

  // walk excludes the directory's own marker key.
  await storage.directory.mkdir("photos");
  const withMarker = (await storage.directory.walk("photos")).sort();
  assert.equal(withMarker.includes("photos/"), false);
});

test("removeDirectory removes every object under the prefix (15.3)", async () => {
  const storage = makeStorage();
  await seed(storage);

  const result = await storage.directory.removeDirectory("photos");
  assert.deepEqual(result, { removed: true });

  // Nothing remains beneath photos/.
  assert.deepEqual(await storage.directory.walk("photos"), []);
  assert.equal(await storage.exists("photos/a.jpg"), false);
  assert.equal(await storage.exists("photos/2024/holidays/d.jpg"), false);

  // Sibling directories are untouched.
  assert.equal(await storage.exists("docs/readme.txt"), true);
});

test("removeDirectory of an empty/missing prefix is a success no-op (15.6)", async () => {
  const storage = makeStorage();
  await seed(storage);

  // Missing prefix: no objects removed, success result, siblings intact.
  const missing = await storage.directory.removeDirectory("does-not-exist");
  assert.deepEqual(missing, { removed: false });
  assert.equal(await storage.exists("docs/readme.txt"), true);

  // Removing twice: second call finds nothing and reports removed: false.
  await storage.directory.removeDirectory("docs");
  const second = await storage.directory.removeDirectory("docs");
  assert.deepEqual(second, { removed: false });
});
