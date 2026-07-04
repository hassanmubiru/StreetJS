// Property-based test for the storage facade streaming round-trip guarantee.
//
// Property 7 (Streaming preserves bytes): for arbitrary keys and byte contents,
// persisting bytes with `putStream(key, Readable.from([bytes]))` and then
// reading them back with `getStream(key)` (collecting every emitted chunk)
// yields content bytes exactly equal to the original input. This exercises the
// facade over the zero-dependency `memory` provider, driving the identical
// streaming code path every provider shares (Requirement 5.1, 5.2, 5.4).
//
// Uses the Node.js built-in test runner (node:test) with fast-check for input
// generation, executed via `node --test dist/tests/*.test.js`. fast-check is
// configured with { numRuns: 100 } per the design's property-testing contract.
//
// Feature: unified-storage-framework, Property 7: Streaming preserves bytes
//
// Validates: Requirements 5.1, 5.2, 5.4

import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { buffer as streamToBuffer } from "node:stream/consumers";

import fc from "fast-check";

import { createStorage } from "../facade.js";

test(
  "Feature: unified-storage-framework, Property 7: Streaming preserves bytes",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.uint8Array(),
        async (key, content) => {
          // A fresh store per run keeps each key/content pair independent.
          const storage = createStorage({ provider: "memory" });

          // Build the source stream from the raw bytes and stream it in.
          await storage.putStream(key, Readable.from([Buffer.from(content)]));

          // Collect all emitted chunks from the readable back into a buffer.
          const out = await streamToBuffer(await storage.getStream(key));

          assert.deepEqual(new Uint8Array(out), content);
        },
      ),
      { numRuns: 100 },
    );
  },
);
