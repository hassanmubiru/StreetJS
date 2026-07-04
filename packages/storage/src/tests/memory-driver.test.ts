// Unit tests for the MemoryStorageDriver primitive object operations.
//
// Verifies the mandatory StorageDriver primitives implemented in task 3.1:
// put / get / exists / delete / stat / list, plus consistent not-found
// reporting via the discriminated MaybeObject result. Uses the Node.js built-in
// test runner (node:test) and is executed via `node --test dist/tests/*.test.js`.
//
// The driver is imported from the built driver module (`../drivers/memory.js`)
// because MemoryStorageDriver is not re-exported from the package entry point.
// A fixed Clock is injected so timestamps are deterministic and assertable.
//
// Requirements: 4.1, 4.2, 4.3, 4.4, 4.9, 4.10, 2.4

import test from "node:test";
import assert from "node:assert/strict";

import { MemoryStorageDriver } from "../drivers/memory.js";
import type { GetResult, StorageObjectMetadata } from "../types.js";

/** A fixed clock returning a constant epoch-ms value for deterministic tests. */
const FIXED_NOW = 1_700_000_000_000;
const fixedClock = () => FIXED_NOW;

/** Convenience: build a driver with the injected fixed clock. */
function makeDriver() {
  return new MemoryStorageDriver({ clock: fixedClock });
}

/** Encode a UTF-8 string into a Uint8Array for storage. */
function bytes(str) {
  return new TextEncoder().encode(str);
}

// ── put ──────────────────────────────────────────────────────────────────────

test("put returns metadata with size, checksum, etag, and timestamps", async () => {
  const driver = makeDriver();
  const content = bytes("hello world");

  const meta = await driver.put("greetings/hello.txt", content, {
    contentType: "text/plain",
  });

  assert.equal(meta.key, "greetings/hello.txt");
  assert.equal(meta.size, content.byteLength);
  assert.equal(meta.contentType, "text/plain");
  // checksum/etag are the sha-256 hex digest of the bytes.
  assert.match(meta.checksum, /^[0-9a-f]{64}$/);
  assert.equal(meta.etag, meta.checksum);
  // Deterministic timestamps come from the injected fixed clock.
  assert.equal(meta.createdAt, FIXED_NOW);
  assert.equal(meta.updatedAt, FIXED_NOW);
});

test("put applies default content type and access level when unspecified", async () => {
  const driver = makeDriver();

  const meta = await driver.put("data/blob.bin", bytes("raw"), {});

  assert.equal(meta.contentType, "application/octet-stream");
  assert.equal(meta.accessLevel, "private");
  assert.deepEqual(meta.custom, {});
});

test("put carries owner, tenant, access level, and custom metadata", async () => {
  const driver = makeDriver();

  const meta = await driver.put("tenants/a/file.txt", bytes("x"), {
    owner: "user-1",
    tenant: "tenant-a",
    accessLevel: "public",
    custom: { label: "invoice" },
  });

  assert.equal(meta.owner, "user-1");
  assert.equal(meta.tenant, "tenant-a");
  assert.equal(meta.accessLevel, "public");
  assert.deepEqual(meta.custom, { label: "invoice" });
});

// ── get (round-trip + not-found) ──────────────────────────────────────────────

test("get round-trips the stored bytes exactly and reports found:true", async () => {
  const driver = makeDriver();
  const content = bytes("the quick brown fox");
  await driver.put("docs/fox.txt", content, {});

  const result = await driver.get("docs/fox.txt");

  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, content);
  assert.equal(result.metadata.key, "docs/fox.txt");
  assert.equal(result.metadata.size, content.byteLength);
});

test("get preserves arbitrary binary bytes without mutation", async () => {
  const driver = makeDriver();
  const content = new Uint8Array([0, 255, 1, 254, 127, 128]);
  await driver.put("bin/data", content, {});

  const result = await driver.get("bin/data");

  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, content);
});

