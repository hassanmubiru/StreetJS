// Property-based test: every available driver conforms to the StorageDriver contract.
//
// Property 19: Every available (zero-dependency) driver conforms to the shared
// StorageDriver contract. This reuses the parameterized contract-conformance
// suite from `./contract.js` (task 27.1) — `runStorageDriverContract` and
// `storageDriverContractChecks` — asserting the returned report passes for both
// the Memory and Local drivers.
//
// Because the contract checks use fixed internal keys, this property ALSO folds
// in a fast-check-generated round-trip assertion per driver over arbitrary
// key+byte inputs (put→get equals, exists→true, delete→exists false,
// get→found:false) so the property genuinely varies its inputs at
// { numRuns: 100 }. A fresh driver is constructed per run; each Local driver is
// rooted at a unique temp directory that is cleaned up after the run.
//
// Executed via the Node.js built-in test runner (`node --test dist/tests/*.test.js`).
//
// Feature: unified-storage-framework, Property 19
// Validates: Requirements 2.1, 2.3, 2.4, 26.6

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";

import {
  runStorageDriverContract,
  storageDriverContractChecks,
} from "./contract.js";
import { MemoryStorageDriver } from "../drivers/memory.js";
import { LocalStorageDriver } from "../drivers/local.js";

/** A fixed clock for deterministic timestamps. */
const fixedClock = () => 1_700_000_000_000;

/** Temp roots allocated for Local drivers, cleaned up after the run. */
const tempRoots: string[] = [];

/** Factory: a fresh in-memory driver per call. */
function makeMemoryDriver() {
  return new MemoryStorageDriver({ clock: fixedClock });
}

/** Factory: a fresh filesystem driver rooted at a unique temp dir per call. */
function makeLocalDriver() {
  const root = mkdtempSync(join(tmpdir(), "streetjs-storage-conformance-"));
  tempRoots.push(root);
  return new LocalStorageDriver({ root, clock: fixedClock });
}

/** The available zero-dependency drivers under test. */
const DRIVERS = [
  { label: "memory", make: makeMemoryDriver },
  { label: "local", make: makeLocalDriver },
];

/**
 * A generator over the domain of *valid object keys*.
 *
 * A key is generated as one or more non-empty path segments joined by `/`,
 * where each segment is drawn from a filesystem-safe character set and is never
 * the reserved relative-path names `.` or `..`. This deliberately excludes keys
 * that no real object store accepts as an object key and that the Local driver
 * (which maps keys onto filesystem paths) cannot represent equivalently to the
 * opaque-map Memory driver:
 *   - the empty string and empty segments (e.g. `""`, `"a//b"`),
 *   - a leading or trailing `/` (e.g. `"/a"`, `"a/"`),
 *   - the relative segments `"."` / `".."` (path traversal),
 *   - control characters such as NUL.
 * Such inputs resolve to an existing/invalid filesystem path (EISDIR / ENOTDIR
 * / ERR_INVALID_ARG_VALUE) on the Local driver while the Memory driver treats
 * them as opaque map keys — an out-of-domain divergence, not a driver defect.
 * This matches the valid-key domain the equivalence property (Property 18)
 * already documents for its curated key pool.
 */
const KEY_SEGMENT_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.".split("");
const segmentArb = fc
  .array(fc.constantFrom(...KEY_SEGMENT_CHARS), { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(""))
  .filter((segment) => segment !== "." && segment !== "..");
const keyArb = fc
  .array(segmentArb, { minLength: 1, maxLength: 4 })
  .map((segments) => segments.join("/"));

test.after(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "Feature: unified-storage-framework, Property 19 — every driver conforms to the StorageDriver contract",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        // A valid object key and arbitrary byte content drive an additional
        // round-trip so inputs genuinely vary across runs. See `keyArb` for why
        // the key domain excludes path-relative / empty-segment / control-char
        // keys that the two drivers cannot represent equivalently.
        keyArb,
        fc.uint8Array(),
        async (key, content) => {
          for (const { label, make } of DRIVERS) {
            // 1. The full contract-conformance suite must pass for the driver.
            const report = await runStorageDriverContract(make);
            assert.equal(
              report.passed,
              true,
              `${label} driver must conform to the contract, got: ${JSON.stringify(report.results)}`,
            );
            assert.equal(
              report.results.length,
              storageDriverContractChecks.length,
              `${label} driver must run every contract check`,
            );

            // 2. An input-varying round-trip on a fresh driver instance.
            const driver = await make();

            await driver.put(key, content, {});

            // put→get returns the exact stored bytes.
            const found = await driver.get(key);
            assert.equal(found.found, true, `${label}: get must find the stored key`);
            assert.ok(found.found === true, `${label}: result must be the found variant`);
            assert.deepEqual(
              found.bytes,
              content,
              `${label}: get must return the exact stored bytes`,
            );

            // exists reports presence.
            assert.equal(await driver.exists(key), true, `${label}: exists must be true after put`);

            // delete removes visibility.
            await driver.delete(key);
            assert.equal(
              await driver.exists(key),
              false,
              `${label}: exists must be false after delete`,
            );
            const missing = await driver.get(key);
            assert.equal(
              missing.found,
              false,
              `${label}: get must report not-found after delete`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  },
);
