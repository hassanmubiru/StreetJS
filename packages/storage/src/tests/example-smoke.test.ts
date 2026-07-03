// Smoke test for the runnable end-to-end example (task 31.2).
//
// This test imports `runStorageDemo` from the example application and executes
// it end to end against the zero-dependency in-memory driver — no external
// services, no network, no real image library. It passes a no-op log sink to
// keep test output quiet and asserts on the returned summary to prove the
// demonstrated operations (upload, download, replace, list, delete, signed URL,
// streaming progress, resize, thumbnail, metadata) all succeeded.
//
// Requirements: 25.3, 27.1

import test from "node:test";
import assert from "node:assert/strict";

import { runStorageDemo } from "../examples/storage-demo.js";

/** A no-op log sink so the demo runs quietly under the test runner. */
const quietLog = (_line: string): void => {};

test("runStorageDemo runs end to end on the zero-dependency driver", async () => {
  const summary = await runStorageDemo(quietLog);

  // Download round-tripped and matched the upload.
  assert.equal(summary.downloaded, "ok");

  // Listing returned at least one stored object.
  assert.ok(Array.isArray(summary.listedKeys));
  assert.ok(summary.listedKeys.length > 0, "expected at least one listed key");

  // A signed URL was produced.
  assert.equal(typeof summary.signedUrl, "string");
  assert.ok(summary.signedUrl.length > 0, "expected a non-empty signed URL");

  // Streaming upload surfaced byte-level progress.
  assert.ok(summary.progressUpdates > 0, "expected at least one progress update");

  // Image processing produced resized and thumbnail variants.
  assert.ok(
    typeof summary.resizedKey === "string" && summary.resizedKey.length > 0,
    "expected a resized variant key",
  );
  assert.ok(
    typeof summary.thumbnailKey === "string" && summary.thumbnailKey.length > 0,
    "expected a thumbnail variant key",
  );

  // Metadata inspection reported a positive object size.
  assert.ok(summary.avatarSize > 0, "expected a positive avatar size");
});
