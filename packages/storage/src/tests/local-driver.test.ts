// Unit tests for LocalStorageDriver primitive object operations.
//
// Exercises the mandatory StorageDriver primitives implemented in
// `src/drivers/local.ts` (task 4.1): put/get/exists/delete/stat/list against a
// real filesystem root. Each test uses an isolated temporary directory created
// via `fs.mkdtemp` under `os.tmpdir()` and removes it afterward so tests never
// touch shared state. Uses the Node.js built-in test runner (node:test) and is
// executed via `node --test dist/tests/*.test.js`.
//
// Verifies: put/get round-trips bytes exactly; get on a missing key reports
// {found:false}; exists returns true/false correctly; delete removes
// visibility; stat returns metadata or null; list returns keys matching a
// prefix and never surfaces `.meta.json` sidecar files; nested keys work.
//
// Requirements: 4.1, 4.2, 4.3, 4.4, 2.4

import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { LocalStorageDriver } from "../drivers/local.js";
import type { StorageDriver } from "../driver.js";
import { ValidationError } from "../errors.js";

/**
 * Create a fresh, isolated temporary root and a driver bound to it, run `body`,
 * and always clean up the directory afterward.
 */
async function withDriver(body: (driver: StorageDriver, root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "streetjs-local-driver-"));
  const driver = new LocalStorageDriver({ root });
  try {
    await body(driver, root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

/** Minimal write metadata: the driver fills in defaults. */
const NO_META = {};

test("put/get round-trips bytes exactly", async () => {
  await withDriver(async (driver) => {
    const bytes = new Uint8Array([0, 1, 2, 3, 255, 128, 64, 0, 17]);
    const written = await driver.put("photos/cat.bin", bytes, NO_META);

    assert.equal(written.key, "photos/cat.bin");
    assert.equal(written.size, bytes.byteLength);

    const result = await driver.get("photos/cat.bin");
    assert.equal(result.found, true);
    assert.deepEqual(result.bytes, bytes);
    assert.equal(result.metadata.key, "photos/cat.bin");
    assert.equal(result.metadata.size, bytes.byteLength);
  });
});

test("put/get round-trips empty content exactly", async () => {
  await withDriver(async (driver) => {
    const empty = new Uint8Array([]);
    await driver.put("empty.bin", empty, NO_META);

    const result = await driver.get("empty.bin");
    assert.ok(result.found);
    assert.equal(result.bytes.byteLength, 0);
    assert.equal(result.metadata.size, 0);
  });
});

test("get on a missing key reports not-found", async () => {
  await withDriver(async (driver) => {
    const result = await driver.get("does/not/exist.txt");
    assert.equal(result.found, false);
    assert.equal((result as { bytes?: Uint8Array }).bytes, undefined);
    assert.equal((result as { metadata?: unknown }).metadata, undefined);
  });
});

test("exists returns true for a stored key and false otherwise", async () => {
  await withDriver(async (driver) => {
    assert.equal(await driver.exists("report.pdf"), false);
    await driver.put("report.pdf", new Uint8Array([1, 2, 3]), NO_META);
    assert.equal(await driver.exists("report.pdf"), true);
    assert.equal(await driver.exists("other.pdf"), false);
  });
});

test("delete removes visibility of a stored object", async () => {
  await withDriver(async (driver) => {
    await driver.put("temp/file.txt", new Uint8Array([9, 9, 9]), NO_META);
    assert.equal(await driver.exists("temp/file.txt"), true);

    await driver.delete("temp/file.txt");

    assert.equal(await driver.exists("temp/file.txt"), false);
    const result = await driver.get("temp/file.txt");
    assert.equal(result.found, false);
    assert.equal(await driver.stat("temp/file.txt"), null);
  });
});

test("delete of a missing key is a no-op", async () => {
  await withDriver(async (driver) => {
    await driver.delete("never/created.txt");
    assert.equal(await driver.exists("never/created.txt"), false);
  });
});

test("stat returns metadata for an existing key and null for a missing one", async () => {
  await withDriver(async (driver) => {
    assert.equal(await driver.stat("missing.txt"), null);

    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await driver.put("docs/readme.txt", bytes, { contentType: "text/plain" });

    const meta = await driver.stat("docs/readme.txt");
    assert.ok(meta);
    assert.equal(meta.key, "docs/readme.txt");
    assert.equal(meta.size, bytes.byteLength);
    assert.equal(meta.contentType, "text/plain");
    assert.ok(typeof meta.checksum === "string" && meta.checksum.length > 0);
    assert.ok(typeof meta.createdAt === "number");
    assert.ok(typeof meta.updatedAt === "number");
  });
});

test("list returns keys matching a prefix", async () => {
  await withDriver(async (driver) => {
    await driver.put("images/a.png", new Uint8Array([1]), NO_META);
    await driver.put("images/b.png", new Uint8Array([2]), NO_META);
    await driver.put("videos/c.mp4", new Uint8Array([3]), NO_META);

    const items = await driver.list("images/");
    const keys = items.map((item) => item.key).sort();
    assert.deepEqual(keys, ["images/a.png", "images/b.png"]);

    const all = await driver.list("");
    const allKeys = all.map((item) => item.key).sort();
    assert.deepEqual(allKeys, ["images/a.png", "images/b.png", "videos/c.mp4"]);
  });
});

test("list never surfaces .meta.json sidecar files", async () => {
  await withDriver(async (driver) => {
    await driver.put("data/record.json", new Uint8Array([1, 2, 3]), NO_META);

    const items = await driver.list("");
    const keys = items.map((item) => item.key);

    assert.deepEqual(keys, ["data/record.json"]);
    assert.ok(!keys.some((key) => key.endsWith(".meta.json")));
  });
});

test("list returns items carrying key, size, and updatedAt", async () => {
  await withDriver(async (driver) => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await driver.put("k.bin", bytes, NO_META);

    const [item] = await driver.list("k");
    assert.equal(item.key, "k.bin");
    assert.equal(item.size, bytes.byteLength);
    assert.ok(typeof item.updatedAt === "number");
  });
});

test("nested keys round-trip through put/get/exists/list", async () => {
  await withDriver(async (driver) => {
    const bytes = new Uint8Array([10, 20, 30, 40]);
    await driver.put("a/b/c.txt", bytes, NO_META);

    assert.equal(await driver.exists("a/b/c.txt"), true);

    const result = await driver.get("a/b/c.txt");
    assert.equal(result.found, true);
    assert.deepEqual(result.bytes, bytes);

    const items = await driver.list("a/");
    assert.deepEqual(
      items.map((item) => item.key),
      ["a/b/c.txt"],
    );
  });
});

// ── Path traversal containment ────────────────────────────────────────────────
//
// Regression coverage for a path-traversal vulnerability: a key containing
// `../` segments (or an absolute path) must never resolve outside the
// driver's configured root. Without this guard, `put`/`get` could read or
// write arbitrary filesystem locations reachable by the process.

test("put rejects a key that resolves outside the storage root via ../ segments", async () => {
  await withDriver(async (driver, root) => {
    const victimDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetjs-local-driver-victim-"));
    try {
      const escapeKey = `${path.relative(root, victimDir)}/pwned.txt`;
      await assert.rejects(
        () => driver.put(escapeKey, new Uint8Array([1, 2, 3]), NO_META),
        ValidationError,
      );
      assert.equal(
        await fs.access(path.join(victimDir, "pwned.txt")).then(
          () => true,
          () => false,
        ),
        false,
        "no file should have been created outside the storage root",
      );
    } finally {
      await fs.rm(victimDir, { recursive: true, force: true });
    }
  });
});

test("put rejects an absolute-path key", async () => {
  await withDriver(async (driver) => {
    await assert.rejects(
      () => driver.put("/etc/passwd-streetjs-test-should-not-write", new Uint8Array([1]), NO_META),
      ValidationError,
    );
  });
});

test("get rejects a key that resolves outside the storage root via ../ segments", async () => {
  await withDriver(async (driver, root) => {
    await assert.rejects(() => driver.get(`../${path.basename(root)}-sibling/secret.txt`), ValidationError);
  });
});

test("legitimate nested keys are unaffected by the containment guard", async () => {
  await withDriver(async (driver) => {
    const bytes = new Uint8Array([9, 9, 9]);
    await driver.put("safe/nested/key.txt", bytes, NO_META);
    const result = await driver.get("safe/nested/key.txt");
    assert.equal(result.found, true);
    assert.deepEqual(result.bytes, bytes);
  });
});
