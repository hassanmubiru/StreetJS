// Property-based test for the storage facade's delete semantics.
//
// Property 4: Delete removes visibility. For any stored object, after
// `put(key, bytes)` then `delete(key)`, the object becomes invisible through
// every read surface: `exists(key)` is false, `get(key)` reports not-found,
// and `stat(key)` returns null.
//
// Backed by the zero-dependency in-memory provider via `createStorage({
// provider: 'memory' })`, exercised across arbitrary keys and byte contents
// with fast-check at { numRuns: 100 }. Executed via the Node.js built-in test
// runner (`node --test dist/tests/*.test.js`).
//
// Feature: unified-storage-framework, Property 4
// Validates: Requirements 4.4, 26.4

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createStorage } from "../index.js";

test(
  "Feature: unified-storage-framework, Property 4 — delete removes visibility",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        // Arbitrary non-empty keys and arbitrary byte contents.
        fc.string({ minLength: 1 }),
        fc.uint8Array(),
        async (key, content) => {
          const storage = createStorage({ provider: "memory" });

          await storage.put(key, content);
          await storage.delete(key);

          // exists reports false after delete.
          assert.equal(await storage.exists(key), false);

          // get reports not-found (never throws).
          const result = await storage.get(key);
          assert.equal(result.found, false);

          // stat returns null for the deleted key.
          assert.equal(await storage.stat(key), null);
        },
      ),
      { numRuns: 100 },
    );
  },
);
