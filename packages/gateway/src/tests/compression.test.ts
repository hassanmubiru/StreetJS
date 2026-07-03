import test from "node:test";
import assert from "node:assert/strict";

import { negotiateEncoding, compress, decompress, shouldCompress } from "../compression.js";
import type { CompressionEncoding } from "../types.js";

// ── negotiateEncoding ─────────────────────────────────────────────────────────────

test("negotiateEncoding prefers br when 'br, gzip' and both allowed", () => {
  assert.equal(negotiateEncoding("br, gzip"), "br");
});

test("negotiateEncoding picks gzip when only gzip is acceptable", () => {
  assert.equal(negotiateEncoding("gzip"), "gzip");
});

test("negotiateEncoding respects an explicit allow list", () => {
  const allow: CompressionEncoding[] = ["gzip"];
  // br is requested but not allowed, gzip is allowed and acceptable.
  assert.equal(negotiateEncoding("br, gzip", { allow }), "gzip");
});

test("negotiateEncoding returns identity when the header is absent", () => {
  assert.equal(negotiateEncoding(undefined), "identity");
});

test("negotiateEncoding returns identity when the header is 'identity'", () => {
  assert.equal(negotiateEncoding("identity"), "identity");
});

test("negotiateEncoding returns identity for unsupported encodings", () => {
  assert.equal(negotiateEncoding("deflate, compress"), "identity");
});

test("negotiateEncoding honours q=0 (gzip;q=0, br → br)", () => {
  assert.equal(negotiateEncoding("gzip;q=0, br"), "br");
});

test("negotiateEncoding uses q-values to override the default preference", () => {
  // gzip is explicitly preferred over br via q-values.
  assert.equal(negotiateEncoding("br;q=0.5, gzip;q=1.0"), "gzip");
});

// ── compress / decompress round-trips ──────────────────────────────────────────────

test("gzip round-trip returns the original bytes", async () => {
  const original = Buffer.from("the quick brown fox jumps over the lazy dog");
  const compressed = await compress(original, "gzip");
  const restored = await decompress(compressed, "gzip");
  assert.deepEqual(Buffer.from(restored), original);
});

test("brotli round-trip returns the original bytes", async () => {
  const original = Buffer.from("the quick brown fox jumps over the lazy dog");
  const compressed = await compress(original, "br");
  const restored = await decompress(compressed, "br");
  assert.deepEqual(Buffer.from(restored), original);
});

test("identity compression is a no-op in both directions", async () => {
  const original = Buffer.from("unchanged payload");
  const compressed = await compress(original, "identity");
  assert.equal(compressed, original);
  const restored = await decompress(original, "identity");
  assert.equal(restored, original);
});

// ── shouldCompress ────────────────────────────────────────────────────────────────

test("shouldCompress honours the threshold boundary", () => {
  assert.equal(shouldCompress(1023), false); // below default threshold
  assert.equal(shouldCompress(1024), true); // exactly at the threshold
  assert.equal(shouldCompress(1025), true); // above the threshold
});

test("shouldCompress respects a custom threshold", () => {
  assert.equal(shouldCompress(511, 512), false);
  assert.equal(shouldCompress(512, 512), true);
});
