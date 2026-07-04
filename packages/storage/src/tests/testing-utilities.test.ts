// Unit tests for the in-process testing utilities (task 25.1).
//
// Verifies the zero-network test doubles exported from the ./testing submodule:
// MemoryStorage, FakeStorage, StorageHarness (advanceable clock + assertions),
// FakeUpload, and FakeDownload. All run entirely in-process with no external
// service (Requirement 22.2) and sit on the same Storage/StorageDriver contract
// as production code (Requirements 22.1, 22.3).
//
// Imported from the built submodule entry point (`../testing/index.js`) which
// backs the package's `@streetjs/storage/testing` subpath export.
//
// Requirements: 22.1, 22.2, 22.3

import test from "node:test";
import assert from "node:assert/strict";

import {
  MemoryStorage,
  FakeStorage,
  StorageHarness,
  FakeUpload,
  FakeDownload,
  MemoryStorageDriver,
  createAdvanceableClock,
} from "../testing/index.js";

function bytes(str: string) {
  return new TextEncoder().encode(str);
}

test("MemoryStorage returns a working in-memory Storage facade", async () => {
  const storage = MemoryStorage();
  const meta = await storage.put("a.txt", "hello");
  assert.equal(meta.key, "a.txt");
  assert.equal(await storage.exists("a.txt"), true);
  const got = await storage.get("a.txt");
  assert.equal(got.found, true);
  assert.deepEqual(Buffer.from(got.bytes), Buffer.from(bytes("hello")));
});

test("MemoryStorageDriver is re-exported for driver-level substitution", async () => {
  const driver = new MemoryStorageDriver();
  const meta = await driver.put("k", bytes("x"), {});
  assert.equal(meta.size, 1);
  assert.equal(await driver.exists("k"), true);
});

test("createAdvanceableClock advances and sets deterministically", () => {
  const clock = createAdvanceableClock(1000);
  assert.equal(clock(), 1000);
  clock.advance(500);
  assert.equal(clock(), 1500);
  assert.equal(clock.now(), 1500);
  clock.set(42);
  assert.equal(clock(), 42);
});

test("FakeStorage is substitutable for the facade and controls time", async () => {
  const storage = new FakeStorage();
  const meta = await storage.put("doc", "content");
  // Timestamps come from the advanceable clock, not wall time.
  assert.equal(meta.createdAt, storage.clock.now());

  storage.advanceTime(10_000);
  const meta2 = await storage.put("doc", "content-v2");
  assert.equal(meta2.updatedAt, storage.clock.now());
  assert.ok(meta2.updatedAt > meta.createdAt);

  // Full facade surface is present (stats + probe delegate to the real facade).
  const stats = storage.stats();
  assert.equal(typeof stats.uploads, "number");
  const probe = await storage.probe();
  assert.equal(typeof probe.connectivity, "boolean");
  await storage.close();
});

test("StorageHarness assertions pass for matching state", async () => {
  const harness = new StorageHarness();
  await harness.storage.put("k1", "one");
  await harness.storage.put("k2", "two");

  await harness.assertExists("k1");
  await harness.assertMissing("nope");
  await harness.assertContent("k1", "one");
  await harness.assertSize("k2", 3);
  await harness.assertKeys("", ["k1", "k2"]);
  await harness.close();
});

test("StorageHarness assertions fail loudly on mismatch", async () => {
  const harness = new StorageHarness();
  await harness.storage.put("k", "abc");
  await assert.rejects(() => harness.assertContent("k", "xyz"));
  await assert.rejects(() => harness.assertMissing("k"));
});

test("StorageHarness advanceable clock drives object timestamps", async () => {
  const harness = new StorageHarness();
  harness.setTime(5000);
  const meta = await harness.storage.put("t", "v");
  assert.equal(meta.createdAt, 5000);
  harness.advance(2000);
  const meta2 = await harness.storage.put("t", "v2");
  assert.equal(meta2.updatedAt, 7000);
});

test("FakeUpload buffers chunks and persists on complete", async () => {
  const storage = MemoryStorage();
  const upload = new FakeUpload(storage, "big.bin");
  upload.write("part-1;");
  upload.write(bytes("part-2"));
  assert.equal(upload.bytesWritten, "part-1;".length + "part-2".length);
  assert.equal(upload.isCompleted, false);

  const meta = await upload.complete();
  assert.equal(upload.isCompleted, true);
  assert.equal(meta.key, "big.bin");

  const got = await storage.get("big.bin");
  assert.deepEqual(Buffer.from(got.bytes), Buffer.from(bytes("part-1;part-2")));

  assert.throws(() => upload.write("more"));
  await assert.rejects(() => upload.complete());
});

test("FakeUpload abort discards buffered content", async () => {
  const storage = MemoryStorage();
  const upload = new FakeUpload(storage, "gone.bin");
  upload.write("data");
  upload.abort();
  assert.equal(upload.isAborted, true);
  assert.equal(upload.bytesWritten, 0);
  assert.equal(await storage.exists("gone.bin"), false);
  assert.throws(() => upload.write("x"));
  await assert.rejects(() => upload.complete());
});

test("FakeDownload reads bytes, text, and chunks; reports absence", async () => {
  const storage = MemoryStorage();
  await storage.put("read.txt", "hello world");

  const download = new FakeDownload(storage, "read.txt");
  assert.equal(await download.found(), true);
  assert.deepEqual(Buffer.from(await download.bytes()), Buffer.from(bytes("hello world")));
  assert.equal(await download.text(), "hello world");

  const collected = [];
  for await (const chunk of download.chunks(4)) {
    collected.push(Buffer.from(chunk));
  }
  assert.deepEqual(Buffer.concat(collected), Buffer.from(bytes("hello world")));
  // Every non-final chunk respects the requested size bound.
  for (const chunk of collected.slice(0, -1)) {
    assert.equal(chunk.byteLength, 4);
  }

  const missing = new FakeDownload(storage, "absent.txt");
  assert.equal(await missing.found(), false);
  await assert.rejects(() => missing.bytes());
});

test("signed URLs work out of the box on the doubles (no external service)", async () => {
  const storage = new FakeStorage();
  await storage.put("secret", "s");
  const url = await storage.signedUrl("secret", "GET");
  assert.equal(typeof url, "string");
  assert.ok(url.length > 0);
});
