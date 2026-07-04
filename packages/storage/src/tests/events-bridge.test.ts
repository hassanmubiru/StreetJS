// Unit tests for the Events integration bridge wired into the storage facade
// (task 21.1).
//
// Verifies the Requirement 18 / 13.4 semantics over the zero-dependency
// `memory` provider:
//
//  - object mutations publish the corresponding typed event through the
//    structural EventsLike bridge: put(new) → storage.uploaded, put(existing) →
//    storage.updated, delete → storage.deleted, move/rename → storage.moved,
//    restoreVersion → storage.restored (18.1).
//  - each payload carries the affected key and (when available) metadata (18.2).
//  - applied lifecycle actions publish through the same bridge (13.4).
//  - a failing events layer never throws into the storage operation path.
//  - with no events bridge configured, publication is a complete no-op.
//  - bridgeStorageEvents is a standalone, never-throwing publisher.
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 13.4, 18.1, 18.2, 18.3, 28.3

import test from "node:test";
import assert from "node:assert/strict";

import { createStorage, bridgeStorageEvents } from "../index.js";
import type { StorageEventPayload, StorageObjectMetadata } from "../index.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_700_000_000_000;

interface CapturedEvent {
  readonly event: string;
  readonly payload: StorageEventPayload;
}

/** A recording EventsLike double capturing every published (event, payload). */
function recordingEvents() {
  const published: CapturedEvent[] = [];
  return {
    published,
    publish(event: string, payload: unknown): void {
      published.push({ event, payload: payload as StorageEventPayload });
    },
  };
}

test("put on a new key publishes storage.uploaded with key + metadata (Req 18.1, 18.2)", async () => {
  const events = recordingEvents();
  const storage = createStorage({ provider: "memory", bridges: { events } });

  await storage.put("photo.png", "bytes", { contentType: "image/png" });

  assert.equal(events.published.length, 1);
  const { event, payload } = events.published[0];
  assert.equal(event, "storage.uploaded");
  assert.equal(payload.key, "photo.png");
  assert.ok(payload.metadata);
  assert.equal(payload.metadata.key, "photo.png");
  assert.equal(payload.metadata.contentType, "image/png");
});

test("put overwriting an existing key publishes storage.updated (Req 18.1)", async () => {
  const events = recordingEvents();
  const storage = createStorage({ provider: "memory", bridges: { events } });

  await storage.put("doc.txt", "v1");
  await storage.put("doc.txt", "v2");

  assert.deepEqual(
    events.published.map((e) => e.event),
    ["storage.uploaded", "storage.updated"],
  );
  assert.equal(events.published[1].payload.key, "doc.txt");
  assert.ok(events.published[1].payload.metadata);
});

test("delete publishes storage.deleted with the key (Req 18.1, 18.2)", async () => {
  const events = recordingEvents();
  const storage = createStorage({ provider: "memory", bridges: { events } });

  await storage.put("gone.txt", "x");
  events.published.length = 0; // ignore the upload event

  await storage.delete("gone.txt");

  assert.equal(events.published.length, 1);
  assert.equal(events.published[0].event, "storage.deleted");
  assert.equal(events.published[0].payload.key, "gone.txt");
});

test("move publishes storage.moved for the destination (Req 18.1)", async () => {
  const events = recordingEvents();
  const storage = createStorage({ provider: "memory", bridges: { events } });

  await storage.put("a.txt", "content");
  events.published.length = 0;

  await storage.move("a.txt", "b.txt");

  assert.equal(events.published.length, 1);
  assert.equal(events.published[0].event, "storage.moved");
  assert.equal(events.published[0].payload.key, "b.txt");
  assert.ok(events.published[0].payload.metadata);
});

test("rename publishes storage.moved (delegates to move) (Req 18.1)", async () => {
  const events = recordingEvents();
  const storage = createStorage({ provider: "memory", bridges: { events } });

  await storage.put("old", "content");
  events.published.length = 0;

  await storage.rename("old", "new");

  assert.deepEqual(
    events.published.map((e) => e.event),
    ["storage.moved"],
  );
  assert.equal(events.published[0].payload.key, "new");
});

test("move of a missing source publishes nothing", async () => {
  const events = recordingEvents();
  const storage = createStorage({ provider: "memory", bridges: { events } });

  const result = await storage.move("missing", "dest");

  assert.equal(result.moved, false);
  assert.deepEqual(events.published, []);
});

test("restoreVersion publishes storage.restored (Req 18.1)", async () => {
  const events = recordingEvents();
  const storage = createStorage({
    provider: "memory",
    versioning: true,
    bridges: { events },
  });

  await storage.put("k", "v1");
  await storage.put("k", "v2"); // snapshots v1 as a version
  const versions = await storage.listVersions("k");
  assert.equal(versions.length, 1);

  events.published.length = 0;
  await storage.restoreVersion("k", versions[0].versionId);

  assert.equal(events.published.length, 1);
  assert.equal(events.published[0].event, "storage.restored");
  assert.equal(events.published[0].payload.key, "k");
  assert.ok(events.published[0].payload.metadata);
});

