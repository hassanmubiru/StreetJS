// Property-based test for the storage facade round-trip guarantee.
//
// Property 1 (Upload/download preserves bytes): for arbitrary keys and byte
// contents, persisting bytes with `put(key, bytes)` and then reading them back
// with `get(key)` yields `found: true` and content bytes exactly equal to the
// original input. This exercises the facade over the zero-dependency `memory`
// provider, driving the identical code path every provider shares.
//
// Uses the Node.js built-in test runner (node:test) with fast-check for input
// generation, executed via `node --test dist/tests/*.test.js`. fast-check is
// configured with { numRuns: 100 } per the design's property-testing contract.
//
// Feature: unified-storage-framework, Property 1: Upload/download preserves bytes
//
// Validates: Requirements 4.1, 4.2, 26.2

import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { createStorage } from "../facade.js";

test(
  "Feature: unified-storage-framework, Property 1: Upload/download preserves bytes",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.uint8Array(),
        async (key, content) => {
          // A fresh store per run keeps each key/content pair independent.
          const storage = createStorage({ provider: "memory" });

          await storage.put(key, content);
          const result = await storage.get(key);

          assert.equal(result.found, true);
          assert.deepEqual(result.bytes, content);
        },
      ),
      { numRuns: 100 },
    );
  },
);