test("get on a missing key reports found:false (not an error)", async () => {
  const driver = makeDriver();

  const result = await driver.get("does/not/exist");

  assert.equal(result.found, false);
  assert.equal(result.bytes, undefined);
});

test("get returns a copy so mutating the result never corrupts the store", async () => {
  const driver = makeDriver();
  const content = bytes("immutable");
  await driver.put("safe/key", content, {});

  const first = await driver.get("safe/key");
  first.bytes[0] = 0; // mutate the returned buffer

  const second = await driver.get("safe/key");
  assert.deepEqual(second.bytes, content);
});

// ── exists ─────────────────────────────────────────────────────────────────

test("exists returns true for a stored key and false otherwise", async () => {
  const driver = makeDriver();
  await driver.put("present.txt", bytes("here"), {});

  assert.equal(await driver.exists("present.txt"), true);
  assert.equal(await driver.exists("absent.txt"), false);
});

// ── delete ───────────────────────────────────────────────────────────────────

test("delete removes visibility so a subsequent exists returns false", async () => {
  const driver = makeDriver();
  await driver.put("temp/file.txt", bytes("bye"), {});
  assert.equal(await driver.exists("temp/file.txt"), true);

  await driver.delete("temp/file.txt");

  assert.equal(await driver.exists("temp/file.txt"), false);
  const result = await driver.get("temp/file.txt");
  assert.equal(result.found, false);
});

test("delete on a missing key is a no-op (does not throw)", async () => {
  const driver = makeDriver();

  await assert.doesNotReject(() => driver.delete("never/existed"));
});

// ── stat ─────────────────────────────────────────────────────────────────────

test("stat returns metadata for an existing key without content", async () => {
  const driver = makeDriver();
  const content = bytes("stat me");
  await driver.put("stat/key.txt", content, { contentType: "text/plain" });

  const meta = await driver.stat("stat/key.txt");

  assert.notEqual(meta, null);
  assert.equal(meta.key, "stat/key.txt");
  assert.equal(meta.size, content.byteLength);
  assert.equal(meta.contentType, "text/plain");
  assert.equal(meta.updatedAt, FIXED_NOW);
  // stat carries no bytes field.
  assert.equal(meta.bytes, undefined);
});

test("stat returns null for a missing key", async () => {
  const driver = makeDriver();

  const meta = await driver.stat("no/such/key");

  assert.equal(meta, null);
});

// ── list ─────────────────────────────────────────────────────────────────────

test("list returns keys matching a prefix, sorted", async () => {
  const driver = makeDriver();
  await driver.put("photos/b.png", bytes("b"), {});
  await driver.put("photos/a.png", bytes("a"), {});
  await driver.put("docs/readme.md", bytes("doc"), {});

  const items = await driver.list("photos/");

  assert.deepEqual(
    items.map((item) => item.key),
    ["photos/a.png", "photos/b.png"],
  );
});

test("list with a prefix excludes non-matching keys", async () => {
  const driver = makeDriver();
  await driver.put("a/1", bytes("1"), {});
  await driver.put("a/2", bytes("2"), {});
  await driver.put("b/1", bytes("3"), {});

  const items = await driver.list("a/");

  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.key.startsWith("a/")));
});

test("list with an empty prefix returns every stored key", async () => {
  const driver = makeDriver();
  await driver.put("x", bytes("1"), {});
  await driver.put("y", bytes("2"), {});

  const items = await driver.list("");

  assert.deepEqual(
    items.map((item) => item.key).sort(),
    ["x", "y"],
  );
});

test("list returns an empty array when no key matches the prefix", async () => {
  const driver = makeDriver();
  await driver.put("only/one", bytes("1"), {});

  const items = await driver.list("missing/");

  assert.deepEqual(items, []);
});

test("list items carry size and updatedAt from stored metadata", async () => {
  const driver = makeDriver();
  const content = bytes("sized");
  await driver.put("items/one", content, {});

  const [item] = await driver.list("items/");

  assert.equal(item.key, "items/one");
  assert.equal(item.size, content.byteLength);
  assert.equal(item.updatedAt, FIXED_NOW);
});
