// Unit tests for the pre-persistence validation pipeline of @streetjs/storage.
//
// Covers the built-in validators (MIME type, extension, size, filename,
// checksum, custom), their ordering/short-circuit behavior, and the facade
// wiring: when `config.validation` is set, a rejected upload aborts with a
// ValidationError and leaves NO object stored (Requirements 9.1, 9.2, 9.3, 9.4).
//
// Uses the Node.js built-in test runner (node:test), executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 9.1, 9.2, 9.3, 9.4

import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { ValidationPipeline } from "../validation.js";
import { createStorage } from "../facade.js";
import { ValidationError } from "../errors.js";

// ── Pipeline-level tests ──────────────────────────────────────────────────────

test("MIME type validator accepts allowed exact and wildcard types", async () => {
  const pipeline = new ValidationPipeline({ allowedMimeTypes: ["image/png", "text/*"] });
  assert.equal((await pipeline.validate({ key: "a.png", size: 1, contentType: "image/png" })).ok, true);
  assert.equal((await pipeline.validate({ key: "a.txt", size: 1, contentType: "text/plain" })).ok, true);
});

test("MIME type validator rejects disallowed or missing content type", async () => {
  const pipeline = new ValidationPipeline({ allowedMimeTypes: ["image/png"] });
  const disallowed = await pipeline.validate({ key: "a.gif", size: 1, contentType: "image/gif" });
  assert.equal(disallowed.ok, false);
  assert.ok(disallowed.error!.includes("image/gif"));

  const missing = await pipeline.validate({ key: "a", size: 1 });
  assert.equal(missing.ok, false);
});

test("extension validator normalizes dots and case", async () => {
  const pipeline = new ValidationPipeline({ allowedExtensions: [".PNG", "jpg"] });
  assert.equal((await pipeline.validate({ key: "photos/a.png", size: 1 })).ok, true);
  assert.equal((await pipeline.validate({ key: "photos/a.JPG", size: 1 })).ok, true);
  const bad = await pipeline.validate({ key: "photos/a.gif", size: 1 });
  assert.equal(bad.ok, false);
  const none = await pipeline.validate({ key: "photos/noext", size: 1 });
  assert.equal(none.ok, false);
});

test("size validator rejects content larger than maxSize", async () => {
  const pipeline = new ValidationPipeline({ maxSize: 10 });
  assert.equal((await pipeline.validate({ key: "a", size: 10 })).ok, true);
  const tooBig = await pipeline.validate({ key: "a", size: 11 });
  assert.equal(tooBig.ok, false);
  assert.ok(tooBig.error!.includes("11"));
});

test("filename validator matches against the final path segment", async () => {
  const pipeline = new ValidationPipeline({ filenamePattern: /^[a-z0-9_-]+\.txt$/ });
  assert.equal((await pipeline.validate({ key: "dir/valid_name.txt", size: 1 })).ok, true);
  const bad = await pipeline.validate({ key: "dir/Bad Name.txt", size: 1 });
  assert.equal(bad.ok, false);
});

test("filename validator with a global pattern is not stateful across calls", async () => {
  const pipeline = new ValidationPipeline({ filenamePattern: /\.txt$/g });
  assert.equal((await pipeline.validate({ key: "a.txt", size: 1 })).ok, true);
  assert.equal((await pipeline.validate({ key: "b.txt", size: 1 })).ok, true);
});

test("checksum validator requires a non-empty checksum when configured", async () => {
  const pipeline = new ValidationPipeline({ requireChecksum: true });
  assert.equal((await pipeline.validate({ key: "a", size: 1, checksum: "abc" })).ok, true);
  assert.equal((await pipeline.validate({ key: "a", size: 1 })).ok, false);
  assert.equal((await pipeline.validate({ key: "a", size: 1, checksum: "" })).ok, false);
});

test("custom validator result is returned verbatim and runs last", async () => {
  const pipeline = new ValidationPipeline({
    custom: (input) => ({ ok: false, error: `custom rejected ${input.key}` }),
  });
  const result = await pipeline.validate({ key: "x", size: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.error, "custom rejected x");
});

test("pipeline short-circuits on the first rejection in order", async () => {
  // Size (validator 3) rejects; the custom validator (validator 6) must not run.
  let customRan = false;
  const pipeline = new ValidationPipeline({
    maxSize: 5,
    custom: () => {
      customRan = true;
      return { ok: true };
    },
  });
  const result = await pipeline.validate({ key: "a", size: 100 });
  assert.equal(result.ok, false);
  assert.equal(customRan, false);
});

test("empty config accepts everything", async () => {
  const pipeline = new ValidationPipeline({});
  assert.equal((await pipeline.validate({ key: "anything", size: 12345 })).ok, true);
});

// ── Facade wiring tests ────────────────────────────────────────────────────────

test("facade put rejects invalid uploads and stores no object", async () => {
  const storage = createStorage({
    provider: "memory",
    validation: { maxSize: 4 },
  });
  await assert.rejects(
    () => storage.put("big.bin", new Uint8Array([1, 2, 3, 4, 5])),
    (err) => err instanceof ValidationError,
  );
  assert.equal(await storage.exists("big.bin"), false);
});

test("facade put persists valid uploads when validation passes", async () => {
  const storage = createStorage({
    provider: "memory",
    validation: { maxSize: 16, allowedExtensions: ["txt"] },
  });
  const meta = await storage.put("notes/a.txt", "hello");
  assert.equal(meta.key, "notes/a.txt");
  assert.equal(await storage.exists("notes/a.txt"), true);
});

test("facade putStream rejects invalid uploads and stores no object", async () => {
  const storage = createStorage({
    provider: "memory",
    validation: { maxSize: 3 },
  });
  const stream = Readable.from([Buffer.from([1, 2, 3, 4, 5, 6])]);
  await assert.rejects(
    () => storage.putStream("stream.bin", stream),
    (err) => err instanceof ValidationError,
  );
  assert.equal(await storage.exists("stream.bin"), false);
});

test("facade putStream persists valid uploads and preserves bytes", async () => {
  const storage = createStorage({
    provider: "memory",
    validation: { maxSize: 1024 },
  });
  const content = Buffer.from("streamed payload");
  const stream = Readable.from([content]);
  await storage.putStream("ok.bin", stream);
  const result = await storage.get("ok.bin");
  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, new Uint8Array(content));
});

test("facade without validation config performs no validation", async () => {
  const storage = createStorage({ provider: "memory" });
  await storage.put("huge.bin", new Uint8Array(1000));
  assert.equal(await storage.exists("huge.bin"), true);
});
