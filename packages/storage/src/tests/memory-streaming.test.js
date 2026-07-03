// Unit tests for the streaming primitives of MemoryStorageDriver (task 3.2).
//
// Verifies that `putStream` consumes a Node Readable and stores the assembled
// bytes with the same computed metadata as `put`, that `getStream` returns a
// Node Readable of the stored bytes (emitted intact, not byte-by-byte), that a
// putStream -> getStream round-trip preserves the original bytes, that
// `getStream` throws NotFoundError on a missing key, and that a failing source
// stream rejects putStream and stores nothing. Uses the Node.js built-in test
// runner (node:test) and is executed via `node --test dist/tests/*.test.js`.
//
// Requirements: 5.1, 5.2, 5.5

import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { buffer as streamToBuffer } from "node:stream/consumers";

import { MemoryStorageDriver } from "../drivers/memory.js";
import { NotFoundError } from "../errors.js";

/** A fixed clock returning a constant epoch-ms timestamp for determinism. */
const fixedClock = () => 1_700_000_000_000;

test("putStream stores the streamed bytes and computes metadata like put", async () => {
  const driver = new MemoryStorageDriver({ clock: fixedClock });
  const payload = Buffer.from("hello streaming world");

  // Feed the payload across multiple chunks to exercise assembly.
  const source = Readable.from([
    payload.subarray(0, 5),
    payload.subarray(5, 11),
    payload.subarray(11),
  ]);

  const metadata = await driver.putStream("docs/stream.txt", source, {
    contentType: "text/plain",
  });

  assert.equal(metadata.key, "docs/stream.txt");
  assert.equal(metadata.size, payload.byteLength);
  assert.equal(metadata.contentType, "text/plain");
  assert.equal(metadata.createdAt, 1_700_000_000_000);
  assert.equal(metadata.updatedAt, 1_700_000_000_000);
  assert.ok(metadata.checksum.length > 0);
  assert.equal(metadata.etag, metadata.checksum);

  // Bytes are retrievable via the primitive get() as well.
  const got = await driver.get("docs/stream.txt");
  assert.equal(got.found, true);
  assert.deepEqual(Buffer.from(got.bytes), payload);
});

test("putStream metadata matches an equivalent buffered put", async () => {
  const streamDriver = new MemoryStorageDriver({ clock: fixedClock });
  const putDriver = new MemoryStorageDriver({ clock: fixedClock });
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
});

test("getStream returns a Readable of the stored bytes emitted intact", async () => {
  const driver = new MemoryStorageDriver({ clock: fixedClock });
  const payload = Buffer.from("downloadable content");
  await driver.put("file.bin", new Uint8Array(payload), {});

  const stream = await driver.getStream("file.bin");
  assert.ok(stream instanceof Readable);

  // Collect chunks to confirm the bytes are delivered as binary (not object-mode
  // integers from iterating a Buffer byte-by-byte).
  const chunks = [];
  for await (const chunk of stream) {
    assert.ok(Buffer.isBuffer(chunk) || chunk instanceof Uint8Array);
    chunks.push(Buffer.from(chunk));
  }
  assert.deepEqual(Buffer.concat(chunks), payload);
});

test("putStream -> getStream round-trip preserves the original bytes", async () => {
  const driver = new MemoryStorageDriver({ clock: fixedClock });
  const payload = Buffer.from([0, 1, 2, 3, 255, 254, 128, 42, 7]);

  await driver.putStream("round/trip", Readable.from([payload]), {});
  const out = await streamToBuffer(await driver.getStream("round/trip"));

  assert.deepEqual(out, payload);
});

test("getStream throws NotFoundError for a missing key", async () => {
  const driver = new MemoryStorageDriver({ clock: fixedClock });
  await assert.rejects(() => driver.getStream("missing/key"), NotFoundError);
});

test("putStream rejects and stores nothing when the source stream errors", async () => {
  const driver = new MemoryStorageDriver({ clock: fixedClock });
  const failing = new Readable({
    read() {
      this.destroy(new Error("source failure"));
    },
  });

  await assert.rejects(
    () => driver.putStream("partial/key", failing, {}),
    /source failure/,
  );
  assert.equal(await driver.exists("partial/key"), false);
});
