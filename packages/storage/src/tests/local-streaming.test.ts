// Unit tests for the streaming primitives of LocalStorageDriver (task 4.2).
//
// Verifies that `putStream` streams a Node Readable to disk at `root/<key>`
// (creating parent dirs) while computing checksum/etag/size, that the resulting
// metadata matches an equivalent buffered `put`, that an overwrite preserves the
// original `createdAt` while advancing `updatedAt`, that `getStream` returns a
// Node Readable of the stored bytes and a putStream -> getStream round-trip
// preserves the original bytes, that `getStream` throws NotFoundError on a
// missing key, and that a failing source stream rejects putStream and leaves no
// visible object. Uses the Node.js built-in test runner (node:test) and is
// executed via `node --test dist/tests/*.test.js`.
//
// Requirements: 5.1, 5.2, 5.3, 5.5

import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { buffer as streamToBuffer } from "node:stream/consumers";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { LocalStorageDriver } from "../drivers/local.js";
import { NotFoundError } from "../errors.js";

/** Create a fresh temp directory to serve as the driver root. */
async function tempRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "streetjs-storage-local-stream-"));
}

/** A fixed clock returning a constant epoch-ms timestamp for determinism. */
const fixedClock = () => 1_700_000_000_000;

test("putStream streams bytes to disk and computes metadata like put", async () => {
  const root = await tempRoot();
  const driver = new LocalStorageDriver({ root, clock: fixedClock });
  const payload = Buffer.from("hello local streaming world");

  // Feed the payload across multiple chunks to exercise incremental hashing.
  const source = Readable.from([
    payload.subarray(0, 6),
    payload.subarray(6, 15),
    payload.subarray(15),
  ]);

  const metadata = await driver.putStream("docs/stream.txt", source, {
    contentType: "text/plain",
  });

  assert.equal(metadata.key, "docs/stream.txt");
  assert.equal(metadata.size, payload.byteLength);
  assert.equal(metadata.contentType, "text/plain");
  assert.equal(metadata.createdAt, fixedClock());
  assert.equal(metadata.updatedAt, fixedClock());

  // The bytes were actually written to root/<key> on disk.
  const onDisk = await fs.readFile(path.join(root, "docs/stream.txt"));
  assert.deepEqual(onDisk, payload);

  await fs.rm(root, { recursive: true, force: true });
});

test("putStream metadata matches an equivalent buffered put", async () => {
  const rootA = await tempRoot();
  const rootB = await tempRoot();
  const streamDriver = new LocalStorageDriver({ root: rootA, clock: fixedClock });
  const putDriver = new LocalStorageDriver({ root: rootB, clock: fixedClock });
  const payload = Buffer.from("consistency across write paths");

  const viaStream = await streamDriver.putStream(
    "k",
    Readable.from([payload]),
    { contentType: "application/octet-stream" },
  );
  const viaPut = await putDriver.put("k", new Uint8Array(payload), {
    contentType: "application/octet-stream",
  });

  assert.equal(viaStream.size, viaPut.size);
  assert.equal(viaStream.checksum, viaPut.checksum);
  assert.equal(viaStream.etag, viaPut.etag);

  await fs.rm(rootA, { recursive: true, force: true });
  await fs.rm(rootB, { recursive: true, force: true });
});

test("putStream overwrite preserves the original createdAt", async () => {
  const root = await tempRoot();
  let nowValue = 1_700_000_000_000;
  const driver = new LocalStorageDriver({ root, clock: () => nowValue });

  const first = await driver.putStream("over/write", Readable.from([Buffer.from("v1")]), {});
  nowValue = 1_700_000_005_000;
  const second = await driver.putStream("over/write", Readable.from([Buffer.from("v2 longer")]), {});

  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.updatedAt, nowValue);
  assert.ok(second.updatedAt > second.createdAt);

  await fs.rm(root, { recursive: true, force: true });
});

test("getStream returns a Readable of the stored bytes emitted intact", async () => {
  const root = await tempRoot();
  const driver = new LocalStorageDriver({ root, clock: fixedClock });
  const payload = Buffer.from("downloadable content");
  await driver.put("file.bin", new Uint8Array(payload), {});

  const stream = await driver.getStream("file.bin");
  assert.ok(stream instanceof Readable);
  const out = await streamToBuffer(stream);
  assert.deepEqual(out, payload);

  await fs.rm(root, { recursive: true, force: true });
});

test("putStream -> getStream round-trip preserves the original bytes", async () => {
  const root = await tempRoot();
  const driver = new LocalStorageDriver({ root, clock: fixedClock });
  const payload = Buffer.from([0, 1, 2, 3, 255, 254, 128, 42, 7]);

  await driver.putStream("round/trip", Readable.from([payload]), {});
  const out = await streamToBuffer(await driver.getStream("round/trip"));

  assert.deepEqual(out, payload);

  await fs.rm(root, { recursive: true, force: true });
});

test("getStream throws NotFoundError for a missing key", async () => {
  const root = await tempRoot();
  const driver = new LocalStorageDriver({ root, clock: fixedClock });

  await assert.rejects(() => driver.getStream("missing/key"), NotFoundError);

  await fs.rm(root, { recursive: true, force: true });
});

test("putStream rejects and leaves no visible object when the source errors", async () => {
  const root = await tempRoot();
  const driver = new LocalStorageDriver({ root, clock: fixedClock });
  const failing = new Readable({
    read() {
      this.destroy(new Error("source failure"));
    },
  });

  await assert.rejects(
    () => driver.putStream("partial/key", failing, {}),
    /source failure/,
  );

  // No metadata sidecar was written, so the object is not visible.
  assert.equal(await driver.stat("partial/key"), null);
  const result = await driver.get("partial/key");
  assert.equal(result.found, false);

  await fs.rm(root, { recursive: true, force: true });
});
