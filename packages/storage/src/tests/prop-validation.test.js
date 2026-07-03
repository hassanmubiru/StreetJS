// Property-based test for the storage facade's validation pipeline guarantee.
//
// Property 12 (Validation rejects leave no partial object): a Storage instance
// configured with a size validator (`validation: { maxSize: N }`) must, for any
// upload whose byte length exceeds `N`, reject the `put` with a `ValidationError`
// AND leave no partial object behind (`exists(key)` is false afterward). For any
// upload within the limit, `put` succeeds and the object then exists. Because the
// facade runs the validation pipeline before any bytes reach the driver, a
// rejection can never persist content (Requirements 9.3, 9.4).
//
// Backed by the zero-dependency in-memory provider via `createStorage({
// provider: 'memory', validation: { maxSize } })`, exercised across arbitrary
// keys, byte contents, and size limits with fast-check at { numRuns: 100 }.
// Executed via the Node.js built-in test runner (`node --test dist/tests/*.test.js`).
//
// Feature: unified-storage-framework, Property 12
// Validates: Requirements 9.3, 9.4

import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { createStorage } from "../index.js";
import { ValidationError } from "../errors.js";

test(
  "Feature: unified-storage-framework, Property 12 — validation rejects leave no partial object",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        // Arbitrary non-empty keys and arbitrary byte contents.
        fc.string({ minLength: 1 }),
        fc.uint8Array(),
        // A non-negative size limit; chosen from a range that straddles typical
        // fast-check byte-array lengths so both accepted and rejected inputs are
        // generated across the 100 runs.
        fc.nat({ max: 16 }),
        async (key, content, maxSize) => {
          // A fresh store per run keeps each key/content pair independent.
          const storage = createStorage({
            provider: "memory",
            validation: { maxSize },
          });

          const violatesLimit = content.byteLength > maxSize;

          if (violatesLimit) {
            // The oversized upload must be rejected with a ValidationError...
            await assert.rejects(
              () => storage.put(key, content),
              (error) => error instanceof ValidationError,
            );
            // ...and must leave no partial object stored.
            assert.equal(await storage.exists(key), false);
          } else {
            // A within-limit upload succeeds and the object then exists.
            await storage.put(key, content);
            assert.equal(await storage.exists(key), true);
          }
        },
      ),
      { numRuns: 100 },
    );
  },
);
