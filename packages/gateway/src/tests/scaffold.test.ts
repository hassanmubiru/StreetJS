import test from "node:test";
import assert from "node:assert/strict";

import { GATEWAY_PACKAGE_NAME, GATEWAY_FRAMEWORK_VERSION } from "../index.js";

test("built entry point exposes package markers", () => {
  assert.equal(GATEWAY_PACKAGE_NAME, "@streetjs/gateway");
  assert.equal(GATEWAY_FRAMEWORK_VERSION, "0.1.0");
});
