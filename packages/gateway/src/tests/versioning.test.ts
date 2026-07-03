import test from "node:test";
import assert from "node:assert/strict";

import { resolveVersion } from "../versioning.js";
import type { GatewayRequest, Headers, VersioningPolicy } from "../types.js";

/** Build a policy with sensible defaults for the test suite. */
function policy(overrides: Partial<VersioningPolicy> = {}): VersioningPolicy {
  return { versions: ["v1", "v2"], default: "v1", ...overrides };
}

/** Build a minimal request from a path and optional headers. */
function request(path: string, headers: Headers = {}): GatewayRequest {
  return { method: "GET", url: path, path, headers };
}

test("path source strips the leading version segment and resolves", () => {
  const r = resolveVersion(policy(), request("/v1/users"));
  assert.deepEqual(r, { version: "v1", source: "path", strippedPath: "/users" });
});

test("path '/v1' with no remainder strips to '/'", () => {
  const r = resolveVersion(policy(), request("/v1"));
  assert.deepEqual(r, { version: "v1", source: "path", strippedPath: "/" });
});

test("path source strips deeper paths and preserves the query string", () => {
  const r = resolveVersion(policy(), request("/v2/users/42?full=1"));
  assert.deepEqual(r, { version: "v2", source: "path", strippedPath: "/users/42?full=1" });
});

test("x-version header resolves when no path version is present", () => {
  const r = resolveVersion(policy(), request("/users", { "x-version": "v2" }));
  assert.deepEqual(r, { version: "v2", source: "x-version", strippedPath: "/users" });
});

test("accept-version header resolves when no path or x-version is present", () => {
  const r = resolveVersion(policy(), request("/users", { "accept-version": "v2" }));
  assert.deepEqual(r, { version: "v2", source: "accept-version", strippedPath: "/users" });
});

test("x-version header may be supplied as a list; the first value is used", () => {
  const r = resolveVersion(policy(), request("/users", { "x-version": ["v2", "v1"] }));
  assert.deepEqual(r, { version: "v2", source: "x-version", strippedPath: "/users" });
});

test("path beats headers under the default source precedence", () => {
  const r = resolveVersion(
    policy(),
    request("/v1/users", { "x-version": "v2", "accept-version": "v2" }),
  );
  assert.deepEqual(r, { version: "v1", source: "path", strippedPath: "/users" });
});

test("custom source order changes precedence (x-version before path)", () => {
  const r = resolveVersion(
    policy({ sources: ["x-version", "path"] }),
    request("/v1/users", { "x-version": "v2" }),
  );
  // x-version is consulted first, so the header wins and the path is untouched.
  assert.deepEqual(r, { version: "v2", source: "x-version", strippedPath: "/v1/users" });
});

test("a source not in the configured list is ignored", () => {
  const r = resolveVersion(
    policy({ sources: ["x-version"] }),
    request("/v2/users", { "accept-version": "v2" }),
  );
  // Neither path nor accept-version is configured, and x-version is absent → default.
  assert.deepEqual(r, { version: "v1", source: "default", strippedPath: "/v2/users" });
});

test("an unknown path version falls back to the default", () => {
  const r = resolveVersion(policy(), request("/v9/users"));
  assert.deepEqual(r, { version: "v1", source: "default", strippedPath: "/v9/users" });
});

test("an unknown header version falls through to the next source", () => {
  const r = resolveVersion(
    policy(),
    request("/users", { "x-version": "v9", "accept-version": "v2" }),
  );
  assert.deepEqual(r, { version: "v2", source: "accept-version", strippedPath: "/users" });
});

test("an unknown path version falls through to a known header", () => {
  const r = resolveVersion(policy(), request("/v9/users", { "x-version": "v2" }));
  // Path yields an unknown version, so it does not strip; x-version wins.
  assert.deepEqual(r, { version: "v2", source: "x-version", strippedPath: "/v9/users" });
});

test("no version anywhere resolves to the default with the original path", () => {
  const r = resolveVersion(policy({ default: "v2" }), request("/users?x=1"));
  assert.deepEqual(r, { version: "v2", source: "default", strippedPath: "/users?x=1" });
});

test("resolveVersion does not mutate its inputs", () => {
  const p = policy();
  const req = request("/v1/users", { "x-version": "v2" });
  const frozenHeaders = Object.freeze({ ...req.headers });
  resolveVersion(p, { ...req, headers: frozenHeaders });
  assert.deepEqual(p, policy());
  assert.deepEqual(frozenHeaders, { "x-version": "v2" });
});
