// Property-based test for the storage facade `list(prefix)` operation.
//
// Feature: unified-storage-framework, Property 6 — List returns exactly the
// prefix-matching keys. For an arbitrary set of stored objects and an arbitrary
// prefix, `list(prefix)` returns exactly the set of stored keys that begin with
// that prefix: no key that starts with the prefix is missing, and no key that
// does not start with the prefix is included.
//
// Uses the public facade via `createStorage({ provider: 'memory' })`, the
// Node.js built-in test runner (node:test), and fast-check configured with
// { numRuns: 100 }. Executed via `node --test dist/tests/*.test.js`.
//
// Validates: Requirements 4.9

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createStorage } from "../index.js";

// A key generator that produces non-empty keys drawn from a small alphabet so
// that shared prefixes arise frequently, exercising the prefix-matching logic
// on both matching and non-matching keys.
const keyArb = fc.stringMatching(/^[a-c/]{1,6}$/).filter((k) => k.length > 0);

test(
  "Feature: unified-storage-framework, Property 6 — list returns exactly the prefix-matching keys",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        // A set of unique keys, each paired with arbitrary string content.
        fc.uniqueArray(fc.tuple(keyArb, fc.string()), {
          selector: ([key]) => key,
          minLength: 0,
          maxLength: 12,
        }),
        // An arbitrary prefix, possibly empty, possibly unrelated to any key.
        fc.stringMatching(/^[a-c/]{0,4}$/),
        async (entries, prefix) => {
          const storage = createStorage({ provider: "memory" });

          for (const [key, content] of entries) {
            await storage.put(key, content, {});
          }

          const listed = await storage.list(prefix);

          // Observed keys returned by list(prefix).
          const observed = new Set(listed.map((item) => item.key));

          // Expected keys: exactly the stored keys that start with the prefix.
          const expected = new Set(
            entries
              .map(([key]) => key)
              .filter((key) => key.startsWith(prefix)),
          );

          // Same cardinality and same membership => exactly equal sets.
          assert.equal(observed.size, expected.size);
          for (const key of expected) {
            assert.ok(observed.has(key), `expected listed key: ${key}`);
          }
          for (const key of observed) {
            assert.ok(
              key.startsWith(prefix),
              `unexpected non-matching key listed: ${key}`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  },
);
