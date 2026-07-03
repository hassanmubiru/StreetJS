/**
 * @streetjs/storage — the shared, parameterized contract-conformance suite.
 *
 * Requirement 2 states that every provider implements one `StorageDriver`
 * contract with identical observable behavior: object existence, content bytes,
 * and returned metadata must be equivalent across drivers (Requirement 2.1,
 * 2.3), and a missing key must be reported the same way everywhere
 * (Requirement 2.4). This module encodes the observable core of that contract
 * as a **reusable, driver-agnostic conformance suite** so the exact same checks
 * can be run against any {@link StorageDriver} — the zero-dependency Memory and
 * Local drivers, the in-process testing doubles, and every cloud driver.
 *
 * The suite is designed to be consumed in two ways from one definition:
 *
 * - **Programmatically** (returns pass/fail results). {@link runStorageDriverContract}
 *   runs every check against a freshly constructed driver and returns a
 *   {@link ContractReport} describing which checks passed. This is what the
 *   `storage:verify` CLI command (task 24.2) uses to report whether the
 *   configured driver satisfies the contract, and what Property 19 (task 27.3)
 *   uses to assert that every driver conforms.
 * - **As node:test tests**. {@link registerStorageDriverContractTests} turns each
 *   check into a `node:test` case using a caller-supplied `test` function, so a
 *   thin `*.test.js` can run the suite against Memory + Local without this
 *   support module importing `node:test` itself (keeping it importable from the
 *   CLI, which has no test runner in scope).
 *
 * Each check receives its **own freshly constructed driver** (from the supplied
 * factory) so checks are fully isolated and order-independent. Assertions use
 * `node:assert/strict`; a check throws on failure and returns normally on
 * success. The checked behaviors are:
 *
 * 1. **existence** — `put` then `exists(key)` is `true`; `exists(other)` is `false`.
 * 2. **byte round-trip** — `put(key, bytes)` then `get(key)` yields
 *    `{ found: true }` with content bytes exactly equal to the input.
 * 3. **not-found (get)** — `get(missing)` yields `{ found: false }`.
 * 4. **not-found (stat)** — `stat(missing)` yields `null`.
 * 5. **metadata shape** — `put` returns the complete typed
 *    {@link StorageObjectMetadata} field set with correctly typed values.
 *
 * This module is a support module under `src/tests/` (not itself a `*.test.js`
 * picked up by the default test glob); it is imported by tests and by the CLI.
 *
 * _Requirements: 2.1, 2.3, 2.4_
 */

import assert from "node:assert/strict";

import type { StorageDriver } from "../driver.js";
import { STORAGE_METADATA_FIELDS } from "../metadata.js";
import type { AccessLevel, StorageObjectMetadata } from "../types.js";

// ── Public result/report shapes ───────────────────────────────────────────────

/**
 * A single named conformance check. {@link run} performs the check against the
 * supplied driver and throws (via `node:assert`) when the driver violates the
 * contract; it returns normally when the check passes.
 */
export interface ContractCheck {
  /** Stable, human-readable check name (e.g. "byte round-trip"). */
  readonly name: string;
  /** The acceptance-criteria reference this check exercises. */
  readonly requirement: string;
  /** Run the check against `driver`; throws on violation. */
  run(driver: StorageDriver): Promise<void>;
}

/** The outcome of running a single {@link ContractCheck}. */
export interface ContractCheckResult {
  readonly name: string;
  readonly requirement: string;
  readonly passed: boolean;
  /** The failure message when {@link passed} is `false`. */
  readonly error?: string;
}

/** The aggregate outcome of running the whole suite against one driver. */
export interface ContractReport {
  /** The `name` of the driver under test (e.g. "memory", "local", "s3"). */
  readonly driver: string;
  /** `true` when every check passed. */
  readonly passed: boolean;
  /** Per-check results, in suite order. */
  readonly results: readonly ContractCheckResult[];
}

/**
 * Produces a fresh {@link StorageDriver} to test. A new instance is requested
 * for each check so the checks are isolated from one another; the factory may
 * be async (e.g. to allocate a temp directory for the Local driver).
 */