test("applyLifecycle publishes lifecycle events through the bridge (Req 13.4)", async () => {
  const events = recordingEvents();
  let now = T0;
  const clock = () => now;
  const storage = createStorage({ provider: "memory", clock, bridges: { events } });

  await storage.put("old", "a");
  now = T0 + 10 * DAY;
  events.published.length = 0;

  const outcomes = await storage.applyLifecycle({ type: "delete-after-days", days: 5 });

  assert.deepEqual(outcomes, [{ key: "old", action: "deleted" }]);
  assert.equal(events.published.length, 1);
  assert.equal(events.published[0].event, "storage.deleted");
  assert.equal(events.published[0].payload.key, "old");
  assert.equal(events.published[0].payload.action, "deleted");
});

test("expire-temp-uploads publishes storage.expired (Req 13.4)", async () => {
  const events = recordingEvents();
  let now = T0;
  const clock = () => now;
  const storage = createStorage({ provider: "memory", clock, bridges: { events } });

  const uploadId = await storage.createMultipartUpload("big", { contentType: "text/plain" });
  await storage.uploadPart(uploadId, 1, new TextEncoder().encode("part-1"));
  now = T0 + 60_000;
  events.published.length = 0;

  const outcomes = await storage.applyLifecycle({ type: "expire-temp-uploads", afterMs: 30_000 });

  assert.equal(outcomes.length, 1);
  assert.equal(events.published.length, 1);
  assert.equal(events.published[0].event, "storage.expired");
  assert.equal(events.published[0].payload.action, "expired");
});

test("archive-after-months publishes storage.moved with action=archived (Req 13.4)", async () => {
  const events = recordingEvents();
  let now = T0;
  const clock = () => now;
  const storage = createStorage({ provider: "memory", clock, bridges: { events } });

  await storage.put("report", "payload");
  now = T0 + 90 * DAY;
  events.published.length = 0;

  const outcomes = await storage.applyLifecycle({ type: "archive-after-months", months: 2 });

  assert.deepEqual(outcomes, [{ key: "report", action: "archived" }]);
  assert.equal(events.published.length, 1);
  assert.equal(events.published[0].event, "storage.moved");
  assert.equal(events.published[0].payload.action, "archived");
});

test("a synchronous publish failure never breaks the storage operation", async () => {
  const throwingEvents = {
    publish() {
      throw new Error("event bus down");
    },
  };
  const storage = createStorage({ provider: "memory", bridges: { events: throwingEvents } });

  // The put must still succeed and return metadata despite the publish throwing.
  const metadata = await storage.put("k", "v");
  assert.equal(metadata.key, "k");
  assert.equal(await storage.exists("k"), true);

  // delete must likewise succeed.
  await storage.delete("k");
  assert.equal(await storage.exists("k"), false);
});

test("an asynchronous publish rejection never breaks the storage operation", async () => {
  const rejectingEvents = {
    publish() {
      return Promise.reject(new Error("async bus down"));
    },
  };
  const storage = createStorage({ provider: "memory", bridges: { events: rejectingEvents } });

  const metadata = await storage.put("k", "v");
  assert.equal(metadata.key, "k");

  const result = await storage.get("k");
  assert.equal(result.found, true);
});

test("with no events bridge configured, operations proceed with no publication", async () => {
  const storage = createStorage({ provider: "memory" });

  const metadata = await storage.put("k", "v");
  assert.equal(metadata.key, "k");
  await storage.delete("k");
  assert.equal(await storage.exists("k"), false);
});

test("bridgeStorageEvents is a standalone never-throwing publisher", () => {
  const events = recordingEvents();
  const publisher = bridgeStorageEvents(events);

  const metadata = {
    key: "k",
    size: 1,
    contentType: "text/plain",
    etag: "e",
    checksum: "c",
    accessLevel: "private",
    createdAt: T0,
    updatedAt: T0,
    custom: {},
  };

  publisher.uploaded(metadata);
  publisher.updated(metadata);
  publisher.deleted("k");
  publisher.moved(metadata);
  publisher.restored(metadata);
  publisher.expired("k");
  publisher.lifecycle({ key: "k", action: "moved" });

  assert.deepEqual(
    events.published.map((e) => e.event),
    [
      "storage.uploaded",
      "storage.updated",
      "storage.deleted",
      "storage.moved",
      "storage.restored",
      "storage.expired",
      "storage.moved",
    ],
  );

  // A throwing bus is fully isolated.
  const badPublisher = bridgeStorageEvents({
    publish() {
      throw new Error("down");
    },
  });
  assert.doesNotThrow(() => badPublisher.uploaded(metadata));
});
