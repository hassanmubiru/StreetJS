// Property-based test for the storage facade `copy` operation.
//
// Feature: unified-storage-framework, Property 2: Copy is non-mutating and
// duplicates content.
//
// For arbitrary, distinct source/destination keys and arbitrary content, after
// `put(source, bytes)` followed by `copy(source, dest)`:
//   - the source still returns the original bytes (unchanged),
//   - the destination returns bytes equal to the source content, and
//   - the copy result is `{ copied: true }`.
// Additionally, copying a source key that was never written returns
// `{ copied: false }` and creates nothing at the destination.
//
// Uses the Node.js built-in test runner (node:test) and fast-check at
// `{ numRuns: 100 }`, exercising the public facade via
// `createStorage({ provider: 'memory' })` imported from the built package
// entry point (`../index.js`), executed via `node --test dist/tests/*.test.js`.
//
// Validates: Requirements 4.5, 26.3

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createStorage } from "../index.js";

/** A fixed clock so object timestamps are deterministic across runs. */
const fixedClock = () => 1_700_000_000_000;

/**
 * Arbitrary object content: arbitrary byte arrays (including empty) mapped to a
 * Uint8Array, which is what the facade/driver persists.
 */
const contentArb = fc.uint8Array({ minLength: 0, maxLength: 256 });

/**
 * Two distinct, non-empty object keys. Keys are constrained to non-empty
 * strings and the pair is filtered so the source and destination never collide
 * (a copy onto itself is a different scenario than "duplicate to a new key").
 */
const distinctKeysArb = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 40 }),
    fc.string({ minLength: 1, maxLength: 40 }),
  )
  .filter(([source, dest]) => source !== dest);

test("Feature: unified-storage-framework, Property 2: Copy is non-mutating and duplicates content", async () => {
  await fc.assert(
    fc.asyncProperty(distinctKeysArb, contentArb, async ([source, dest], content) => {
      // A fresh storage instance per case keeps runs independent.
      const storage = createStorage({ provider: "memory", clock: fixedClock });

      // ── Copy of a missing source: no-op that creates nothing ────────────────
      const missing = await storage.copy(source, dest);
      assert.equal(missing.copied, false, "copy of a missing source must report copied:false");
      assert.equal(await storage.exists(source), false, "missing source must not be created by copy");
      assert.equal(await storage.exists(dest), false, "destination must not be created when source is missing");

      // ── Copy after a real write: duplicates content, source unchanged ───────
      await storage.put(source, content);

      const result = await storage.copy(source, dest);
      assert.equal(result.copied, true, "copy of an existing source must report copied:true");

      // Source still returns the original bytes (non-mutating).
      const afterSource = await storage.get(source);
      assert.equal(afterSource.found, true, "source must still exist after copy");
      assert.deepEqual(afterSource.bytes, content, "source bytes must be unchanged after copy");

      // Destination returns bytes equal to the source content (duplicated).
      const afterDest = await storage.get(dest);
      assert.equal(afterDest.found, true, "destination must exist after copy");
      assert.deepEqual(afterDest.bytes, content, "destination bytes must equal the source content");

      await storage.close();
    }),
    { numRuns: 100 },
  );
});
