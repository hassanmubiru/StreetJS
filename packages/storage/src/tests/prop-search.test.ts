// Property-based test for the storage facade `search(filters)` operation.
//
// Feature: unified-storage-framework, Property 15 — Search returns exactly the
// matching objects. For an arbitrary set of stored objects (with varied
// owner/tenant/contentType/size/custom metadata) and an arbitrary combination
// of SearchFilters, `storage.search(filters)` returns EXACTLY the set of
// objects that satisfy EVERY supplied filter (conjunctive / AND semantics):
// no matching object is missing and no non-matching object is included. When
// no object satisfies the filters, the result is the empty set.
//
// The expected set is computed independently of the implementation and
// compared for exact set equality.
//
// Uses the public facade via `createStorage({ provider: 'memory' })`, the
// Node.js built-in test runner (node:test), and fast-check configured with
// { numRuns: 100 }. Executed via `node --test dist/tests/*.test.js`.
//
// Validates: Requirements 16.2, 16.3

import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createStorage } from "../index.js";
import type { SearchFilters } from "../types.js";

/** The generated object shape stored and evaluated by the reference filter. */
interface GeneratedObject {
  key: string;
  content: string;
  owner: string | undefined;
  tenant: string | undefined;
  contentType: string;
  category: string | undefined;
}

// UTF-8 byte length, matching how the facade encodes string payloads before
// the driver records `size`.
const byteSize = (content: string) => new TextEncoder().encode(content).length;

// Domains kept small so filters match frequently, exercising both the
// "matches" and "excludes nothing/everything" branches.
const ownerArb = fc.option(fc.constantFrom("alice", "bob"), { nil: undefined });
const tenantArb = fc.option(fc.constantFrom("acme", "globex"), { nil: undefined });
const contentTypeArb = fc.constantFrom("image/jpeg", "image/png", "text/plain");
const categoryArb = fc.option(fc.constantFrom("invoice", "receipt"), { nil: undefined });

// Keys drawn from a small alphabet so shared prefixes arise often. The alphabet
// excludes '.', so no key collides with the reserved internal key spaces.
const keyArb = fc.stringMatching(/^[a-c/]{1,6}$/).filter((k) => k.length > 0);

// An object to store: a key, content (whose byte length gives size), and
// varied metadata.
const objectArb = fc.record({
  key: keyArb,
  content: fc.string({ maxLength: 6 }),
  owner: ownerArb,
  tenant: tenantArb,
  contentType: contentTypeArb,
  category: categoryArb,
});

// Arbitrary SearchFilters. Every field is optional (undefined => no
// constraint). Filter domains deliberately include values that may match
// nothing (e.g. owner "carol") so the empty-result case is covered.
const filtersArb = fc.record({
  prefix: fc.option(fc.stringMatching(/^[a-c/]{0,3}$/), { nil: undefined }),
  contentType: fc.option(fc.constantFrom("image/jpeg", "image/png", "text/plain", "application/pdf"), {
    nil: undefined,
  }),
  owner: fc.option(fc.constantFrom("alice", "bob", "carol"), { nil: undefined }),
  tenant: fc.option(fc.constantFrom("acme", "globex", "initech"), { nil: undefined }),
  minSize: fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
  maxSize: fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
  metadata: fc.option(fc.constantFrom({ category: "invoice" }, { category: "receipt" }), {
    nil: undefined,
  }),
});

// Independent reference implementation of the AND-semantics filter, evaluated
// against the known write-time metadata of a stored object.
function satisfies(obj, filters) {
  const size = byteSize(obj.content);
  const custom = obj.category !== undefined ? { category: obj.category } : {};

  if (filters.prefix !== undefined && !obj.key.startsWith(filters.prefix)) return false;
  if (filters.contentType !== undefined && obj.contentType !== filters.contentType) return false;
  if (filters.owner !== undefined && obj.owner !== filters.owner) return false;
  if (filters.tenant !== undefined && obj.tenant !== filters.tenant) return false;
  if (filters.minSize !== undefined && size < filters.minSize) return false;
  if (filters.maxSize !== undefined && size > filters.maxSize) return false;
  if (filters.metadata !== undefined) {
    for (const [field, value] of Object.entries(filters.metadata)) {
      if (custom[field] !== value) return false;
    }
  }
  return true;
}

test(
  "Feature: unified-storage-framework, Property 15 — search returns exactly the matching objects",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(objectArb, {
          selector: (obj) => obj.key,
          minLength: 0,
          maxLength: 12,
        }),
        filtersArb,
        async (objects, filters) => {
          const storage = createStorage({ provider: "memory" });

          for (const obj of objects) {
            const metadata = {
              contentType: obj.contentType,
            };
            if (obj.owner !== undefined) metadata.owner = obj.owner;
            if (obj.tenant !== undefined) metadata.tenant = obj.tenant;
            if (obj.category !== undefined) metadata.custom = { category: obj.category };
            await storage.put(obj.key, obj.content, metadata);
          }

          const result = await storage.search(filters);
          const observed = new Set(result.map((item) => item.key));

          // Expected: exactly the stored keys whose object satisfies every filter.
          const expected = new Set(
            objects.filter((obj) => satisfies(obj, filters)).map((obj) => obj.key),
          );

          // Exact set equality: same cardinality + same membership (no extras,
          // none missing). An empty expected set implies an empty result.
          assert.equal(
            observed.size,
            expected.size,
            `size mismatch: observed ${[...observed]} vs expected ${[...expected]}`,
          );
          for (const key of expected) {
            assert.ok(observed.has(key), `missing matching key: ${key}`);
          }
          for (const key of observed) {
            assert.ok(expected.has(key), `unexpected non-matching key: ${key}`);
          }
        },
      ),
      { numRuns: 100 },
    );
  },
);
