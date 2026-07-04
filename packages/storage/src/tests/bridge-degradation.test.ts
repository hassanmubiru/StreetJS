// Cross-bridge graceful-degradation unit tests for the storage facade
// (task 21.4).
//
// Tasks 21.1/21.2/21.3 each proved a single bridge degrades gracefully in
// isolation (events-bridge.test.js, queue-bridge.test.js,
// realtime-bridge.test.js). This file adds the focused CROSS-bridge coverage
// that specifically satisfies task 21.4's intent: with the Events, Queue AND
// Realtime bridges wired simultaneously, object and upload operations must
// still succeed whether every bridge is ABSENT or every bridge THROWS, and the
// events published must carry the affected key + metadata.
//
// Covered:
//  - all three bridges absent → put/get/delete/putStream/resumeUpload succeed
//    (17.3, 19.3).
//  - all three bridges throwing simultaneously → the same operations still
//    succeed and return correct results (17.4, 19.3).
//  - with a live (recording) events bridge alongside a throwing queue + throwing
//    realtime bridge, the published events still carry key + metadata; asserted
//    for storage.uploaded (key + full metadata) and storage.deleted (key)
//    (18.2).
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 17.3, 17.4, 18.2, 19.3

import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createStorage } from "../index.js";
import type { StorageEventPayload } from "../index.js";

interface CapturedEvent {
  readonly event: string;
  readonly payload: StorageEventPayload;
}

/** A bridge trio whose every method throws synchronously on use. */
function throwingBridges() {
  return {
    events: {
      publish() {
        throw new Error("events bus down");
      },
    },
    queue: {
      dispatch() {
        throw new Error("queue down");
      },
    },
    realtime: {
      broadcast() {
        throw new Error("realtime down");
      },
    },
  };
}

/** A recording EventsLike double capturing every published (event, payload). */
function recordingEvents() {
  const published = [];
  return {
    published,
    publish(event, payload) {
      published.push({ event, payload });
    },
  };
}

test("with NO bridges configured, object + upload operations all succeed (Req 17.3, 19.3)", async () => {
  const storage = createStorage({ provider: "memory" });

  // Object operations.
  const meta = await storage.put("k", "v");
  assert.equal(meta.key, "k");
  const got = await storage.get("k");
  assert.equal(got.found, true);
  await storage.delete("k");
  assert.equal(await storage.exists("k"), false);

  // Streaming upload.
  const streamed = await storage.putStream("s", Readable.from([Buffer.from("stream-bytes")]));
  assert.equal(streamed.key, "s");
  assert.equal(await storage.exists("s"), true);

  // Resumable upload.
  const sessionId = await storage.startUpload("r");
  const resumed = await storage.resumeUpload(sessionId, Readable.from([Buffer.from("resumed")]));
  assert.equal(resumed.key, "r");
  assert.equal(await storage.exists("r"), true);
});

test("with ALL THREE bridges throwing simultaneously, object operations still succeed (Req 17.4, 19.3)", async () => {
  const storage = createStorage({ provider: "memory", bridges: throwingBridges() });

  // put on a new key succeeds and returns metadata despite every bridge throwing.
  const meta = await storage.put("k", "v", { contentType: "text/plain" });
  assert.equal(meta.key, "k");

  // get returns the stored bytes.
  const got = await storage.get("k");
  assert.equal(got.found, true);

  // put overwriting (storage.updated path) still succeeds.
  const updated = await storage.put("k", "v2");
  assert.equal(updated.key, "k");

  // delete succeeds and removes the object.
  await storage.delete("k");
  assert.equal(await storage.exists("k"), false);
});

test("with ALL THREE bridges throwing simultaneously, streaming + resumable uploads still succeed (Req 17.4, 19.3)", async () => {
  const storage = createStorage({ provider: "memory", bridges: throwingBridges() });

  // putStream broadcasts started/completed through a throwing realtime bridge —
  // the upload must still complete.
  const streamed = await storage.putStream("s", Readable.from([Buffer.from("stream-bytes")]));
  assert.equal(streamed.key, "s");
  assert.equal(await storage.exists("s"), true);

  // resumeUpload likewise broadcasts through the throwing realtime bridge.
  const sessionId = await storage.startUpload("r");
  const resumed = await storage.resumeUpload(sessionId, Readable.from([Buffer.from("resumed")]));
  assert.equal(resumed.key, "r");
  assert.equal(await storage.exists("r"), true);
});

test("published events carry key + metadata even while queue + realtime bridges throw (Req 18.2)", async () => {
  const events = recordingEvents();
  const storage = createStorage({
    provider: "memory",
    bridges: {
      events,
      queue: {
        dispatch() {
          throw new Error("queue down");
        },
      },
      realtime: {
        broadcast() {
          throw new Error("realtime down");
        },
      },
    },
  });

  await storage.put("photo.png", "bytes", { contentType: "image/png" });
  await storage.delete("photo.png");

  assert.deepEqual(
    events.published.map((e) => e.event),
    ["storage.uploaded", "storage.deleted"],
  );

  // storage.uploaded carries the affected key AND the full object metadata.
  const uploaded = events.published[0].payload;
  assert.equal(uploaded.key, "photo.png");
  assert.ok(uploaded.metadata, "uploaded event must carry metadata");
  assert.equal(uploaded.metadata.key, "photo.png");
  assert.equal(uploaded.metadata.contentType, "image/png");

  // storage.deleted carries the affected key.
  const deleted = events.published[1].payload;
  assert.equal(deleted.key, "photo.png");
});
