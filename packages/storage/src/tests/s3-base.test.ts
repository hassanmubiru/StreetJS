// Unit tests for the shared S3-style driver base and the S3ClientLike contract
// (task 28.1). A fake in-memory S3ClientLike stands in for a provider SDK so the
// base can be exercised with no external service and no SDK dependency.
//
// Coverage:
//  - mandatory primitives put/get/exists/delete/stat/list mapped onto the client
//  - typed metadata round-trips (owner/tenant/accessLevel/custom/contentType),
//    createdAt preserved on overwrite, computed size/checksum
//  - consistent not-found reporting (get -> found:false, stat -> null,
//    getStream -> NotFoundError)
//  - streaming round-trip via putStream/getStream
//  - native multipart delegation when the client exposes the method set; absent
//    otherwise (facade would simulate)
//  - versioning/lifecycle/signedUrl delegated only when injected via options
//  - the shared driver contract-conformance suite passes against the base
//
// Requirements: 2.3, 3.1, 3.3

import test from "node:test";
import assert from "node:assert/strict";

import {
  S3StyleDriver,
  createS3StyleDriver,
} from "../drivers/s3-base.js";
import { NotFoundError } from "../errors.js";
import { registerStorageDriverContractTests } from "./contract.js";
import type { S3ClientLike, S3StyleDriverOptions } from "../drivers/s3-base.js";
import type { VersioningCapability } from "../driver.js";
import type { StorageObjectMetadata } from "../types.js";

const FIXED_NOW = 1_700_000_000_000;
const fixedClock = () => FIXED_NOW;

function bytes(str: string) {
  return new TextEncoder().encode(str);
}

/**
 * A minimal in-memory S3ClientLike. `withMultipart` toggles whether the native
 * multipart method set is present so we can assert conditional capability
 * wiring.
 */
function makeFakeClient({ withMultipart = false } = {}) {
  const objects = new Map(); // key -> { body, contentType, metadata }
  const uploads = new Map(); // uploadId -> { key, metadata, parts: Map<number, body> }
  let uploadCounterSeed = 0;

  const client = {
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

  if (withMultipart) {
    client.createMultipartUpload = async ({ key, contentType, metadata }) => {
      const uploadId = `upload-${(uploadCounterSeed += 1)}`;
      uploads.set(uploadId, { key, contentType, metadata, parts: new Map() });
      return { uploadId };
    };
    client.uploadPart = async ({ uploadId, partNumber, body }) => {
      uploads.get(uploadId).parts.set(partNumber, body.slice());
      return { etag: `"${uploadId}-${partNumber}"` };
    };
    client.completeMultipartUpload = async ({ uploadId, parts }) => {
      const session = uploads.get(uploadId);
      const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
      const buffers = ordered.map((p) => Buffer.from(session.parts.get(p.partNumber)));
      const body = new Uint8Array(Buffer.concat(buffers));
      objects.set(session.key, {
        body,
        contentType: session.contentType,
        metadata: session.metadata,
      });
      uploads.delete(uploadId);
      return { etag: `"${session.key}-etag"` };
    };
    client.abortMultipartUpload = async ({ uploadId }) => {
      uploads.delete(uploadId);
    };
  }

  return { client, objects, uploads };
}

function makeDriver(opts = {}) {
  const { client } = makeFakeClient(opts);
  return createS3StyleDriver(client, { clock: fixedClock, name: "s3", ...opts.driverOptions });
}

// ── primitives ────────────────────────────────────────────────────────────────

test("put returns typed metadata with computed size/checksum and defaults", async () => {
  const driver = makeDriver();
  const content = bytes("hello world");

  const meta = await driver.put("greetings/hello.txt", content, {});

  assert.equal(meta.key, "greetings/hello.txt");
  assert.equal(meta.size, content.byteLength);
  assert.match(meta.checksum, /^[0-9a-f]{64}$/);
  assert.equal(meta.contentType, "application/octet-stream");
  assert.equal(meta.accessLevel, "private");
  assert.deepEqual(meta.custom, {});
  assert.equal(meta.createdAt, FIXED_NOW);
  assert.equal(meta.updatedAt, FIXED_NOW);
});

test("get round-trips bytes and typed metadata across the client boundary", async () => {
  const driver = makeDriver();
  const content = bytes("the quick brown fox");
  await driver.put("docs/fox.txt", content, {
    contentType: "text/plain",
    owner: "user-1",
    tenant: "tenant-a",
    accessLevel: "public",
    custom: { label: "invoice" },
  });

  const result = await driver.get("docs/fox.txt");

  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, content);
  assert.equal(result.metadata.contentType, "text/plain");
  assert.equal(result.metadata.owner, "user-1");
  assert.equal(result.metadata.tenant, "tenant-a");
  assert.equal(result.metadata.accessLevel, "public");
  assert.deepEqual(result.metadata.custom, { label: "invoice" });
});

