// Property-based test: Memory and Local drivers are observationally equivalent.
//
// Property 18 (Memory and Local drivers are observationally equivalent): for an
// arbitrary sequence of object operations (put/get/exists/delete/list/stat)
// applied identically to a `MemoryStorageDriver` and a `LocalStorageDriver`
// (both constructed with the SAME injected fixed clock, the Local driver bound
// to a fresh temp dir), the observable results are equivalent at every step —
// object existence, content bytes, and returned metadata (contentType, size,
// checksum, etag, accessLevel, owner, tenant, custom). The two zero-dependency
// drivers are interchangeable, so the same generated op sequence must produce
// the same observations on both.
//
// Uses the Node.js built-in test runner (node:test) with fast-check for input
// generation, executed via `node --test dist/tests/*.test.js`. fast-check is
// configured with { numRuns: 100 } per the design's property-testing contract.
//
// Feature: unified-storage-framework, Property 18: Memory and Local drivers are observationally equivalent
//
// Validates: Requirements 2.2, 26.6

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import fc from "fast-check";

import { MemoryStorageDriver } from "../drivers/memory.js";
import { LocalStorageDriver } from "../drivers/local.js";
import type { StorageDriver } from "../driver.js";
import type { AccessLevel, ListOptions, StorageObjectMetadata, WriteMetadata } from "../types.js";

/** One generated object operation applied identically to both drivers. */
type Op =
  | { readonly type: "put"; readonly key: string; readonly bytes: Uint8Array; readonly meta: WriteMetadata }
  | { readonly type: "get"; readonly key: string }
  | { readonly type: "exists"; readonly key: string }
  | { readonly type: "delete"; readonly key: string }
  | { readonly type: "stat"; readonly key: string }
  | { readonly type: "list"; readonly prefix: string; readonly options?: ListOptions };

/** A fixed clock so both drivers stamp identical timestamps for the same op. */
const fixedClock = () => 1_700_000_000_000;

/** The valid AccessLevel values (Requirement 11.1). */
const ACCESS_LEVELS: readonly AccessLevel[] = [
  "public",
  "private",
  "signed",
  "authenticated",
  "role-based",
  "tenant-aware",
];

/**
 * A fixed pool of filesystem-safe keys. No key is a directory-component prefix
 * of another (e.g. there is never both a file `docs` and a file `docs/x`), so
 * the Local driver's on-disk layout can represent any subset the op sequence
 * touches without a file/directory collision — keeping the two drivers on equal
 * footing for the observable behavior under test.
 */
const KEYS = [
  "alpha.txt",
  "beta.txt",
  "docs/one.txt",
  "docs/two.txt",
  "docs/sub/three.txt",
  "images/a.png",
  "images/b.png",
];

/** Prefixes exercised by `list`, including the empty (match-all) prefix. */
const PREFIXES = ["", "docs/", "docs/sub/", "images/", "alpha.txt", "doc", "images/a.png"];

const keyArb = fc.constantFrom(...KEYS);
const contentArb = fc.uint8Array({ minLength: 0, maxLength: 64 });

/** Custom metadata with JSON-round-trippable values so it can compare exactly. */
const customArb = fc.dictionary(
  fc.string({ maxLength: 12 }),
  fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  { maxKeys: 4 },
);

/** Arbitrary write-time metadata; every field optional to cover the defaults. */
const writeMetadataArb = fc.record(
  {
    contentType: fc.string({ minLength: 1, maxLength: 30 }),
    owner: fc.string({ minLength: 1, maxLength: 30 }),
    tenant: fc.string({ minLength: 1, maxLength: 30 }),
    accessLevel: fc.constantFrom(...ACCESS_LEVELS),
    custom: customArb,
  },
  { requiredKeys: [] },
);

/** Optional list options; both drivers implement these identically. */
const listOptionsArb = fc.record(
  {
    limit: fc.integer({ min: 1, max: 5 }),
    cursor: fc.constantFrom(...KEYS),
    delimiter: fc.boolean(),
  },
  { requiredKeys: [] },
);

