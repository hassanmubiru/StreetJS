// Unit tests for the Amazon S3 provider submodule (task 28.2), exercised through
// the built `dist/drivers/s3.js` entry that backs `@streetjs/storage/s3`.
//
// The submodule contributes only client wiring on top of the shared S3-style
// base; its own responsibilities are:
//   - createS3StorageDriver wraps an injected S3ClientLike as a name:"s3" driver
//     and delegates the whole StorageDriver contract to the base
//   - createS3StorageDriver rejects a missing/invalid client with a descriptive
//     StorageConfigError (no SDK is ever loaded on the injected path)
//   - createS3StorageDriverFromConfig wraps a supplied client without loading any
//     SDK, and throws a descriptive StorageConfigError when it must build a
//     client but the optional @aws-sdk/client-s3 peer dependency is absent
//   - the shared driver contract-conformance suite passes against the wrapper
//
// A fake in-memory S3ClientLike stands in for the AWS SDK so the driver is
// exercised with no external service and no SDK dependency.
//
// Requirements: 2.1, 2.3, 3.3

import test from "node:test";
import assert from "node:assert/strict";

import {
  createS3StorageDriver,
  createS3StorageDriverFromConfig,
} from "../drivers/s3.js";
import { StorageConfigError } from "../errors.js";
import { registerStorageDriverContractTests } from "./contract.js";
import type { S3ClientLike } from "../drivers/s3-base.js";
import type { VersioningCapability } from "../driver.js";

const FIXED_NOW = 1_700_000_000_000;
const fixedClock = () => FIXED_NOW;

function bytes(str: string) {
  return new TextEncoder().encode(str);
}

/** A minimal in-memory S3ClientLike (with native multipart) standing in for the SDK. */
function makeFakeClient(): S3ClientLike {
  const objects = new Map(); // key -> { body, contentType, metadata }
  const uploads = new Map(); // uploadId -> { key, contentType, metadata, parts: Map }
  let seed = 0;

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
    async createMultipartUpload({ key, contentType, metadata }) {
      const uploadId = `upload-${(seed += 1)}`;
      uploads.set(uploadId, { key, contentType, metadata, parts: new Map() });
      return { uploadId };
    },
    async uploadPart({ uploadId, partNumber, body }) {
      uploads.get(uploadId).parts.set(partNumber, body.slice());
      return { etag: `"${uploadId}-${partNumber}"` };
    },
    async completeMultipartUpload({ uploadId, parts }) {
      const session = uploads.get(uploadId);
      const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      const buffers = ordered.map((p) => Buffer.from(session.parts.get(p.partNumber)));
      objects.set(session.key, {
        body: new Uint8Array(Buffer.concat(buffers)),
        contentType: session.contentType,
        metadata: session.metadata,
      });
      uploads.delete(uploadId);
      return { etag: `"${session.key}-etag"` };
    },
    async abortMultipartUpload({ uploadId }) {
      uploads.delete(uploadId);
    },
  };
}

// ── createS3StorageDriver: injected client (no SDK) ─────────────────────────────

test("createS3StorageDriver wraps an injected client as a name:s3 driver", () => {
  const driver = createS3StorageDriver(makeFakeClient(), { clock: fixedClock });
  assert.equal(driver.name, "s3");
});

test("createS3StorageDriver round-trips bytes and typed metadata via the base", async () => {
  const driver = createS3StorageDriver(makeFakeClient(), { clock: fixedClock });
  const content = bytes("amazon s3 content");

  const meta = await driver.put("docs/report.txt", content, {
    contentType: "text/plain",
    owner: "user-9",
    tenant: "tenant-z",
    accessLevel: "public",
    custom: { label: "q3" },
  });
  assert.equal(meta.key, "docs/report.txt");
  assert.equal(meta.size, content.byteLength);
  assert.match(meta.checksum, /^[0-9a-f]{64}$/);

  const result = await driver.get("docs/report.txt");
  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, content);
  assert.equal(result.metadata.contentType, "text/plain");
  assert.equal(result.metadata.owner, "user-9");
  assert.equal(result.metadata.tenant, "tenant-z");
  assert.equal(result.metadata.accessLevel, "public");
  assert.deepEqual(result.metadata.custom, { label: "q3" });
});

