// Property-based test for concurrent write isolation on the storage facade.
//
// Feature: unified-storage-framework, Property 17: Concurrent uploads never
// corrupt data.
//
// For an arbitrary set of DISTINCT keys, each paired with its own byte content,
// performing all `put` operations CONCURRENTLY (`Promise.all`) against a single
// storage instance results in every key holding exactly its own content. No
// key observes another key's bytes (no cross-contamination), and no bytes are
// corrupted: reading each key back yields bytes exactly equal to the content
// that was intended for that key.
//
// Uses the Node.js built-in test runner (node:test) and fast-check at
// `{ numRuns: 100 }`, exercising the public facade via
// `createStorage({ provider: 'memory' })` imported from the built package
// entry point (`../index.js`), executed via `node --test dist/tests/*.test.js`.
//
// Validates: Requirements 26.6

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createStorage } from "../index.js";

/** A fixed clock so object timestamps are deterministic across runs. */
const fixedClock = () => 1_700_000_000_000;

/**
 * An arbitrary set of distinct keys each mapped to its own byte content.
 *
 * `fc.uniqueArray` on non-empty keys guarantees the keys are DISTINCT, so each
 * concurrent `put` targets a different object and the property genuinely tests
 * cross-key isolation rather than last-writer-wins on a shared key. `minLength:
 * 2` ensures there is always genuine concurrency to exercise.
 */
const distinctEntriesArb = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 40 }), {
    minLength: 2,
    maxLength: 25,
  })
  .chain((keys) =>
    fc.tuple(
      fc.constant(keys),
      fc.array(fc.uint8Array({ minLength: 0, maxLength: 256 }), {
        minLength: keys.length,
        maxLength: keys.length,
      }),
    ),
  )
  .map(([keys, contents]) =>
    keys.map((key, index): [string, Uint8Array] => [key, contents[index]]),
  );

test("Feature: unified-storage-framework, Property 17: Concurrent uploads never corrupt data", async () => {
  await fc.assert(
    fc.asyncProperty(distinctEntriesArb, async (entries) => {
      // A single shared storage instance receives every concurrent write.
      const storage = createStorage({ provider: "memory", clock: fixedClock });

      // Fire all puts CONCURRENTLY against the one instance.
      await Promise.all(entries.map(([key, content]) => storage.put(key, content)));

      // Every key must hold exactly its own content — read them all back
      // concurrently and assert byte-for-byte equality with the intended value.
      await Promise.all(
        entries.map(async ([key, content]) => {
          const result = await storage.get(key);
          assert.equal(result.found, true, `key ${JSON.stringify(key)} must be present after concurrent writes`);
          assert.deepEqual(
            result.bytes,
            content,
            `key ${JSON.stringify(key)} must hold exactly its own content (no cross-contamination)`,
          );
        }),
      );

      await storage.close();
    }),
    { numRuns: 100 },
  );
});
