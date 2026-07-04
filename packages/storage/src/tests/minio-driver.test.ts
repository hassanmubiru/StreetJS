// Unit tests for the MinIO driver submodule (task 28.4). MinIO speaks the S3 API
// against a self-hosted endpoint, so the driver is a thin specialization of the
// shared S3-style base. These tests exercise the injected-client path with an
// in-memory S3ClientLike double (no `minio` SDK, no external service), the
// StorageConfigError guard when no client is injected, and the shared driver
// contract-conformance suite.
//
// The SDK-building path (connectMinIODriver) uses a lazy dynamic import of the
// optional `minio` peer dependency; with the SDK absent it must throw
// StorageConfigError rather than a raw module-resolution error.
//
// Requirements: 2.1, 2.3, 3.3

import test from "node:test";
import assert from "node:assert/strict";

import { createMinIODriver, connectMinIODriver } from "../drivers/minio.js";
import { StorageConfigError } from "../errors.js";
import { registerStorageDriverContractTests } from "./contract.js";

const FIXED_NOW = 1_700_000_000_000;
const fixedClock = () => FIXED_NOW;

function bytes(str) {
  return new TextEncoder().encode(str);
}

/** A minimal in-memory S3ClientLike double, mirroring the s3-base test fake. */
function makeFakeClient() {
  const objects = new Map(); // key -> { body, contentType, metadata }
  return {
    async putObject({ key, body, contentType, metadata }) {
      objects.set(key, {
        body: body.slice(),
        contentType,
        metadata: metadata ? { ...metadata } : undefined,
      });
      return { etag: `"${key}-etag"` };
    },
    async getObject({ key }) {
      const obj = objects.get(key);
      if (obj === undefined) return null;
      return {
        body: obj.body.slice(),
        contentType: obj.contentType,
        etag: `"${key}-etag"`,
        size: obj.body.byteLength,
        lastModified: FIXED_NOW,
        metadata: obj.metadata,
      };
    },
    async headObject({ key }) {
      const obj = objects.get(key);
      if (obj === undefined) return null;
      return {
        contentType: obj.contentType,
        etag: `"${key}-etag"`,
        size: obj.body.byteLength,
        lastModified: FIXED_NOW,
        metadata: obj.metadata,
      };
    },
    async deleteObject({ key }) {
      objects.delete(key);
    },
    async listObjects({ prefix }) {
      return [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, obj]) => ({ key, size: obj.body.byteLength, updatedAt: FIXED_NOW }));
    },
  };
}

function makeDriver() {
  return createMinIODriver(makeFakeClient(), { clock: fixedClock });
}

// ── name / specialization ───────────────────────────────────────────────────

test("driver name is fixed to minio", () => {
  assert.equal(makeDriver().name, "minio");
});

test("name is not overridable through options", () => {
  // MinIODriverOptions omits `name`; even a stray value must not change it.
  const driver = createMinIODriver(makeFakeClient(), { clock: fixedClock, name: "s3" });
  assert.equal(driver.name, "minio");
});

// ── injected-client primitives round-trip via the base ───────────────────────

test("put/get round-trips bytes and typed metadata over the injected client", async () => {
  const driver = makeDriver();
  const content = bytes("minio object payload");

  await driver.put("bucketed/key.txt", content, {
    contentType: "text/plain",
    owner: "user-9",
    tenant: "tenant-z",
    accessLevel: "public",
    custom: { label: "report" },
  });

  const result = await driver.get("bucketed/key.txt");
  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, content);
  assert.equal(result.metadata.contentType, "text/plain");
  assert.equal(result.metadata.owner, "user-9");
  assert.equal(result.metadata.tenant, "tenant-z");
  assert.equal(result.metadata.accessLevel, "public");
  assert.deepEqual(result.metadata.custom, { label: "report" });
});

test("exists/delete/stat/list behave consistently", async () => {
  const driver = makeDriver();
  await driver.put("d/a.txt", bytes("a"), {});
  await driver.put("d/b.txt", bytes("bb"), {});

  assert.equal(await driver.exists("d/a.txt"), true);
  assert.equal(await driver.exists("d/missing.txt"), false);

  const stat = await driver.stat("d/b.txt");
  assert.equal(stat.size, 2);
  assert.equal(await driver.stat("d/missing.txt"), null);

  const items = await driver.list("d/");
  assert.deepEqual(items.map((i) => i.key), ["d/a.txt", "d/b.txt"]);

  await driver.delete("d/a.txt");
  assert.equal(await driver.exists("d/a.txt"), false);
});

test("get on a missing key reports found:false", async () => {
  const driver = makeDriver();
  const result = await driver.get("nope");
  assert.equal(result.found, false);
});

// ── configuration guards ──────────────────────────────────────────────────────

test("createMinIODriver throws StorageConfigError when no client is injected", () => {
  assert.throws(() => createMinIODriver(undefined), (err) => {
    assert.ok(err instanceof StorageConfigError);
    assert.equal(err.provider, "minio");
    return true;
  });
});

test("connectMinIODriver throws StorageConfigError when the minio SDK is absent", async () => {
  await assert.rejects(
    () =>
      connectMinIODriver({
        bucket: "b",
        endPoint: "127.0.0.1",
        accessKey: "ak",
        secretKey: "sk",
      }),
    (err) => {
      assert.ok(err instanceof StorageConfigError);
      assert.equal(err.provider, "minio");
      return true;
    },
  );
});

// ── shared contract-conformance suite ─────────────────────────────────────────

registerStorageDriverContractTests(
  "minio",
  () => createMinIODriver(makeFakeClient(), { clock: fixedClock }),
  test,
);
