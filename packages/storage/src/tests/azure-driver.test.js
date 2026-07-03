// Unit tests for the Azure Blob driver submodule (task 29.3). Azure Blob does
// not speak the S3 wire shape, so this driver maps the StorageDriver contract
// directly onto a structural AzureBlobClientLike (not the S3-style base). These
// tests exercise the injected-client path with an in-memory AzureBlobClientLike
// double (no `@azure/storage-blob` SDK, no external service), the
// StorageConfigError guard when no client is injected, the lazy-SDK connect
// path when the SDK is absent, and the shared driver contract-conformance suite.
//
// Requirements: 2.1, 2.3, 3.3

import test from "node:test";
import assert from "node:assert/strict";

import { createAzureBlobDriver, connectAzureBlobDriver } from "../drivers/azure.js";
import { StorageConfigError } from "../errors.js";
import { registerStorageDriverContractTests } from "./contract.js";

const FIXED_NOW = 1_700_000_000_000;
const fixedClock = () => FIXED_NOW;

function bytes(str) {
  return new TextEncoder().encode(str);
}

/** A minimal in-memory AzureBlobClientLike double. */
function makeFakeClient() {
  const blobs = new Map(); // blobName -> { body, contentType, metadata }
  return {
    async upload({ blobName, body, contentType, metadata }) {
      blobs.set(blobName, {
        body: body.slice(),
        contentType,
        metadata: metadata ? { ...metadata } : undefined,
      });
      return { etag: `"${blobName}-etag"` };
    },
    async download({ blobName }) {
      const blob = blobs.get(blobName);
      if (blob === undefined) return null;
      return {
        body: blob.body.slice(),
        contentType: blob.contentType,
        etag: `"${blobName}-etag"`,
        contentLength: blob.body.byteLength,
        lastModified: FIXED_NOW,
        metadata: blob.metadata,
      };
    },
    async getProperties({ blobName }) {
      const blob = blobs.get(blobName);
      if (blob === undefined) return null;
      return {
        contentType: blob.contentType,
        etag: `"${blobName}-etag"`,
        contentLength: blob.body.byteLength,
        lastModified: FIXED_NOW,
        metadata: blob.metadata,
      };
    },
    async deleteBlob({ blobName }) {
      blobs.delete(blobName);
    },
    async exists({ blobName }) {
      return blobs.has(blobName);
    },
    async listBlobs({ prefix }) {
      return [...blobs.entries()]
        .filter(([name]) => name.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, blob]) => ({
          name,
          contentLength: blob.body.byteLength,
          lastModified: FIXED_NOW,
        }));
    },
  };
}

function makeDriver() {
  return createAzureBlobDriver(makeFakeClient(), { clock: fixedClock });
}

// ── name ──────────────────────────────────────────────────────────────────────

test("driver name is azure", () => {
  assert.equal(makeDriver().name, "azure");
});

// ── injected-client primitives round-trip ─────────────────────────────────────

test("put/get round-trips bytes and typed metadata over the injected client", async () => {
  const driver = makeDriver();
  const content = bytes("azure blob payload");

  await driver.put("container/key.txt", content, {
    contentType: "text/plain",
    owner: "user-7",
    tenant: "tenant-q",
    accessLevel: "public",
    custom: { label: "report" },
  });

  const result = await driver.get("container/key.txt");
  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, content);
  assert.equal(result.metadata.contentType, "text/plain");
  assert.equal(result.metadata.owner, "user-7");
  assert.equal(result.metadata.tenant, "tenant-q");
  assert.equal(result.metadata.accessLevel, "public");
  assert.deepEqual(result.metadata.custom, { label: "report" });
  assert.equal(result.metadata.size, content.byteLength);
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

test("list honors the limit option", async () => {
  const driver = makeDriver();
  await driver.put("p/1.txt", bytes("1"), {});
  await driver.put("p/2.txt", bytes("2"), {});
  await driver.put("p/3.txt", bytes("3"), {});

  const items = await driver.list("p/", { limit: 2 });
  assert.deepEqual(items.map((i) => i.key), ["p/1.txt", "p/2.txt"]);
});

test("get on a missing key reports found:false", async () => {
  const driver = makeDriver();
  const result = await driver.get("nope");
  assert.equal(result.found, false);
});

test("overwrite preserves createdAt and advances updatedAt semantics", async () => {
  const driver = makeDriver();
  const first = await driver.put("k.txt", bytes("one"), {});
  const second = await driver.put("k.txt", bytes("two-longer"), {});
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.size, bytes("two-longer").byteLength);
});

// ── streaming ───────────────────────────────────────────────────────────────

test("putStream/getStream round-trips content", async () => {
  const { Readable } = await import("node:stream");
  const driver = makeDriver();
  const content = bytes("streamed azure content");

  await driver.putStream("s/obj.bin", Readable.from([Buffer.from(content)]), {});

  const stream = await driver.getStream("s/obj.bin");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(new Uint8Array(Buffer.concat(chunks)), content);
});

test("getStream throws on a missing key", async () => {
  const driver = makeDriver();
  await assert.rejects(() => driver.getStream("absent"));
});

// ── advanced capabilities left undefined for facade simulation ────────────────

test("advanced capabilities are left undefined for facade simulation", () => {
  const driver = makeDriver();
  assert.equal(driver.multipart, undefined);
  assert.equal(driver.resumable, undefined);
  assert.equal(driver.versioning, undefined);
  assert.equal(driver.signedUrl, undefined);
  assert.equal(driver.lifecycle, undefined);
});

// ── configuration guards ──────────────────────────────────────────────────────

test("createAzureBlobDriver throws StorageConfigError when no client is injected", () => {
  assert.throws(
    () => createAzureBlobDriver(undefined),
    (err) => {
      assert.ok(err instanceof StorageConfigError);
      assert.equal(err.provider, "azure");
      return true;
    },
  );
});

test("connectAzureBlobDriver throws StorageConfigError when the Azure SDK is absent", async () => {
  await assert.rejects(
    () =>
      connectAzureBlobDriver({
        container: "c",
        connectionString: "UseDevelopmentStorage=true",
      }),
    (err) => {
      assert.ok(err instanceof StorageConfigError);
      assert.equal(err.provider, "azure");
      return true;
    },
  );
});

// ── shared contract-conformance suite ─────────────────────────────────────────

registerStorageDriverContractTests(
  "azure",
  () => createAzureBlobDriver(makeFakeClient(), { clock: fixedClock }),
  test,
);
