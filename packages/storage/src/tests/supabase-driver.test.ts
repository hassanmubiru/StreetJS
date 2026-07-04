// Unit tests for the Supabase Storage driver submodule (task 29.1). Unlike the
// S3-compatible providers, Supabase Storage uses a bucket-scoped file API, so
// the driver maps the StorageDriver contract directly onto a purpose-built
// structural SupabaseStorageClientLike (not the shared S3 base). These tests
// exercise the injected-client path with an in-memory SupabaseStorageClientLike
// double (no `@supabase/supabase-js` SDK, no external service), the
// StorageConfigError guard when no client is injected, the connect() guard when
// the SDK is absent, and the shared driver contract-conformance suite.
//
// Requirements: 2.1, 2.3, 3.3

import test from "node:test";
import assert from "node:assert/strict";

import {
  createSupabaseStorageDriver,
  connectSupabaseStorageDriver,
} from "../drivers/supabase.js";
import type { SupabaseStorageClientLike } from "../drivers/supabase.js";
import { StorageConfigError } from "../errors.js";
import { registerStorageDriverContractTests } from "./contract.js";

const FIXED_NOW = 1_700_000_000_000;
const fixedClock = () => FIXED_NOW;

function bytes(str: string) {
  return new TextEncoder().encode(str);
}

/**
 * A minimal in-memory SupabaseStorageClientLike double. It stores the raw bytes
 * plus the content type and custom-metadata map exactly as the real Supabase
 * object model would, and returns `null` (never throws) for a missing object so
 * the driver's not-found mapping is exercised.
 */
function makeFakeClient(): SupabaseStorageClientLike {
  const objects = new Map(); // path -> { bytes, contentType, metadata }
  return {
    async upload({ path, body, contentType, metadata }) {
      objects.set(path, {
        bytes: body.slice(),
        contentType,
        metadata: metadata ? { ...metadata } : undefined,
      });
      return {};
    },
    async download(path) {
      const obj = objects.get(path);
      return obj === undefined ? null : obj.bytes.slice();
    },
    async remove(path) {
      objects.delete(path);
    },
    async exists(path) {
      return objects.has(path);
    },
    async info(path) {
      const obj = objects.get(path);
      if (obj === undefined) return null;
      return {
        size: obj.bytes.byteLength,
        contentType: obj.contentType,
        etag: `${path}-etag`,
        createdAt: new Date(FIXED_NOW).toISOString(),
        updatedAt: new Date(FIXED_NOW).toISOString(),
        userMetadata: obj.metadata,
      };
    },
    async list({ prefix }) {
      return [...objects.entries()]
        .filter(([name]) => name.startsWith(prefix))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, obj]) => ({
          name,
          size: obj.bytes.byteLength,
          updatedAt: new Date(FIXED_NOW).toISOString(),
        }));
    },
  };
}

function makeDriver() {
  return createSupabaseStorageDriver(makeFakeClient(), { clock: fixedClock });
}

// ── name ──────────────────────────────────────────────────────────────────────

test("driver name is fixed to supabase", () => {
  assert.equal(makeDriver().name, "supabase");
});

// ── injected-client primitives round-trip ─────────────────────────────────────

test("put/get round-trips bytes and typed metadata over the injected client", async () => {
  const driver = makeDriver();
  const content = bytes("supabase object payload");

  await driver.put("bucketed/key.txt", content, {
    contentType: "text/plain",
    owner: "user-7",
    tenant: "tenant-q",
    accessLevel: "public",
    custom: { label: "report" },
  });

  const result = await driver.get("bucketed/key.txt");
  assert.equal(result.found, true);
  assert.deepEqual(result.bytes, content);
  assert.equal(result.metadata.contentType, "text/plain");
  assert.equal(result.metadata.owner, "user-7");
  assert.equal(result.metadata.tenant, "tenant-q");
  assert.equal(result.metadata.accessLevel, "public");
  assert.deepEqual(result.metadata.custom, { label: "report" });
  assert.equal(result.metadata.size, content.byteLength);
});

test("createdAt is preserved across overwrite while updatedAt advances", async () => {
  let now = 1000;
  const driver = createSupabaseStorageDriver(makeFakeClient(), { clock: () => now });

  const first = await driver.put("k.txt", bytes("v1"), {});
  now = 5000;
  const second = await driver.put("k.txt", bytes("v2-longer"), {});

  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.updatedAt, 5000);
  assert.equal(second.size, bytes("v2-longer").byteLength);
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

test("list honors cursor and limit", async () => {
  const driver = makeDriver();
  await driver.put("p/1", bytes("1"), {});
  await driver.put("p/2", bytes("2"), {});
  await driver.put("p/3", bytes("3"), {});

  const limited = await driver.list("p/", { limit: 2 });
  assert.deepEqual(limited.map((i) => i.key), ["p/1", "p/2"]);

  const afterCursor = await driver.list("p/", { cursor: "p/1" });
  assert.deepEqual(afterCursor.map((i) => i.key), ["p/2", "p/3"]);
});

test("get on a missing key reports found:false", async () => {
  const driver = makeDriver();
  const result = await driver.get("nope");
  assert.equal(result.found, false);
});

// ── streaming ──────────────────────────────────────────────────────────────────

test("putStream/getStream round-trip through the injected client", async () => {
  const { Readable } = await import("node:stream");
  const driver = makeDriver();
  const payload = bytes("streamed supabase payload");

  await driver.putStream("s/obj.bin", Readable.from([Buffer.from(payload)]), {
    contentType: "application/octet-stream",
  });

  const stream = await driver.getStream("s/obj.bin");
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  assert.deepEqual(new Uint8Array(Buffer.concat(chunks)), payload);
});

test("getStream throws NotFoundError for a missing key", async () => {
  const driver = makeDriver();
  await assert.rejects(() => driver.getStream("absent"), (err) => {
    assert.equal(err.name, "NotFoundError");
    return true;
  });
});

// ── advanced capabilities are left undefined for facade simulation ─────────────

test("advanced capabilities are undefined (simulated by the facade)", () => {
  const driver = makeDriver();
  assert.equal(driver.multipart, undefined);
  assert.equal(driver.resumable, undefined);
  assert.equal(driver.versioning, undefined);
  assert.equal(driver.signedUrl, undefined);
  assert.equal(driver.lifecycle, undefined);
});

// ── configuration guards ──────────────────────────────────────────────────────

test("createSupabaseStorageDriver throws StorageConfigError when no client is injected", () => {
  assert.throws(() => createSupabaseStorageDriver(undefined), (err) => {
    assert.ok(err instanceof StorageConfigError);
    assert.equal(err.provider, "supabase");
    return true;
  });
});

test("connectSupabaseStorageDriver throws StorageConfigError when the Supabase SDK is absent", async () => {
  await assert.rejects(
    () => connectSupabaseStorageDriver({ url: "https://x.supabase.co", key: "k", bucket: "b" }),
    (err) => {
      assert.ok(err instanceof StorageConfigError);
      assert.equal(err.provider, "supabase");
      return true;
    },
  );
});

test("connectSupabaseStorageDriver throws StorageConfigError when config is incomplete", async () => {
  await assert.rejects(
    () => connectSupabaseStorageDriver({ url: "", key: "", bucket: "" }),
    (err) => {
      assert.ok(err instanceof StorageConfigError);
      assert.equal(err.provider, "supabase");
      return true;
    },
  );
});

// ── shared contract-conformance suite ─────────────────────────────────────────

registerStorageDriverContractTests(
  "supabase",
  () => createSupabaseStorageDriver(makeFakeClient(), { clock: fixedClock }),
  test,
);
