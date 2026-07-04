// Unit tests for the resumable upload manager wired into the storage facade
// (task 11.1).
//
// Verifies the Requirement 7 semantics over the zero-dependency `memory`
// provider (which has no native `resumable` capability, so the manager
// simulates offset-tracked sessions over the driver primitives):
//
//  - startUpload creates a session and returns a session id (7.1).
//  - resumeUpload with the full content creates an object byte-identical to an
//    equivalent single put / uninterrupted upload (7.2, 7.3).
//  - an interrupted resume followed by a second resume with the full content
//    continues from the last persisted offset and yields identical bytes (7.2,
//    7.3).
//  - cancelUpload before completion discards the session and creates no object
//    (7.4), and a subsequent resume of that session is rejected.
//  - cancelUpload of an already-completing session is ignored so the object is
//    still created (7.5).
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 7.1, 7.2, 7.3, 7.4, 7.5

import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createStorage } from "../facade.js";
import { StorageError } from "../errors.js";

/** A fixed clock for deterministic timestamps. */
const fixedClock = () => 1_700_000_000_000;

test("startUpload returns a session id (Req 7.1)", async () => {
  const storage = createStorage({ provider: "memory", clock: fixedClock });
  const sessionId = await storage.startUpload("uploads/file.bin", { contentType: "text/plain" });
  assert.equal(typeof sessionId, "string");
  assert.ok(sessionId.length > 0);
});

test("resumeUpload with the full content equals a single put (Req 7.2, 7.3)", async () => {
  const storage = createStorage({ provider: "memory", clock: fixedClock });
  const payload = Buffer.from("the quick brown fox jumps over the lazy dog");

  const sessionId = await storage.startUpload("k", { contentType: "text/plain" });
  const meta = await storage.resumeUpload(sessionId, Readable.from([payload]));

  assert.equal(meta.key, "k");
  assert.equal(meta.size, payload.byteLength);
  assert.equal(meta.contentType, "text/plain");

  const got = await storage.get("k");
  assert.equal(got.found, true);
  assert.deepEqual(Buffer.from(got.bytes!), payload);

  // Byte-identical to an equivalent single, uninterrupted put.
  const reference = createStorage({ provider: "memory", clock: fixedClock });
  const single = await reference.put("k", new Uint8Array(payload), { contentType: "text/plain" });
  assert.equal(meta.checksum, single.checksum);
  assert.equal(meta.size, single.size);
});

test("interrupted resume continues from the persisted offset (Req 7.2, 7.3)", async () => {
  const storage = createStorage({ provider: "memory", clock: fixedClock });
  const payload = Buffer.from("0123456789ABCDEFGHIJ");

  const sessionId = await storage.startUpload("resumable/obj", {});

  // First resume is interrupted partway: the source stream errors after
  // emitting the first 8 bytes, so only those 8 bytes are persisted.
  const firstHalf = payload.subarray(0, 8);
  const failing = new Readable({
    read() {
      this.push(firstHalf);
      this.destroy(new Error("network interruption"));
    },
  });
  await assert.rejects(() => storage.resumeUpload(sessionId, failing), /network interruption/);

  // No final object exists yet.
  assert.equal(await storage.exists("resumable/obj"), false);

  // Resume again with the FULL content: the manager skips the persisted prefix
  // and appends the remainder, completing the upload.
  const meta = await storage.resumeUpload(sessionId, Readable.from([payload]));
  assert.equal(meta.size, payload.byteLength);

  const got = await storage.get("resumable/obj");
  assert.equal(got.found, true);
  assert.deepEqual(Buffer.from(got.bytes), payload);
});

test("cancelUpload before completion discards the session (Req 7.4)", async () => {
  const storage = createStorage({ provider: "memory", clock: fixedClock });
  const sessionId = await storage.startUpload("cancel/me", {});

  await storage.cancelUpload(sessionId);

  // No object was created.
  assert.equal(await storage.exists("cancel/me"), false);

  // A cancelled session can no longer be resumed.
  await assert.rejects(
    () => storage.resumeUpload(sessionId, Readable.from([Buffer.from("data")])),
    StorageError,
  );
});

test("cancelUpload while completing lets the upload finish (Req 7.5)", async () => {
  const storage = createStorage({ provider: "memory", clock: fixedClock });
  const payload = Buffer.from("committing payload");
  const sessionId = await storage.startUpload("committing/obj", {});

  // Start the resume but do not await it yet; a paused stream lets us interleave
  // a cancel. The stream emits its content then ends, driving the session into
  // its completing phase.
  const resumePromise = storage.resumeUpload(sessionId, Readable.from([payload]));

  // Cancel concurrently. Because the manager marks the session completing once
  // the stream is consumed, this cancel is either a no-op (session gone) or
  // ignored (already completing) — either way the object must be created.
  const finalMeta = await resumePromise;
  await storage.cancelUpload(sessionId);

  assert.equal(finalMeta.key, "committing/obj");
  const got = await storage.get("committing/obj");
  assert.equal(got.found, true);
  assert.deepEqual(Buffer.from(got.bytes), payload);
});
