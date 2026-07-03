// Placeholder scaffold test for @streetjs/storage.
//
// Verifies that the package builds and its compiled entry point can be imported
// and exposes the expected placeholder surface. Uses the Node.js built-in test
// runner (node:test) and is executed via `node --test dist/tests/*.test.js`.

import test from "node:test";
import assert from "node:assert/strict";

import { STORAGE_FRAMEWORK_VERSION, STORAGE_PACKAGE_NAME } from "../index.js";

test("built entry point exposes placeholder exports", () => {
  assert.equal(STORAGE_PACKAGE_NAME, "@streetjs/storage");
  assert.equal(STORAGE_FRAMEWORK_VERSION, "1.0.0");
});
