// Property-based test for the storage facade metadata round-trip guarantee.
//
// Feature: unified-storage-framework, Property 5: Metadata round-trips through
// write and read.
//
// For arbitrary keys, byte contents, and write-time metadata (contentType,
// owner, tenant, accessLevel, and custom fields), after `put(key, bytes,
// options)` followed by `stat(key)` (and `get(key)`):
//   - the write-supplied fields on the returned metadata equal what was written
//     (owner/tenant/custom exactly; contentType/accessLevel fall back to the
//     canonical defaults when the write omits them), and
//   - the computed fields (size, checksum, etag, createdAt, updatedAt) are all
//     present and consistent with the persisted content.
//
// Uses the Node.js built-in test runner (node:test) and fast-check at
// `{ numRuns: 100 }`, exercising the public facade via
// `createStorage({ provider: 'memory' })` with a fixed clock so timestamps are
// deterministic. Executed via `node --test dist/tests/*.test.js`.
//
// Validates: Requirements 10.2, 26.4

import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { createStorage } from "../facade.js";
import { DEFAULT_ACCESS_LEVEL, DEFAULT_CONTENT_TYPE } from "../metadata.js";
import type { AccessLevel } from "../types.js";

/** A fixed clock so object timestamps are deterministic across runs. */
const fixedClock = () => 1_700_000_000_000;

/** The valid AccessLevel values (Requirement 11.1). */
const ACCESS_LEVELS: AccessLevel[] = [
  "public",
  "private",
  "signed",
  "authenticated",
  "role-based",
  "tenant-aware",
];

/** Arbitrary object content (including empty), persisted as a Uint8Array. */
const contentArb = fc.uint8Array({ minLength: 0, maxLength: 256 });

/** Non-empty object keys. */
const keyArb = fc.string({ minLength: 1, maxLength: 40 });

/**
 * Arbitrary custom metadata map with comparable JSON-ish values so it can be
 * asserted to round-trip exactly via deepEqual.
 */
const customArb = fc.dictionary(
  fc.string({ maxLength: 20 }),
  fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  { maxKeys: 5 },
);

/**
 * Arbitrary write-time metadata. Each field is optional (may be absent) so the
 * property covers both explicitly-supplied values and the default fallbacks.
 */
const writeMetadataArb = fc.record(
  {
    contentType: fc.string({ minLength: 1, maxLength: 40 }),
    owner: fc.string({ minLength: 1, maxLength: 40 }),
    tenant: fc.string({ minLength: 1, maxLength: 40 }),
    accessLevel: fc.constantFrom(...ACCESS_LEVELS),
    custom: customArb,
  },
  { requiredKeys: [] },
);

test("Feature: unified-storage-framework, Property 5: Metadata round-trips through write and read", async () => {
  await fc.assert(
    fc.asyncProperty(keyArb, contentArb, writeMetadataArb, async (key, content, write) => {
      // A fresh store per case keeps each key/content pair independent.
      const storage = createStorage({ provider: "memory", clock: fixedClock });

      const putMeta = await storage.put(key, content, write);
      const statMeta = await storage.stat(key);
      const getResult = await storage.get(key);

      assert.notEqual(statMeta, null, "stat must return metadata for a written key");
      assert.equal(getResult.found, true, "get must find a written key");

      // The write-supplied fields must equal what was written on every surface
      // that returns metadata (put, stat, get).
      for (const meta of [putMeta, statMeta, getResult.metadata]) {
        assert.equal(meta.owner, write.owner, "owner must round-trip");
        assert.equal(meta.tenant, write.tenant, "tenant must round-trip");
        assert.equal(
          meta.contentType,
          write.contentType ?? DEFAULT_CONTENT_TYPE,
          "contentType must round-trip (or fall back to the default)",
        );
        assert.equal(
          meta.accessLevel,
          write.accessLevel ?? DEFAULT_ACCESS_LEVEL,
          "accessLevel must round-trip (or fall back to the default)",
        );
        assert.deepEqual(
          meta.custom,
          write.custom ?? {},
          "custom fields must round-trip (or default to {})",
        );

        // The computed fields must be present and consistent with the content.
        assert.equal(meta.size, content.byteLength, "size must equal the content byte length");
        assert.equal(typeof meta.checksum, "string", "checksum must be present");
        assert.ok(meta.checksum.length > 0, "checksum must be non-empty");
        assert.equal(typeof meta.etag, "string", "etag must be present");
        assert.ok(meta.etag.length > 0, "etag must be non-empty");
        assert.equal(typeof meta.createdAt, "number", "createdAt must be present");
        assert.equal(typeof meta.updatedAt, "number", "updatedAt must be present");
      }

      await storage.close();
    }),
    { numRuns: 100 },
  );
});
