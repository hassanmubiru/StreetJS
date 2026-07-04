// Unit tests for the image processor's error handling and caching (task 19.2).
//
// Verifies the Requirement 14 semantics that guard and cache image
// transformations over the zero-dependency `memory` provider, driving the
// processor through the public `storage.images.transform(key, operations)`
// surface with a structural fake `imageCodec`:
//
//  - unsupported-format error: transforming a non-image source (e.g. a
//    `text/plain` object) throws `UnsupportedImageError` and leaves the source
//    Object completely unmodified — its bytes and its metadata are intact,
//    regardless of whether processing would otherwise succeed (Requirement 14.4).
//  - cache-hit reuse: two identical transform requests on the same unchanged
//    source invoke the injected codec only ONCE (the second request is served
//    from the cache) and produce the same variant (Requirement 14.3).
//
// Uses the Node.js built-in test runner (node:test); executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 14.3, 14.4

import test from "node:test";
import assert from "node:assert/strict";

import { createStorage } from "../facade.js";
import { UnsupportedImageError } from "../errors.js";
import type { ImageOperations } from "../facade.js";
import type { ImageCodec } from "../types.js";

const fixedClock = () => 1_700_000_000_000;

/**
 * Build a structural fake `ImageCodec` whose `transform` returns deterministic
 * bytes and counts how many times it was invoked, so a test can assert the
 * processor cache prevents re-invocation for identical requests.
 */
function makeFakeCodec() {
  const codec: ImageCodec & { calls: number } = {
    calls: 0,
    transform(bytes, operation) {
      codec.calls += 1;
      // Deterministic output derived only from the requested output format, so
      // identical requests would (absent caching) produce identical bytes.
      const marker = `variant:${operation.format ?? "png"}`;
      return new TextEncoder().encode(marker);
    },
  };
  return codec;
}

test("transforming a non-image source throws UnsupportedImageError (Req 14.4)", async () => {
  const codec = makeFakeCodec();
  const storage = createStorage({ provider: "memory", imageCodec: codec, clock: fixedClock });

  await storage.put("notes.txt", "just some text", { contentType: "text/plain" });

  await assert.rejects(
    () => storage.images.transform("notes.txt", { resize: { width: 10, height: 10 } }),
    UnsupportedImageError,
  );

  // The guard must run before any codec call.
  assert.equal(codec.calls, 0);
});

test("a rejected non-image transform leaves the source Object unmodified (Req 14.4)", async () => {
  const codec = makeFakeCodec();
  const storage = createStorage({ provider: "memory", imageCodec: codec, clock: fixedClock });

  await storage.put("notes.txt", "just some text", { contentType: "text/plain" });

  const before = await storage.get("notes.txt");
  const beforeBytes = Buffer.from(before.bytes!);
  const beforeMeta = before.metadata;
  assert.ok(beforeMeta);

  await assert.rejects(
    () => storage.images.transform("notes.txt", { format: "png", resize: { width: 4 } }),
    UnsupportedImageError,
  );

  const after = await storage.get("notes.txt");
  assert.ok(after.metadata);

  // Bytes are byte-for-byte intact.
  assert.ok(beforeBytes.equals(Buffer.from(after.bytes!)));
  assert.equal(Buffer.from(after.bytes!).toString(), "just some text");

  // Metadata is intact: identity, size, content type, and checksum unchanged.
  assert.equal(after.metadata.key, beforeMeta.key);
  assert.equal(after.metadata.size, beforeMeta.size);
  assert.equal(after.metadata.contentType, "text/plain");
  assert.equal(after.metadata.checksum, beforeMeta.checksum);
  assert.equal(after.metadata.etag, beforeMeta.etag);
  assert.equal(after.metadata.updatedAt, beforeMeta.updatedAt);
});

test("identical transform requests invoke the codec only once (Req 14.3)", async () => {
  const codec = makeFakeCodec();
  const storage = createStorage({ provider: "memory", imageCodec: codec, clock: fixedClock });

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  await storage.put("photo.png", pngBytes, { contentType: "image/png" });

  const operations: ImageOperations = { resize: { width: 100, height: 100 }, format: "webp" };

  const first = await storage.images.transform("photo.png", operations);
  const second = await storage.images.transform("photo.png", operations);

  // The codec performed the pixel work exactly once; the second request was a
  // cache hit (Requirement 14.3).
  assert.equal(codec.calls, 1);

  // Both requests produced the same variant.
  assert.equal(second.key, first.key);
  assert.equal(second.checksum, first.checksum);
  assert.equal(second.etag, first.etag);
  assert.equal(second.size, first.size);
  assert.equal(second.contentType, first.contentType);
  assert.equal(first.contentType, "image/webp");
});

test("distinct transform parameters are not served from the cache (Req 14.3)", async () => {
  const codec = makeFakeCodec();
  const storage = createStorage({ provider: "memory", imageCodec: codec, clock: fixedClock });

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 5, 6, 7, 8]);
  await storage.put("photo.png", pngBytes, { contentType: "image/png" });

  await storage.images.transform("photo.png", { resize: { width: 50 }, format: "png" });
  await storage.images.transform("photo.png", { resize: { width: 60 }, format: "png" });

  // Different parameters are a cache miss, so the codec runs for each.
  assert.equal(codec.calls, 2);
});
