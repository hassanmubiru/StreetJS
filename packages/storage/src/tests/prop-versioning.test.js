// Property-based test for the storage facade's versioning restore semantics.
//
// Feature: unified-storage-framework, Property 13: Version restore reproduces
// prior state. With versioning enabled (`createStorage({ provider: 'memory',
// versioning: true, clock })`), for an arbitrary sequence of contents written
// to a single key, each overwrite snapshots the prior content as a retained
// Version. Restoring a listed Version makes exactly that Version's prior
// content current again (bytes equal).
//
// The listed Versions are ordered oldest-first by creation time, so with a
// strictly-increasing clock the i-th listed Version corresponds to the i-th
// written content (each of the N writes after the first snapshots the content
// that preceded it, yielding N-1 Versions for contents[0..N-2]).
//
// Backed by the zero-dependency in-memory provider, exercised across arbitrary
// keys and content sequences with fast-check at { numRuns: 100 }. Executed via
// the Node.js built-in test runner (`node --test dist/tests/*.test.js`).
//
// Validates: Requirements 12.1, 12.2, 12.3, 12.4, 26.5

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createStorage } from "../index.js";

/**
 * A strictly-increasing clock. Each successive write therefore stamps a larger
 * creation time, so the retained Versions enumerate oldest-first in the same
 * order they were written — letting the i-th Version be matched to the i-th
 * written content.
 */
function makeIncrementingClock() {
  let now = 1_700_000_000_000;
  return () => now++;
}

/** Arbitrary object content: byte arrays (including empty) as Uint8Array. */
const contentArb = fc.uint8Array({ minLength: 0, maxLength: 128 });

/**
 * A sequence of at least two contents written to the same key, so at least one
 * overwrite (and therefore at least one retained Version) occurs.
 */
const contentSequenceArb = fc.array(contentArb, { minLength: 2, maxLength: 6 });

test(
  "Feature: unified-storage-framework, Property 13 — version restore reproduces prior state",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }),
        contentSequenceArb,
        async (key, contents) => {
          // A fresh, versioned storage instance per case keeps runs independent.
          const storage = createStorage({
            provider: "memory",
            versioning: true,
            clock: makeIncrementingClock(),
          });

          // Write the full sequence to the same key; each write after the first
          // overwrites the prior content and snapshots it as a Version (12.1).
          for (const content of contents) {
            await storage.put(key, content);
          }

          // Each of the N writes after the first produces exactly one Version,
          // enumerated oldest-first (12.2).
          const versions = await storage.listVersions(key);
          assert.equal(
            versions.length,
            contents.length - 1,
            "one retained Version per overwrite",
          );

          // Restoring the i-th listed Version reproduces exactly contents[i],
          // the content that preceded the (i+1)-th write (12.3). Restoring does
          // not itself create a new Version, so the Version set is stable and
          // every listed Version remains restorable (12.4).
          for (let i = 0; i < versions.length; i++) {
            const meta = await storage.restoreVersion(key, versions[i].versionId);
            assert.equal(meta.key, key, "restore returns metadata for the key");

            const got = await storage.get(key);
            assert.equal(got.found, true, "restored object is readable");
            assert.deepEqual(
              got.bytes,
              contents[i],
              "restored content equals the Version's prior content (bytes equal)",
            );

            // The Version set is unchanged by a restore.
            assert.equal(
              (await storage.listVersions(key)).length,
              versions.length,
              "restore does not add or remove Versions",
            );
          }

          await storage.close();
        },
      ),
      { numRuns: 100 },
    );
  },
);