test("get preserves arbitrary binary bytes without mutation", async () => {
  const driver = makeDriver();
  const content = new Uint8Array([0, 255, 1, 254, 127, 128]);
  await driver.put("bin/data", content, {});

  const result = await driver.get("bin/data");

  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, content);
});

test("exists reflects presence via the client", async () => {
  const driver = makeDriver();
  await driver.put("present.txt", bytes("here"), {});

  assert.equal(await driver.exists("present.txt"), true);
  assert.equal(await driver.exists("absent.txt"), false);
});

test("delete removes visibility", async () => {
  const driver = makeDriver();
  await driver.put("temp/file.txt", bytes("bye"), {});

  await driver.delete("temp/file.txt");

  assert.equal(await driver.exists("temp/file.txt"), false);
  const result = await driver.get("temp/file.txt");
  assert.equal(result.found, false);
});

test("stat returns metadata without content and null for a missing key", async () => {
  const driver = makeDriver();
  await driver.put("stat/key.txt", bytes("stat me"), { contentType: "text/plain" });

  const meta = await driver.stat("stat/key.txt");
  assert.notEqual(meta, null);
  assert.equal(meta.key, "stat/key.txt");
  assert.equal(meta.contentType, "text/plain");
  assert.equal(meta.bytes, undefined);

  assert.equal(await driver.stat("no/such/key"), null);
});

test("list returns prefix-matching items with size and updatedAt", async () => {
  const driver = makeDriver();
  await driver.put("photos/b.png", bytes("bb"), {});
  await driver.put("photos/a.png", bytes("a"), {});
  await driver.put("docs/readme.md", bytes("doc"), {});

  const items = await driver.list("photos/");

  assert.deepEqual(
    items.map((item) => item.key),
    ["photos/a.png", "photos/b.png"],
  );
  assert.equal(items[0].size, 1);
  assert.equal(items[0].updatedAt, FIXED_NOW);
});

// ── createdAt preservation on overwrite ────────────────────────────────────────

test("overwrite preserves createdAt and advances updatedAt", async () => {
  let now = 1000;
  const { client } = makeFakeClient();
  const driver = createS3StyleDriver(client, { clock: () => now });

  const first = await driver.put("k", bytes("v1"), {});
  assert.equal(first.createdAt, 1000);

  now = 2000;
  const second = await driver.put("k", bytes("v2-longer"), {});
  assert.equal(second.createdAt, 1000, "createdAt must be preserved on overwrite");
  assert.equal(second.updatedAt, 2000, "updatedAt must advance");
});

// ── not-found semantics ────────────────────────────────────────────────────────

test("get on a missing key reports found:false (not an error)", async () => {
  const driver = makeDriver();
  const result = await driver.get("missing");
  assert.equal(result.found, false);
});

test("getStream on a missing key throws NotFoundError", async () => {
  const driver = makeDriver();
  await assert.rejects(() => driver.getStream("missing"), NotFoundError);
});

