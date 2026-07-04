// Unit tests for the Backblaze B2 driver submodule (task 28.5).
//
// Backblaze B2 exposes a fully S3-compatible API, so the driver is a thin
// specialization of the shared S3-style base: it fixes the driver name to
// "backblaze" and either accepts an injected S3ClientLike or builds its own
// client from connection config via a lazy dynamic import() of the optional
// peer SDK. These tests exercise the injected-client path with an in-memory
// fake (no external service, no SDK), assert the name/contract behavior, and
// confirm the self-built path throws StorageConfigError when the SDK is absent.
//
// Requirements: 2.1, 2.3, 3.3

import test from "node:test";
import assert from "node:assert/strict";

import {
  BackblazeB2Driver,
  createBackblazeB2Driver,
  BACKBLAZE_DRIVER_NAME,
} from "../drivers/backblaze.js";
import { StorageConfigError } from "../errors.js";
import { NotFoundError } from "../errors.js";
import { registerStorageDriverContractTests } from "./contract.js";

const FIXED_NOW = 1_700_000_000_000;
const fixedClock = () => FIXED_NOW;

function bytes(str) {
  return new TextEncoder().encode(str);
}

/** A minimal in-memory S3ClientLike standing in for the B2 S3 endpoint. */
function makeFakeClient({ withMultipart = true } = {}) {
  const objects = new Map();
  const uploads = new Map();
  let seed = 0;

  const client = {
    async putObject({ key, body, contentType, metadata }) {
      objects.set(key, {
        body: body.slice(),
        contentType,
        metadata: metadata ? { ...metadata } : undefined,
      });
      return { etag: `${key}-etag` };
    },
    async getObject({ key }) {
      const obj = objects.get(key);
      if (obj === undefined) return null;
      return {
        body: obj.body.slice(),
        contentType: obj.contentType,
        etag: `${key}-etag`,
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
        etag: `${key}-etag`,
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

  if (withMultipart) {
    client.createMultipartUpload = async ({ key, contentType, metadata }) => {
      const uploadId = `upload-${(seed += 1)}`;
      uploads.set(uploadId, { key, contentType, metadata, parts: new Map() });
      return { uploadId };
    };
    client.uploadPart = async ({ uploadId, partNumber, body }) => {
      uploads.get(uploadId).parts.set(partNumber, body.slice());
      return { etag: `${uploadId}-${partNumber}` };
    };
    client.completeMultipartUpload = async ({ uploadId, parts }) => {
      const session = uploads.get(uploadId);
      const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      const buffers = ordered.map((p) => Buffer.from(session.parts.get(p.partNumber)));
      objects.set(session.key, {
        body: new Uint8Array(Buffer.concat(buffers)),
        contentType: session.contentType,
        metadata: session.metadata,
      });
      uploads.delete(uploadId);
      return { etag: `${session.key}-etag` };
    };
    client.abortMultipartUpload = async ({ uploadId }) => {
      uploads.delete(uploadId);
    };
  }

  return { client, objects, uploads };
}

// ── name ────────────────────────────────────────────────────────────────────

test("driver name is fixed to 'backblaze'", () => {
  const { client } = makeFakeClient();
  const driver = createBackblazeB2Driver(client, { clock: fixedClock });
  assert.equal(driver.name, BACKBLAZE_DRIVER_NAME);
  assert.equal(driver.name, "backblaze");
});

test("BackblazeB2Driver class constructs with name 'backblaze'", () => {
  const { client } = makeFakeClient();
  const driver = new BackblazeB2Driver(client, { clock: fixedClock });
  assert.equal(driver.name, "backblaze");
});

test("injected-client factory is synchronous (returns a driver, not a promise)", () => {
  const { client } = makeFakeClient();
  const driver = createBackblazeB2Driver(client);
  assert.equal(typeof driver.put, "function");
  assert.notEqual(typeof driver.then, "function");
});

// ── primitives round-trip through the injected client ──────────────────────────

test("put/get round-trips bytes and typed metadata", async () => {
  const { client } = makeFakeClient();
  const driver = createBackblazeB2Driver(client, { clock: fixedClock });
  const content = bytes("backblaze payload");

  await driver.put("docs/file.txt", content, {
    contentType: "text/plain",
    owner: "user-1",
    accessLevel: "public",
    custom: { label: "invoice" },
  });

  const result = await driver.get("docs/file.txt");
  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, content);
  assert.equal(result.metadata.contentType, "text/plain");
  assert.equal(result.metadata.owner, "user-1");
  assert.equal(result.metadata.accessLevel, "public");
  assert.deepEqual(result.metadata.custom, { label: "invoice" });
});

test("get/stat report a missing key consistently", async () => {
  const { client } = makeFakeClient();
  const driver = createBackblazeB2Driver(client, { clock: fixedClock });

  assert.deepEqual(await driver.get("missing"), { found: false });
  assert.equal(await driver.stat("missing"), null);
  await assert.rejects(() => driver.getStream("missing"), NotFoundError);
});

test("native multipart delegates through the client when available", async () => {
  const { client } = makeFakeClient({ withMultipart: true });
  const driver = createBackblazeB2Driver(client, { clock: fixedClock });

  assert.notEqual(driver.multipart, undefined);
  const uploadId = await driver.multipart.create("big/file.bin", {});
  const p1 = await driver.multipart.uploadPart(uploadId, 1, bytes("part-one-"));
  const p2 = await driver.multipart.uploadPart(uploadId, 2, bytes("part-two"));
  await driver.multipart.complete(uploadId, [p1, p2]);

  const result = await driver.get("big/file.bin");
  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, bytes("part-one-part-two"));
});

test("native capabilities are delegated when injected via options", () => {
  const { client } = makeFakeClient();
  const versioning = { snapshot: async () => null, list: async () => [], restore: async () => ({}), deleteVersion: async () => {} };
  const lifecycle = { apply: async () => [] };
  const signedUrl = { sign: async () => "url", verify: () => ({ valid: true }) };

  const driver = createBackblazeB2Driver(client, {
    clock: fixedClock,
    capabilities: { versioning, lifecycle, signedUrl },
  });

  assert.equal(driver.versioning, versioning);
  assert.equal(driver.lifecycle, lifecycle);
  assert.equal(driver.signedUrl, signedUrl);
});

// ── self-built client path (lazy dynamic import of an absent optional SDK) ──────

test("building own client without the SDK installed throws StorageConfigError", async () => {
  await assert.rejects(
    () =>
      createBackblazeB2Driver({
        bucket: "my-bucket",
        endpoint: "https://s3.us-west-002.backblazeb2.com",
        region: "us-west-002",
        credentials: { accessKeyId: "keyId", secretAccessKey: "appKey" },
      }),
    (error) => {
      assert.ok(error instanceof StorageConfigError);
      assert.equal(error.provider, "backblaze");
      return true;
    },
  );
});

// ── shared contract-conformance suite ───────────────────────────────────────────

registerStorageDriverContractTests(
  "backblaze",
  () => createBackblazeB2Driver(makeFakeClient().client, { clock: fixedClock }),
  test,
);
