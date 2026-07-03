// Placeholder scaffold test for @streetjs/workflow.
//
// Verifies that the package builds and its compiled entry point can be imported
// and exposes the expected placeholder surface. Uses the Node.js built-in test
// runner (node:test) and is executed via `node --test dist/tests/*.test.js`.
//
// Requirements: 22.1, 30.1

import test from "node:test";
import assert from "node:assert/strict";

import { WORKFLOW_FRAMEWORK_VERSION, WORKFLOW_PACKAGE_NAME } from "../index.js";

test("built entry point exposes placeholder exports", () => {
  assert.equal(WORKFLOW_PACKAGE_NAME, "@streetjs/workflow");
  assert.equal(WORKFLOW_FRAMEWORK_VERSION, "1.0.0");
});