// ── streaming ──────────────────────────────────────────────────────────────────

test("putStream + getStream round-trips content", async () => {
  const { Readable } = await import("node:stream");
  const driver = makeDriver();
  const content = bytes("streamed content across chunks");

  await driver.putStream(
    "stream/file.txt",
    Readable.from([Buffer.from(content.slice(0, 10)), Buffer.from(content.slice(10))]),
    { contentType: "text/plain" },
  );

  const stream = await driver.getStream("stream/file.txt");
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  assert.deepEqual(new Uint8Array(Buffer.concat(chunks)), content);
});

// ── capability delegation ───────────────────────────────────────────────────────

test("multipart capability is undefined when the client lacks multipart methods", () => {
  const { client } = makeFakeClient({ withMultipart: false });
  const driver = createS3StyleDriver(client);
  assert.equal(driver.multipart, undefined);
});

test("multipart capability is wired and assembles parts when the client supports it", async () => {
  const { client } = makeFakeClient({ withMultipart: true });
  const driver = createS3StyleDriver(client, { clock: fixedClock });

  assert.notEqual(driver.multipart, undefined);

  const uploadId = await driver.multipart.create("big/file.bin", { contentType: "text/plain" });
  const p1 = await driver.multipart.uploadPart(uploadId, 1, bytes("part-one-"));
  const p2 = await driver.multipart.uploadPart(uploadId, 2, bytes("part-two"));
  const meta = await driver.multipart.complete(uploadId, [p1, p2]);

  assert.equal(meta.key, "big/file.bin");
  const result = await driver.get("big/file.bin");
  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, bytes("part-one-part-two"));
});

test("multipart abort discards the upload without creating an object", async () => {
  const { client } = makeFakeClient({ withMultipart: true });
  const driver = createS3StyleDriver(client, { clock: fixedClock });

  const uploadId = await driver.multipart.create("aborted/file.bin", {});
  await driver.multipart.uploadPart(uploadId, 1, bytes("data"));
  await driver.multipart.abort(uploadId);

  assert.equal(await driver.exists("aborted/file.bin"), false);
});

test("versioning/lifecycle/signedUrl are undefined unless injected", () => {
  const { client } = makeFakeClient();
  const bare = createS3StyleDriver(client);
  assert.equal(bare.versioning, undefined);
  assert.equal(bare.lifecycle, undefined);
  assert.equal(bare.signedUrl, undefined);
});

test("native versioning/lifecycle/signedUrl capabilities are delegated when injected", () => {
  const { client } = makeFakeClient();
  const versioning = { snapshot: async () => null, list: async () => [], restore: async () => ({}), deleteVersion: async () => {} };
  const lifecycle = { apply: async () => [] };
  const signedUrl = { sign: async () => "url", verify: () => ({ valid: true }) };

  const driver = createS3StyleDriver(client, {
    capabilities: { versioning, lifecycle, signedUrl },
  });

  assert.equal(driver.versioning, versioning);
  assert.equal(driver.lifecycle, lifecycle);
  assert.equal(driver.signedUrl, signedUrl);
});

test("driver name defaults to s3 and is configurable", () => {
  const { client } = makeFakeClient();
  assert.equal(createS3StyleDriver(client).name, "s3");
  assert.equal(createS3StyleDriver(client, { name: "r2" }).name, "r2");
});

test("S3StyleDriver class is exported and constructible", async () => {
  const { client } = makeFakeClient();
  const driver = new S3StyleDriver(client, { clock: fixedClock, name: "minio" });
  assert.equal(driver.name, "minio");
  const meta = await driver.put("x", bytes("y"), {});
  assert.equal(meta.key, "x");
});

// ── shared contract-conformance suite ───────────────────────────────────────────

registerStorageDriverContractTests(
  "s3-base",
  () => createS3StyleDriver(makeFakeClient().client, { clock: fixedClock }),
  test,
);
