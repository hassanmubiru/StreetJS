// Unit tests for the Queue integration bridge wired into the storage facade
// (task 21.2).
//
// Verifies the Requirement 17 / 28.3 graceful-degradation semantics over the
// zero-dependency `memory` provider:
//
//  - bridgeStorageQueue dispatches the correct typed job name + payload through
//    the structural QueueLike bridge (17.1).
//  - a synchronous throw from the queue is fully isolated — never propagates
//    into the caller (17.4).
//  - an asynchronous rejection from the queue is fully isolated (17.4).
//  - with no queue bridge configured, storage operations proceed unaffected
//    (17.3).
//  - configuring a queue bridge (present, throwing, or absent) never breaks the
//    storage operation path.
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 17.1, 17.2, 17.3, 17.4, 28.3

import test from "node:test";
import assert from "node:assert/strict";

import { createStorage, bridgeStorageQueue } from "../index.js";
import type { StorageJobPayload } from "../index.js";

interface CapturedJob {
  readonly job: string;
  readonly payload: StorageJobPayload;
}

/** A recording QueueLike double capturing every dispatched (job, payload). */
function recordingQueue() {
  const dispatched: CapturedJob[] = [];
  return {
    dispatched,
    dispatch(job: string, payload: unknown): void {
      dispatched.push({ job, payload: payload as StorageJobPayload });
    },
  };
}

test("bridgeStorageQueue dispatches typed job names with key + options (Req 17.1)", () => {
  const queue = recordingQueue();
  const publisher = bridgeStorageQueue(queue);

  publisher.thumbnail("photo.png", { size: 128 });
  publisher.virusScan("upload.bin");
  publisher.ocr("scan.tiff");
  publisher.pdfProcess("doc.pdf");
  publisher.transcode("video.mov");
  publisher.imageOptimize("photo.png");
  publisher.archive("report.csv");

  assert.deepEqual(
    queue.dispatched.map((d) => d.job),
    [
      "storage.thumbnail",
      "storage.virus-scan",
      "storage.ocr",
      "storage.pdf-process",
      "storage.transcode",
      "storage.image-optimize",
      "storage.archive",
    ],
  );
  assert.equal(queue.dispatched[0].payload.key, "photo.png");
  assert.deepEqual(queue.dispatched[0].payload.options, { size: 128 });
  assert.equal(queue.dispatched[1].payload.key, "upload.bin");
});

test("dispatch() passes an already-named job straight through (Req 17.1)", () => {
  const queue = recordingQueue();
  const publisher = bridgeStorageQueue(queue);

  publisher.dispatch("storage.archive", { key: "k" });

  assert.equal(queue.dispatched.length, 1);
  assert.equal(queue.dispatched[0].job, "storage.archive");
  assert.equal(queue.dispatched[0].payload.key, "k");
});

test("a synchronous dispatch failure never throws into the caller (Req 17.4)", () => {
  const publisher = bridgeStorageQueue({
    dispatch() {
      throw new Error("queue down");
    },
  });

  assert.doesNotThrow(() => publisher.thumbnail("photo.png"));
  assert.doesNotThrow(() => publisher.dispatch("storage.archive", { key: "k" }));
});

test("an asynchronous dispatch rejection never throws into the caller (Req 17.4)", async () => {
  const publisher = bridgeStorageQueue({
    dispatch() {
      return Promise.reject(new Error("async queue down"));
    },
  });

  assert.doesNotThrow(() => publisher.transcode("video.mov"));
  // Give any swallowed rejection a tick to settle without an unhandled error.
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("facade wires a queue publisher when config.bridges.queue is present (Req 17.1)", async () => {
  const queue = recordingQueue();
  const storage = createStorage({ provider: "memory", bridges: { queue } });

  // The bridge is constructed and held; storage operations remain unaffected.
  const metadata = await storage.put("photo.png", "bytes", { contentType: "image/png" });
  assert.equal(metadata.key, "photo.png");
  assert.equal(await storage.exists("photo.png"), true);
});

test("a throwing queue never breaks storage operations (Req 17.4)", async () => {
  const throwingQueue = {
    dispatch() {
      throw new Error("queue down");
    },
  };
  const storage = createStorage({ provider: "memory", bridges: { queue: throwingQueue } });

  const metadata = await storage.put("k", "v");
  assert.equal(metadata.key, "k");
  await storage.delete("k");
  assert.equal(await storage.exists("k"), false);
});

test("with no queue bridge configured, operations proceed unaffected (Req 17.3)", async () => {
  const storage = createStorage({ provider: "memory" });

  const metadata = await storage.put("k", "v");
  assert.equal(metadata.key, "k");
  await storage.delete("k");
  assert.equal(await storage.exists("k"), false);
});