test("createS3StorageDriver reports a missing key as found:false (not an error)", async () => {
  const driver = createS3StorageDriver(makeFakeClient(), { clock: fixedClock });
  const result = await driver.get("missing");
  assert.equal(result.found, false);
});

test("createS3StorageDriver wires native multipart from the injected client", async () => {
  const driver = createS3StorageDriver(makeFakeClient(), { clock: fixedClock });
  assert.notEqual(driver.multipart, undefined);
  assert.ok(driver.multipart);

  const uploadId = await driver.multipart.create("big/file.bin", { contentType: "text/plain" });
  const p1 = await driver.multipart.uploadPart(uploadId, 1, bytes("part-one-"));
  const p2 = await driver.multipart.uploadPart(uploadId, 2, bytes("part-two"));
  const meta = await driver.multipart.complete(uploadId, [p1, p2]);

  assert.equal(meta.key, "big/file.bin");
  const result = await driver.get("big/file.bin");
  assert.ok(result.found);
  assert.deepEqual(result.bytes, bytes("part-one-part-two"));
});

test("createS3StorageDriver delegates injected native capabilities", () => {
  const versioning: VersioningCapability = {
    snapshot: async () => null,
    list: async () => [],
    restore: async () => ({
      key: "",
      size: 0,
      contentType: "application/octet-stream",
      etag: "",
      checksum: "",
      accessLevel: "private",
      createdAt: 0,
      updatedAt: 0,
      custom: {},
    }),
    deleteVersion: async () => {},
  };
  const driver = createS3StorageDriver(makeFakeClient(), { capabilities: { versioning } });
  assert.equal(driver.versioning, versioning);
});

// ── createS3StorageDriver: invalid client ───────────────────────────────────────

test("createS3StorageDriver throws StorageConfigError when no client is injected", () => {
  assert.throws(
    () => createS3StorageDriver(undefined as unknown as S3ClientLike),
    (error) => {
      assert.ok(error instanceof StorageConfigError);
      assert.equal(error.provider, "s3");
      return true;
    },
  );
});

test("createS3StorageDriver throws StorageConfigError for a non-conforming client", () => {
  assert.throws(
    () => createS3StorageDriver({ putObject() {} } as unknown as S3ClientLike),
    (error) => error instanceof StorageConfigError && error.provider === "s3",
  );
});

// ── createS3StorageDriverFromConfig ─────────────────────────────────────────────

test("createS3StorageDriverFromConfig wraps a supplied client without loading any SDK", async () => {
  const driver = await createS3StorageDriverFromConfig({
    bucket: "my-bucket",
    client: makeFakeClient(),
    clock: fixedClock,
  });
  assert.equal(driver.name, "s3");

  const meta = await driver.put("k", bytes("v"), {});
  assert.equal(meta.key, "k");
  const got = await driver.get("k");
  assert.ok(got.found);
  assert.deepEqual(got.bytes, bytes("v"));
});

test("createS3StorageDriverFromConfig throws a descriptive StorageConfigError when the AWS SDK is absent", async () => {
  await assert.rejects(
    () => createS3StorageDriverFromConfig({ bucket: "my-bucket", region: "us-east-1" }),
    (error) => {
      assert.ok(error instanceof StorageConfigError, "must be a StorageConfigError");
      assert.equal(error.provider, "s3");
      assert.match(error.message, /@aws-sdk\/client-s3/);
      return true;
    },
  );
});

// ── shared contract-conformance suite ───────────────────────────────────────────

registerStorageDriverContractTests(
  "s3",
  () => createS3StorageDriver(makeFakeClient(), { clock: fixedClock }),
  test,
);
