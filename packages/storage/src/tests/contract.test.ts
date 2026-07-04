// Contract-conformance suite run against the two zero-dependency drivers.
//
// Exercises the shared, parameterized suite from `./contract.js` (task 27.1)
// against MemoryStorageDriver and LocalStorageDriver, verifying both directions
// it is consumed in production:
//
//   - as node:test cases via registerStorageDriverContractTests (what a driver's
//     own test file would do), and
//   - programmatically via runStorageDriverContract (what `storage:verify` and
//     Property 19 use), asserting the returned report passes for every check.
//
// Each check receives a freshly constructed driver from the supplied factory;
// the Local driver gets a fresh temp directory per instance so checks stay
// isolated. Executed via `node --test dist/tests/*.test.js`.
//
// Requirements: 2.1, 2.3, 2.4

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runStorageDriverContract,
  registerStorageDriverContractTests,
  storageDriverContractChecks,
} from "./contract.js";
import { MemoryStorageDriver } from "../drivers/memory.js";
import { LocalStorageDriver } from "../drivers/local.js";
import type { StorageDriver } from "../driver.js";

/** A fixed clock for deterministic timestamps. */
const fixedClock = () => 1_700_000_000_000;

/** Factory: a fresh in-memory driver per call. */
function makeMemoryDriver() {
  return new MemoryStorageDriver({ clock: fixedClock });
}

/** Temp roots allocated for Local drivers, cleaned up after the run. */
const tempRoots = [];

/** Factory: a fresh filesystem driver rooted at a unique temp dir per call. */
function makeLocalDriver() {
  const root = mkdtempSync(join(tmpdir(), "streetjs-storage-contract-"));
  tempRoots.push(root);
  return new LocalStorageDriver({ root, clock: fixedClock });
}

test.after(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── As node:test cases (per-driver, per-check) ────────────────────────────────

registerStorageDriverContractTests("memory driver contract", makeMemoryDriver, test);
registerStorageDriverContractTests("local driver contract", makeLocalDriver, test);

// ── Programmatically (the storage:verify / Property 19 consumption path) ──────

test("runStorageDriverContract reports a full pass for the memory driver", async () => {
  const report = await runStorageDriverContract(makeMemoryDriver);

  assert.equal(report.driver, "memory");
  assert.equal(report.passed, true);
  assert.equal(report.results.length, storageDriverContractChecks.length);
  assert.ok(
    report.results.every((result) => result.passed),
    `all checks must pass, got: ${JSON.stringify(report.results)}`,
  );
});

test("runStorageDriverContract reports a full pass for the local driver", async () => {
  const report = await runStorageDriverContract(makeLocalDriver);

  assert.equal(report.driver, "local");
  assert.equal(report.passed, true);
  assert.equal(report.results.length, storageDriverContractChecks.length);
  assert.ok(
    report.results.every((result) => result.passed),
    `all checks must pass, got: ${JSON.stringify(report.results)}`,
  );
});

test("a non-conforming driver is reported as failed, not thrown", async () => {
  // A driver that always reports a missing object exists violates the
  // not-found and round-trip checks; the runner must capture this as failures
  // rather than throwing.
  const brokenDriver = {
    name: "broken",
    async put(key, bytes) {
      return {
        key,
        size: bytes.byteLength,
        contentType: "application/octet-stream",
        etag: "x",
        checksum: "x",
        accessLevel: "private",
        createdAt: 0,
        updatedAt: 0,
        custom: {},
      };
    },
    async get() {
      return { found: false };
    },
    async exists() {
      return false;
    },
    async delete() {},
    async stat() {
      return null;
    },
    async list() {
      return [];
    },
    async putStream(key, _stream, _metadata) {
      return this.put(key, new Uint8Array());
    },
    async getStream() {
      throw new Error("unsupported");
    },
  };

  const report = await runStorageDriverContract(() => brokenDriver);

  assert.equal(report.driver, "broken");
  assert.equal(report.passed, false);
  // existence and byte round-trip must fail (get always reports not-found);
  // the two not-found checks and metadata shape still pass.
  const failed = report.results.filter((result) => !result.passed).map((r) => r.name);
  assert.ok(
    failed.some((name) => name.startsWith("existence")),
    "existence check should fail for the broken driver",
  );
  assert.ok(
    failed.some((name) => name.startsWith("byte round-trip")),
    "byte round-trip check should fail for the broken driver",
  );
});