export type StorageDriverFactory = () => StorageDriver | Promise<StorageDriver>;

/**
 * A minimal `node:test`-style runner: a function taking a test name and an async
 * body. Callers pass `test` from `node:test`; typing it structurally keeps this
 * module free of a hard `node:test` import so it stays importable from the CLI.
 */
export type TestRunner = (name: string, fn: () => void | Promise<void>) => unknown;

// ── Test fixtures ─────────────────────────────────────────────────────────────

/** Encode a UTF-8 string into a Uint8Array for storage. */
function bytesOf(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** The full set of access levels, used to validate the `accessLevel` field. */
const ACCESS_LEVELS: readonly AccessLevel[] = [
  "public",
  "private",
  "signed",
  "authenticated",
  "role-based",
  "tenant-aware",
];

/**
 * Assert that `metadata` carries the complete typed {@link StorageObjectMetadata}
 * field set with correctly typed values. Uses {@link STORAGE_METADATA_FIELDS} as
 * the single source of truth for the required field names so this check tracks
 * the canonical shape automatically (Requirement 2.1, 10.1).
 */
function assertMetadataShape(
  metadata: StorageObjectMetadata,
  expected: { readonly key: string; readonly size: number },
): void {
  assert.ok(
    metadata !== null && typeof metadata === "object",
    "put must return a metadata object",
  );

  // Every canonical field must be present as an own key.
  for (const field of STORAGE_METADATA_FIELDS) {
    assert.ok(field in metadata, `metadata is missing required field "${field}"`);
  }

  // Identity / value fields must be correctly typed.
  assert.equal(metadata.key, expected.key, "metadata.key must equal the stored key");
  assert.equal(metadata.size, expected.size, "metadata.size must equal the byte length");
  assert.equal(typeof metadata.contentType, "string", "metadata.contentType must be a string");
  assert.equal(typeof metadata.etag, "string", "metadata.etag must be a string");
  assert.equal(typeof metadata.checksum, "string", "metadata.checksum must be a string");
  assert.equal(typeof metadata.createdAt, "number", "metadata.createdAt must be a number");
  assert.equal(typeof metadata.updatedAt, "number", "metadata.updatedAt must be a number");
  assert.ok(
    metadata.custom !== null && typeof metadata.custom === "object",
    "metadata.custom must be an object",
  );
  assert.ok(
    ACCESS_LEVELS.includes(metadata.accessLevel),
    `metadata.accessLevel must be a valid AccessLevel (got "${metadata.accessLevel}")`,
  );

  // owner/tenant are optional: absent (undefined) or a string.
  if (metadata.owner !== undefined) {
    assert.equal(typeof metadata.owner, "string", "metadata.owner must be a string when present");
  }
  if (metadata.tenant !== undefined) {
    assert.equal(typeof metadata.tenant, "string", "metadata.tenant must be a string when present");
  }
}

// ── The checks ────────────────────────────────────────────────────────────────

/**
 * The ordered set of observable-behavior checks that make up the driver
 * contract-conformance suite. Exported so consumers can inspect, subset, or
 * extend the list; most callers use {@link runStorageDriverContract} or
 * {@link registerStorageDriverContractTests} instead.
 */
export const storageDriverContractChecks: readonly ContractCheck[] = [
  {
    name: "existence: put then exists reports presence and absence",
    requirement: "2.1",
    async run(driver): Promise<void> {
      const key = "contract/existence.txt";
      assert.equal(
        await driver.exists(key),
        false,
        "exists must be false before the object is stored",
      );
      await driver.put(key, bytesOf("present"), {});
      assert.equal(await driver.exists(key), true, "exists must be true after put");
      assert.equal(
        await driver.exists("contract/never-written.txt"),
        false,
        "exists must be false for an unrelated key",
      );
    },
  },
  {
    name: "byte round-trip: get returns the stored bytes unchanged",
    requirement: "2.1",
    async run(driver): Promise<void> {
      const key = "contract/round-trip.bin";
      // Include boundary byte values so a lossy round-trip is caught.
      const content = new Uint8Array([0, 1, 127, 128, 254, 255, 65, 66, 67]);
      await driver.put(key, content, {});

      const result = await driver.get(key);
      assert.equal(result.found, true, "get must report found:true for a stored key");
      assert.ok(result.found === true, "narrowing: result must be the found variant");
      assert.deepEqual(result.bytes, content, "get must return the exact stored bytes");
    },
  },
  {
    name: "not-found (get): missing key reports found:false",
    requirement: "2.4",
    async run(driver): Promise<void> {
      const result = await driver.get("contract/absent-get.txt");
      assert.equal(result.found, false, "get on a missing key must report found:false");
      assert.ok(
        result.found === false,
        "the not-found result must be the { found: false } variant",
      );
    },
  },
  {
    name: "not-found (stat): missing key reports null",
    requirement: "2.4",
    async run(driver): Promise<void> {
      const meta = await driver.stat("contract/absent-stat.txt");
      assert.equal(meta, null, "stat on a missing key must return null");
    },
  },
  {
    name: "metadata shape: put returns the complete typed field set",
    requirement: "2.1",
    async run(driver): Promise<void> {
      const key = "contract/metadata-shape.txt";
      const content = bytesOf("shape check");
      const metadata = await driver.put(key, content, {
        contentType: "text/plain",
        owner: "user-1",
        tenant: "tenant-a",
        accessLevel: "public",
        custom: { label: "invoice" },
      });
      assertMetadataShape(metadata, { key, size: content.byteLength });
    },
  },
];

// ── Programmatic runner ───────────────────────────────────────────────────────

/** Options for {@link runStorageDriverContract}. */
export interface RunContractOptions {
  /** Override the checks to run. Defaults to {@link storageDriverContractChecks}. */
  readonly checks?: readonly ContractCheck[];
}

/**
 * Run the contract-conformance suite against a driver and return a pass/fail
 * {@link ContractReport}. Each check is executed against a freshly constructed
 * driver from `makeDriver` so the checks never interfere with one another.
 *
 * This never throws for a contract violation — a failing check is captured as a
 * `passed: false` entry with its error message — so a consumer such as the
 * `storage:verify` CLI (task 24.2) can render every result. Property 19
 * (task 27.3) uses the returned {@link ContractReport.passed} to assert
 * conformance across drivers.
 *
 * @param makeDriver Factory producing a fresh driver for each check.
 * @param options Optional override of the checks to run.
 */
export async function runStorageDriverContract(
  makeDriver: StorageDriverFactory,
  options?: RunContractOptions,
): Promise<ContractReport> {
  const checks = options?.checks ?? storageDriverContractChecks;
  const results: ContractCheckResult[] = [];
  let driverName = "unknown";

  for (const check of checks) {
    const driver = await makeDriver();
    driverName = driver.name;
    try {
      await check.run(driver);
      results.push({ name: check.name, requirement: check.requirement, passed: true });
    } catch (error) {
      results.push({
        name: check.name,
        requirement: check.requirement,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    driver: driverName,
    passed: results.every((result) => result.passed),
    results,
  };
}

// ── node:test integration ─────────────────────────────────────────────────────

/**
 * Register each contract check as an individual `node:test` case using the
 * supplied `test` runner. A thin `*.test.js` passes `test` from `node:test` and
 * a driver factory; each check runs against a fresh driver and fails the test if
 * the driver violates the contract.
 *
 * Taking the runner as a parameter keeps this module free of a hard `node:test`
 * import, so it remains importable from non-test contexts (e.g. the CLI's
 * `storage:verify`).
 *
 * @param label Prefix for each generated test name (e.g. the driver label).
 * @param makeDriver Factory producing a fresh driver for each check.
 * @param runner The `test` function from `node:test` (or a compatible runner).
 * @param checks Optional override of the checks to run.
 */
export function registerStorageDriverContractTests(
  label: string,
  makeDriver: StorageDriverFactory,
  runner: TestRunner,
  checks: readonly ContractCheck[] = storageDriverContractChecks,
): void {
  for (const check of checks) {
    runner(`${label}: ${check.name}`, async () => {
      const driver = await makeDriver();
      await check.run(driver);
    });
  }
}
