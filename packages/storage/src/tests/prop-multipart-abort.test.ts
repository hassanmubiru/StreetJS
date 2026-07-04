// Property-based test for the storage facade's multipart abort guarantee.
//
// Property 9 (Abort leaves no object): for an arbitrary key and an arbitrary
// list of parts uploaded via `createMultipartUpload` → `uploadPart` for each
// part, calling `abortMultipartUpload(uploadId)` discards every uploaded part
// and creates no completed object. After the abort the target key must not
// exist (`exists(key) === false`) and reading it must report not-found, so no
// leftover final object is ever produced by the aborted upload (Requirement
// 6.4). The abort path runs over the zero-dependency `memory` provider — the
// identical code path every provider shares — exercised via the public facade.
//
// Uses the Node.js built-in test runner (node:test) with fast-check for input
// generation, executed via `node --test dist/tests/*.test.js`. fast-check is
// configured with { numRuns: 100 } per the design's property-testing contract.
//
// Feature: unified-storage-framework, Property 9: Abort leaves no object
//
// Validates: Requirements 6.4

import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { createStorage } from "../index.js";

test(
  "Feature: unified-storage-framework, Property 9: Abort leaves no object",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        // An arbitrary target key for the multipart upload and an arbitrary
        // ordered list of parts. At least one part is generated so there is
        // always something to upload before aborting; individual parts may be
        // empty, exercising abort after zero-length segments.
        fc.string(),
        fc.array(fc.uint8Array(), { minLength: 1, maxLength: 8 }),
        async (key, parts) => {
          // A fresh store per run keeps each key/parts pair independent.
          const storage = createStorage({ provider: "memory" });

          // ── Upload parts, then abort ──────────────────────────────────────
          const uploadId = await storage.createMultipartUpload(key);
          for (let index = 0; index < parts.length; index += 1) {
            // Part numbers are 1-based positive integers assigned in order.
            await storage.uploadPart(uploadId, index + 1, parts[index]);
          }

          await storage.abortMultipartUpload(uploadId);

          // The aborted upload must create no completed object at the key: the
          // key must not exist and reading it must report not-found (no
          // leftover final object).
          assert.equal(
            await storage.exists(key),
            false,
            "aborted multipart upload must leave no object at the target key",
          );

          const result = await storage.get(key);
          assert.equal(
            result.found,
            false,
            "reading the target key after abort must report not-found",
          );

          await storage.close();
        },
      ),
      { numRuns: 100 },
    );
  },
);
