// Property-based test for the storage facade's multipart upload guarantee.
//
// Property 8 (Multipart equals a single upload): for arbitrary content split
// into arbitrary ordered parts, performing a multipart upload
// (`createMultipartUpload` → `uploadPart` for each part in order →
// `completeMultipartUpload`) produces an object whose bytes are exactly equal
// to a single `put` of the concatenation of those parts. Equality is checked
// both by the raw stored bytes and by the content checksum the drivers compute,
// so the multipart assembly path is proven observationally identical to the
// single-shot write path (Requirement 6.3). Both uploads run over the
// zero-dependency `memory` provider — the identical code path every provider
// shares — exercised via the public facade.
//
// Uses the Node.js built-in test runner (node:test) with fast-check for input
// generation, executed via `node --test dist/tests/*.test.js`. fast-check is
// configured with { numRuns: 100 } per the design's property-testing contract.
//
// Feature: unified-storage-framework, Property 8: Multipart equals a single upload
//
// Validates: Requirements 6.3, 26.5

import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import fc from "fast-check";

import { createStorage } from "../facade.js";

test(
  "Feature: unified-storage-framework, Property 8: Multipart equals a single upload",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        // A key for both objects and an arbitrary ordered list of parts. At
        // least one part is generated so there is always something to upload;
        // individual parts may be empty, exercising the assembly of zero-length
        // segments.
        fc.string(),
        fc.array(fc.uint8Array(), { minLength: 1, maxLength: 8 }),
        async (key, parts) => {
          // A fresh store per run keeps each key/parts pair independent.
          const storage = createStorage({ provider: "memory" });

          // The concatenation of the parts, in the order they will be uploaded,
          // is the exact byte sequence a single `put` would persist.
          const concatenated = Buffer.concat(parts.map((part) => Buffer.from(part)));

          // ── Multipart upload path ─────────────────────────────────────────
          const multipartKey = `${key}/multipart`;
          const uploadId = await storage.createMultipartUpload(multipartKey);
          const storedParts = [];
          for (let index = 0; index < parts.length; index += 1) {
            // Part numbers are 1-based positive integers assigned in order.
            const stored = await storage.uploadPart(uploadId, index + 1, parts[index]);
            storedParts.push(stored);
          }
          const multipartMeta = await storage.completeMultipartUpload(uploadId, storedParts);

          // ── Single upload path ────────────────────────────────────────────
          const singleKey = `${key}/single`;
          const singleMeta = await storage.put(singleKey, concatenated);

          // The assembled object must equal a single put of the concatenation,
          // both in raw bytes and in the computed content checksum.
          const multipartResult = await storage.get(multipartKey);
          const singleResult = await storage.get(singleKey);

          assert.equal(multipartResult.found, true);
          assert.equal(singleResult.found, true);
          assert.ok(multipartResult.bytes);
          assert.ok(singleResult.bytes);
          assert.deepEqual(
            Buffer.from(multipartResult.bytes),
            Buffer.from(singleResult.bytes),
          );
          assert.deepEqual(Buffer.from(multipartResult.bytes), concatenated);
          assert.equal(multipartMeta.checksum, singleMeta.checksum);
          assert.equal(multipartMeta.size, singleMeta.size);
        },
      ),
      { numRuns: 100 },
    );
  },
);