/** A single object operation applied identically to both drivers. */
const operationArb = fc.oneof(
  fc.record({ type: fc.constant("put"), key: keyArb, bytes: contentArb, meta: writeMetadataArb }),
  fc.record({ type: fc.constant("get"), key: keyArb }),
  fc.record({ type: fc.constant("exists"), key: keyArb }),
  fc.record({ type: fc.constant("delete"), key: keyArb }),
  fc.record({ type: fc.constant("stat"), key: keyArb }),
  fc.record({ type: fc.constant("list"), prefix: fc.constantFrom(...PREFIXES), options: listOptionsArb }),
);

const sequenceArb = fc.array(operationArb, { minLength: 1, maxLength: 30 });

/**
 * Project a metadata record onto the observable field set the property compares.
 * `owner`/`tenant` collapse absent-vs-undefined to `null` so a driver that
 * persists metadata through JSON (which drops `undefined` keys) compares equal
 * to one that keeps the key present with an `undefined` value.
 */
function projectMetadata(meta) {
  if (meta === null || meta === undefined) {
    return null;
  }
  return {
    key: meta.key,
    size: meta.size,
    contentType: meta.contentType,
    checksum: meta.checksum,
    etag: meta.etag,
    accessLevel: meta.accessLevel,
    owner: meta.owner ?? null,
    tenant: meta.tenant ?? null,
    // Spread into a plain object so a null-prototype custom map (as produced by
    // fast-check's dictionary generator and kept verbatim by the in-memory
    // driver) compares equal by content to the plain object the Local driver
    // reconstructs from its JSON sidecar. The observable custom fields are the
    // key/value pairs, not the object's internal prototype tag.
    custom: { ...(meta.custom ?? {}) },
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

/** Apply one operation to a driver and return its canonical observation. */
async function applyOp(driver, op) {
  switch (op.type) {
    case "put": {
      const meta = await driver.put(op.key, op.bytes, op.meta);
      return { type: "put", meta: projectMetadata(meta) };
    }
    case "get": {
      const result = await driver.get(op.key);
      return {
        type: "get",
        found: result.found,
        bytes: result.found ? Array.from(result.bytes) : null,
        meta: result.found ? projectMetadata(result.metadata) : null,
      };
    }
    case "exists": {
      return { type: "exists", exists: await driver.exists(op.key) };
    }
    case "delete": {
      await driver.delete(op.key);
      return { type: "delete" };
    }
    case "stat": {
      return { type: "stat", meta: projectMetadata(await driver.stat(op.key)) };
    }
    case "list": {
      const items = await driver.list(op.prefix, op.options);
      return {
        type: "list",
        items: items.map((item) => ({ key: item.key, size: item.size, updatedAt: item.updatedAt })),
      };
    }
    default:
      throw new Error(`unknown op type: ${op.type}`);
  }
}

test(
  "Feature: unified-storage-framework, Property 18: Memory and Local drivers are observationally equivalent",
  async () => {
    await fc.assert(
      fc.asyncProperty(sequenceArb, async (operations) => {
        // Fresh temp dir + fresh drivers per run keep every sequence independent.
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "streetjs-driver-equiv-"));
        const memory = new MemoryStorageDriver({ clock: fixedClock });
        const local = new LocalStorageDriver({ root, clock: fixedClock });

        try {
          for (let i = 0; i < operations.length; i++) {
            const op = operations[i];
            const memObs = await applyOp(memory, op);
            const localObs = await applyOp(local, op);

            assert.deepEqual(
              localObs,
              memObs,
              `observation diverged at step ${i} for op ${JSON.stringify(op.type)} (key=${op.key ?? op.prefix})`,
            );
          }
        } finally {
          await fs.rm(root, { recursive: true, force: true });
        }
      }),
      { numRuns: 100 },
    );
  },
);
