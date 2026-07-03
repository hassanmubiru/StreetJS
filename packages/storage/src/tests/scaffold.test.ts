// Placeholder scaffold test for @streetjs/storage.
// Verifies the built entry point loads and exposes its placeholder surface.
// Authored in TypeScript so `tsc` emits dist/tests/scaffold.test.js, which is
// then executed by `node --test dist/tests/*.test.js`.
import { test } from "node:test";
import assert from "node:assert/strict";

import { STORAGE_PACKAGE_NAME, STORAGE_PACKAGE_VERSION } from "../index.js";

test("built entry point exposes package identity", () => {
  assert.equal(STORAGE_PACKAGE_NAME, "@streetjs/storage");
  assert.equal(typeof STORAGE_PACKAGE_VERSION, "string");
  assert.ok(STORAGE_PACKAGE_VERSION.length > 0);
});
