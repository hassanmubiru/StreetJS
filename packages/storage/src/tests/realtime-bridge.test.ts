// Unit tests for the Realtime integration bridge wired into the storage facade
// (task 21.3).
//
// Verifies the Requirement 19 / 28.3 graceful-degradation semantics over the
// zero-dependency `memory` provider:
//
//  - bridgeStorageRealtime broadcasts the correct typed upload event name +
//    payload on the storage upload channel through the structural RealtimeLike
//    bridge (19.1).
//  - a synchronous throw from the realtime layer is fully isolated — never
//    propagates into the caller (19.3).
//  - an asynchronous rejection from the realtime layer is fully isolated (19.3).
//  - with no realtime bridge configured, uploads proceed unaffected (19.3).
//  - a throwing realtime bridge never breaks the streaming/resumable upload path
//    (19.3).
//  - putStream broadcasts upload.started then upload.completed (19.1).
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 19.1, 19.2, 19.3, 28.3

import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { createStorage, bridgeStorageRealtime, STORAGE_UPLOAD_CHANNEL } from "../index.js";
import type { StorageRealtimeEventPayload } from "../index.js";

interface CapturedBroadcast {
  readonly channel: string;
  readonly event: string;
  readonly payload: StorageRealtimeEventPayload;
}

/** A recording RealtimeLike double capturing every broadcast (channel, event, payload). */
function recordingRealtime() {
  const broadcasts: CapturedBroadcast[] = [];
  return {
    broadcasts,
    broadcast(channel: string, event: string, payload: unknown): void {
      broadcasts.push({ channel, event, payload: payload as StorageRealtimeEventPayload });
    },
  };
}

test("bridgeStorageRealtime broadcasts typed upload events on the upload channel (Req 19.1)", () => {
  const realtime = recordingRealtime();
  const publisher = bridgeStorageRealtime(realtime);

  publisher.started("video.mp4");
  publisher.progress("video.mp4", 512, 1024);
  publisher.completed("video.mp4");
  publisher.failed("video.mp4", "boom");

  assert.deepEqual(
    realtime.broadcasts.map((b) => b.event),
    ["upload.started", "upload.progress", "upload.completed", "upload.failed"],
  );
  // All broadcasts go out on the single upload channel.
  for (const b of realtime.broadcasts) {
    assert.equal(b.channel, STORAGE_UPLOAD_CHANNEL);
    assert.equal(b.payload.key, "video.mp4");
  }
  assert.equal(realtime.broadcasts[1].payload.bytesTransferred, 512);
  assert.equal(realtime.broadcasts[1].payload.totalBytes, 1024);
  assert.equal(realtime.broadcasts[3].payload.error, "boom");
});

test("broadcast() passes an already-named event straight through (Req 19.1)", () => {
  const realtime = recordingRealtime();
  const publisher = bridgeStorageRealtime(realtime);

  publisher.broadcast("upload.completed", { key: "k" });

  assert.equal(realtime.broadcasts.length, 1);
  assert.equal(realtime.broadcasts[0].event, "upload.completed");
  assert.equal(realtime.broadcasts[0].payload.key, "k");
});

test("a synchronous broadcast failure never throws into the caller (Req 19.3)", () => {
  const publisher = bridgeStorageRealtime({
    broadcast() {
      throw new Error("realtime down");
    },
  });

  assert.doesNotThrow(() => publisher.started("k"));
  assert.doesNotThrow(() => publisher.completed("k"));
  assert.doesNotThrow(() => publisher.broadcast("upload.failed", { key: "k" }));
});

test("an asynchronous broadcast rejection never throws into the caller (Req 19.3)", async () => {
  const publisher = bridgeStorageRealtime({
    broadcast() {
      return Promise.reject(new Error("async realtime down"));
    },
  });

  assert.doesNotThrow(() => publisher.progress("k", 1, 2));
  // Give any swallowed rejection a tick to settle without an unhandled error.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("facade broadcasts upload.started then upload.completed on putStream (Req 19.1)", async () => {
  const realtime = recordingRealtime();
  const storage = createStorage({ provider: "memory", bridges: { realtime } });

  await storage.putStream("big.bin", Readable.from([Buffer.from("hello world")]));

  assert.deepEqual(
    realtime.broadcasts.map((b) => b.event),
    ["upload.started", "upload.completed"],
  );
  assert.equal(realtime.broadcasts[0].payload.key, "big.bin");
  assert.equal(await storage.exists("big.bin"), true);
});

test("a throwing realtime bridge never breaks the upload path (Req 19.3)", async () => {
  const throwingRealtime = {
    broadcast() {
      throw new Error("realtime down");
    },
  };
  const storage = createStorage({ provider: "memory", bridges: { realtime: throwingRealtime } });

  const metadata = await storage.putStream("k", Readable.from([Buffer.from("data")]));
  assert.equal(metadata.key, "k");
  assert.equal(await storage.exists("k"), true);
});

test("with no realtime bridge configured, uploads proceed unaffected (Req 19.3)", async () => {
  const storage = createStorage({ provider: "memory" });

  const metadata = await storage.putStream("k", Readable.from([Buffer.from("data")]));
  assert.equal(metadata.key, "k");
  assert.equal(await storage.exists("k"), true);
});
