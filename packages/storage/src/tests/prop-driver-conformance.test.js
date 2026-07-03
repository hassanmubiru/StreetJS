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
const tempRoots = [];

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
        // Arbitrary non-empty key and arbitrary byte content drive an
        // additional round-trip so inputs genuinely vary across runs.
        fc.string({ minLength: 1 }),
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
