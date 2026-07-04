// Property test: move relocates content and removes the source.
//
// Feature: unified-storage-framework, Property 3: Move relocates content and
// removes the source.
// Validates: Requirements 4.7, 4.8, 26.3
//
// Req 4.7: `move(source, destination)` relocates the object — the content
//   becomes available at `destination` and the source object is removed.
// Req 4.8: after a successful relocation the source key no longer exists.
// Req 26.3: the observable move semantics hold across arbitrary keys/content.
//
// Strategy: through the real facade built with the zero-dependency memory
// provider (`createStorage({ provider: "memory" })`), for arbitrary DISTINCT
// source/destination keys and arbitrary content bytes:
//   1. `put(source, bytes)` stores the content,
//   2. `move(source, dest)` relocates it, and we assert the four observable
//      consequences of a successful move:
//        (a) the move result is `{ moved: true }`,
//        (b) `get(dest)` returns bytes byte-for-byte equal to the original,
//        (c) `exists(source)` is now false, and
//        (d) `get(source)` reports `{ found: false }`.
// A control case guards the not-found path: moving a source that was never
// stored returns `{ moved: false }` without throwing.
//
// Uses the Node.js built-in test runner (node:test) and fast-check at the
// spec-mandated `{ numRuns: 100 }`.

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createStorage } from "../index.js";

/**
 * Generate two distinct, non-empty object keys. fast-check's `uniqueArray`
 * guarantees the pair differs, so `source` and `destination` never collide
 * (a collision would make "removes the source" ambiguous).
 */
const distinctKeys = fc
  .uniqueArray(
    fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
    { minLength: 2, maxLength: 2 },
  )
  .map(([source, destination]) => ({ source, destination }));

test("Feature: unified-storage-framework, Property 3: move relocates content and removes the source", async () => {
  await fc.assert(
    fc.asyncProperty(
      distinctKeys,
      fc.uint8Array({ minLength: 0, maxLength: 512 }),
      async ({ source, destination }, content) => {
        const storage = createStorage({ provider: "memory" });

        await storage.put(source, content);

        const result = await storage.move(source, destination);

        // (a) the move reports success.
        assert.equal(result.moved, true);

        // (b) the destination now holds the original bytes, unchanged.
        const atDest = await storage.get(destination);
        assert.equal(atDest.found, true);
        assert.deepEqual(atDest.bytes, content);

        // (c) the source no longer exists.
        assert.equal(await storage.exists(source), false);

        // (d) reading the source reports not-found (never throws).
        const atSource = await storage.get(source);
        assert.equal(atSource.found, false);
      },
    ),
    { numRuns: 100 },
  );
});

test("Feature: unified-storage-framework, Property 3: moving a missing source returns { moved: false }", async () => {
  await fc.assert(
    fc.asyncProperty(distinctKeys, async ({ source, destination }) => {
      const storage = createStorage({ provider: "memory" });

      // Nothing was ever stored under `source`.
      const result = await storage.move(source, destination);

      assert.equal(result.moved, false);
      // No object is fabricated at the destination.
      assert.equal(await storage.exists(destination), false);
    }),
    { numRuns: 100 },
  );
});
