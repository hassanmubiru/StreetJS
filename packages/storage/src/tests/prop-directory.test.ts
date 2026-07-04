// Property-based test for the storage Directory API over the flat key space.
//
// Feature: unified-storage-framework, Property 16 — Directory operations over a
// flat key space. For an arbitrary set of `/`-delimited keys put into storage,
// the directory operations are consistent over the flat key space:
//
//  - walk(prefix) returns exactly the keys beneath the prefix (Req 15.4).
//  - listDirectory(prefix) returns exactly the immediate children (files plus
//    collapsed sub-directory entries) with no duplicates and nothing outside
//    the prefix (Req 15.2).
//  - removeDirectory(prefix) removes exactly the keys beneath the prefix, and
//    returns { removed: false } for an empty/missing prefix (Req 15.3, 15.6).
//
// Each observation is asserted against a computed expectation derived directly
// from the generated key set.
//
// Uses the public facade via `createStorage({ provider: 'memory' })`, the
// Node.js built-in test runner (node:test), and fast-check configured with
// { numRuns: 100 }. Executed via `node --test dist/tests/*.test.js`.
//
// Validates: Requirements 15.2, 15.3, 15.4, 15.6

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createStorage } from "../index.js";

// Segments are drawn from a tiny alphabet so shared prefixes arise frequently,
// exercising both matching and non-matching keys against a directory prefix.
const segArb = fc.constantFrom("a", "b", "c");

// A key is 1–3 `/`-delimited segments (no leading/trailing delimiter).
const keyArb = fc
  .array(segArb, { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join("/"));

// A directory path is 0–2 segments; the empty path denotes the root.
const dirArb = fc
  .array(segArb, { minLength: 0, maxLength: 2 })
  .map((segments) => segments.join("/"));

/** Normalize a directory path the same way the Directory API does. */
function toPrefix(path: string) {
  return path === "" ? "" : path + "/";
}

/** Keys strictly beneath `prefix` in the flat key set (no markers here). */
function expectedWalk(keys: string[], prefix: string) {
  return keys.filter((key) => key.startsWith(prefix) && key !== prefix);
}

/** Immediate children beneath `prefix`: file keys and collapsed sub-dir keys. */
function expectedImmediate(keys: string[], prefix: string) {
  const entries = new Set<string>();
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const remainder = key.slice(prefix.length);
    if (remainder === "") continue; // the directory marker itself, if any
    const slash = remainder.indexOf("/");
    if (slash === -1) {
      entries.add(key); // immediate file child
    } else {
      entries.add(prefix + remainder.slice(0, slash) + "/"); // sub-directory
    }
  }
  return entries;
}

test(
  "Feature: unified-storage-framework, Property 16 — directory operations are consistent over the flat key space",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        // A set of unique keys, each paired with arbitrary string content.
        fc.uniqueArray(fc.tuple(keyArb, fc.string()), {
          selector: ([key]) => key,
          minLength: 0,
          maxLength: 15,
        }),
        // An arbitrary directory path, possibly the root, possibly unrelated.
        dirArb,
        async (entries, dirPath) => {
          const storage = createStorage({ provider: "memory" });

          const keys = entries.map(([key]) => key);
          for (const [key, content] of entries) {
            await storage.put(key, content, {});
          }

          const prefix = toPrefix(dirPath);
          const under = expectedWalk(keys, prefix);

          // --- walk: exactly the keys beneath the prefix (15.4) -------------
          const walked = await storage.directory.walk(dirPath);
          const walkedSet = new Set(walked);
          assert.equal(
            walkedSet.size,
            walked.length,
            "walk returned duplicate keys",
          );
          assert.equal(walkedSet.size, under.length, "walk cardinality");
          for (const key of under) {
            assert.ok(walkedSet.has(key), `walk missing key: ${key}`);
          }
          for (const key of walked) {
            assert.ok(
              key.startsWith(prefix),
              `walk leaked key outside prefix: ${key}`,
            );
          }

          // --- listDirectory: exactly the immediate children (15.2) --------
          const listing = await storage.directory.listDirectory(dirPath);
          const listedKeys = listing.map((item) => item.key);
          const listedSet = new Set(listedKeys);
          assert.equal(
            listedSet.size,
            listedKeys.length,
            "listDirectory returned duplicate entries",
          );

          const expectedChildren = expectedImmediate(keys, prefix);
          assert.equal(
            listedSet.size,
            expectedChildren.size,
            "listDirectory cardinality",
          );
          for (const key of expectedChildren) {
            assert.ok(
              listedSet.has(key),
              `listDirectory missing child: ${key}`,
            );
          }
          for (const key of listedKeys) {
            assert.ok(
              key.startsWith(prefix) && key !== prefix,
              `listDirectory leaked entry outside prefix: ${key}`,
            );
          }

          // --- removeDirectory: removes exactly the keys beneath (15.3/15.6)
          const result = await storage.directory.removeDirectory(dirPath);
          assert.deepEqual(
            result,
            { removed: under.length > 0 },
            "removeDirectory removed flag",
          );

          // Nothing beneath the prefix survives; everything else is intact.
          assert.deepEqual(
            await storage.directory.walk(dirPath),
            [],
            "removeDirectory left keys beneath the prefix",
          );
          const remaining = new Set(await storage.directory.walk(""));
          const expectedRemaining = keys.filter((key) => !key.startsWith(prefix));
          assert.equal(remaining.size, expectedRemaining.length);
          for (const key of expectedRemaining) {
            assert.ok(
              remaining.has(key),
              `removeDirectory wrongly removed sibling: ${key}`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  },
);
