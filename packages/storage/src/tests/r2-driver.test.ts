// Unit tests for the CloudflareR2Driver submodule (task 28.3). R2 is the shared
// S3-style base pinned to the "r2" provider name with an R2 endpoint/credential
// specialization for the build-its-own-client path. A fake in-memory
// S3ClientLike stands in for the provider SDK so the driver is exercised with no
// external service and no SDK dependency.
//
// Coverage:
//  - createCloudflareR2Driver wraps an injected S3ClientLike, name === "r2"
//  - the CloudflareR2Driver class is constructible and pinned to "r2"
//  - primitives round-trip typed metadata across the client boundary
//  - the shared driver contract-conformance suite passes against the driver
//  - connectCloudflareR2Driver validates required config (StorageConfigError)
//  - connectCloudflareR2Driver throws StorageConfigError when the S3 SDK is
//    absent and no client was injected (the SDK is not installed here)
//
// Requirements: 2.1, 2.3, 3.3

import test from "node:test";
import assert from "node:assert/strict";

import {
  CloudflareR2Driver,
  createCloudflareR2Driver,
  connectCloudflareR2Driver,
} from "../drivers/r2.js";
import { StorageConfigError } from "../errors.js";
import { registerStorageDriverContractTests } from "./contract.js";
import type { S3ClientLike } from "../drivers/s3-base.js";

const FIXED_NOW = 1_700_000_000_000;
const fixedClock = () => FIXED_NOW;

function bytes(str: string) {
  return new TextEncoder().encode(str);
}

/** A minimal in-memory S3ClientLike standing in for the R2 (S3-API) client. */
function makeFakeClient(): S3ClientLike {
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
      if (obj === undefined) {
        return null;
      }
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
      if (obj === undefined) {
        return null;
      }
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

// ── name / construction ─────────────────────────────────────────────────────────

test("createCloudflareR2Driver wraps an injected client and names it r2", () => {
  const driver = createCloudflareR2Driver(makeFakeClient(), { clock: fixedClock });
  assert.equal(driver.name, "r2");
});

test("CloudflareR2Driver class is constructible and pinned to r2", async () => {
  const driver = new CloudflareR2Driver(makeFakeClient(), { clock: fixedClock });
  assert.equal(driver.name, "r2");
  const meta = await driver.put("k", bytes("v"), {});
  assert.equal(meta.key, "k");
});

// ── primitives round-trip across the client boundary ─────────────────────────────

test("put/get round-trips bytes and typed metadata", async () => {
  const driver = createCloudflareR2Driver(makeFakeClient(), { clock: fixedClock });
  const content = bytes("cloudflare r2 payload");

  await driver.put("docs/r2.txt", content, {
    contentType: "text/plain",
    owner: "user-9",
    tenant: "tenant-z",
    accessLevel: "public",
    custom: { region: "auto" },
  });

  const result = await driver.get("docs/r2.txt");
  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, content);
  assert.equal(result.metadata.contentType, "text/plain");
  assert.equal(result.metadata.owner, "user-9");
  assert.equal(result.metadata.tenant, "tenant-z");
  assert.equal(result.metadata.accessLevel, "public");
  assert.deepEqual(result.metadata.custom, { region: "auto" });
});

test("get on a missing key reports found:false (not an error)", async () => {
  const driver = createCloudflareR2Driver(makeFakeClient(), { clock: fixedClock });
  const result = await driver.get("missing");
  assert.equal(result.found, false);
});

// ── build-its-own-client path (SDK isolation) ────────────────────────────────────

test("connectCloudflareR2Driver validates required config", async () => {
  await assert.rejects(
    () =>
      connectCloudflareR2Driver({
        accountId: "",
        bucket: "media",
        accessKeyId: "AK",
        secretAccessKey: "SK",
      }),
    (error) => {
      assert.ok(error instanceof StorageConfigError);
      assert.equal(error.provider, "r2");
      return true;
    },
  );
});

test("connectCloudflareR2Driver throws StorageConfigError when the S3 SDK is absent", async () => {
  // The optional @aws-sdk/client-s3 peer is not installed in this workspace, so
  // the lazy dynamic import must fail and surface a StorageConfigError rather
  // than an unhandled module-resolution error.
  await assert.rejects(
    () =>
      connectCloudflareR2Driver({
        accountId: "acct-123",
        bucket: "media",
        accessKeyId: "AK",
        secretAccessKey: "SK",
      }),
    (error) => {
      assert.ok(error instanceof StorageConfigError);
      assert.equal(error.provider, "r2");
      return true;
    },
  );
});

// ── shared contract-conformance suite ────────────────────────────────────────────

registerStorageDriverContractTests(
  "r2",
  () => createCloudflareR2Driver(makeFakeClient(), { clock: fixedClock }),
  test,
);
