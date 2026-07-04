import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SECURITY_HEADERS,
  applySecurityHeaders,
  enforceBodyLimit,
  resolveHeaderTimeoutMs,
} from "../security.js";
import { PayloadTooLargeError } from "../errors.js";
import type { Headers, SecurityPolicy } from "../types.js";

// ── DEFAULT_SECURITY_HEADERS ───────────────────────────────────────────────────

test("DEFAULT_SECURITY_HEADERS carries the conservative defaults", () => {
  assert.equal(DEFAULT_SECURITY_HEADERS["x-content-type-options"], "nosniff");
  assert.equal(DEFAULT_SECURITY_HEADERS["x-frame-options"], "DENY");
  assert.equal(DEFAULT_SECURITY_HEADERS["referrer-policy"], "no-referrer");
  assert.equal(DEFAULT_SECURITY_HEADERS["x-dns-prefetch-control"], "off");
});

// ── applySecurityHeaders ────────────────────────────────────────────────────────

test("applySecurityHeaders sets defaults and preserves unrelated response headers", () => {
  const headers: Headers = { "content-type": "application/json", "x-request-id": "abc" };
  const merged = applySecurityHeaders(headers);

  // Defaults present.
  assert.equal(merged["x-content-type-options"], "nosniff");
  assert.equal(merged["x-frame-options"], "DENY");
  assert.equal(merged["referrer-policy"], "no-referrer");
  assert.equal(merged["x-dns-prefetch-control"], "off");

  // Existing unrelated headers preserved.
  assert.equal(merged["content-type"], "application/json");
  assert.equal(merged["x-request-id"], "abc");
});

test("applySecurityHeaders returns a new bag and does not mutate the input", () => {
  const headers: Headers = { "content-type": "text/plain" };
  const merged = applySecurityHeaders(headers);
  assert.notEqual(merged, headers);
  // Input untouched.
  assert.equal((headers as Record<string, unknown>)["x-frame-options"], undefined);
});

test("applySecurityHeaders lower-cases keys from the response bag", () => {
  const headers: Headers = { "Content-Type": "application/json", "X-Custom": "v" };
  const merged = applySecurityHeaders(headers);
  assert.equal(merged["content-type"], "application/json");
  assert.equal(merged["x-custom"], "v");
});

test("applySecurityHeaders lets policy.headers override defaults (case-insensitively)", () => {
  const headers: Headers = {};
  const policy: SecurityPolicy = {
    headers: {
      "X-Frame-Options": "SAMEORIGIN",
      "content-security-policy": "default-src 'self'",
    },
  };
  const merged = applySecurityHeaders(headers, policy);

  // Override wins over the default, and is stored under the lower-cased key.
  assert.equal(merged["x-frame-options"], "SAMEORIGIN");
  // New policy header present.
  assert.equal(merged["content-security-policy"], "default-src 'self'");
  // Untouched defaults remain.
  assert.equal(merged["x-content-type-options"], "nosniff");
});

test("applySecurityHeaders: defaults win over pre-existing response headers of the same name", () => {
  const headers: Headers = { "x-frame-options": "ALLOWALL" };
  const merged = applySecurityHeaders(headers);
  assert.equal(merged["x-frame-options"], "DENY");
});

test("applySecurityHeaders precedence: response < defaults < policy", () => {
  const headers: Headers = { "x-frame-options": "ALLOWALL" };
  const policy: SecurityPolicy = { headers: { "x-frame-options": "SAMEORIGIN" } };
  const merged = applySecurityHeaders(headers, policy);
  assert.equal(merged["x-frame-options"], "SAMEORIGIN");
});

// ── enforceBodyLimit ────────────────────────────────────────────────────────────

test("enforceBodyLimit throws PayloadTooLargeError when the body exceeds the limit", () => {
  const body = new Uint8Array(11);
  const policy: SecurityPolicy = { maxBodyBytes: 10 };
  assert.throws(
    () => enforceBodyLimit(body, policy),
    (err: unknown) => {
      assert.ok(err instanceof PayloadTooLargeError);
      assert.equal(err.limitBytes, 10);
      assert.equal(err.status, 413);
      return true;
    },
  );
});

test("enforceBodyLimit is a no-op for a body exactly at the limit", () => {
  const body = new Uint8Array(10);
  assert.doesNotThrow(() => enforceBodyLimit(body, { maxBodyBytes: 10 }));
});

test("enforceBodyLimit is a no-op for a body under the limit", () => {
  const body = new Uint8Array(3);
  assert.doesNotThrow(() => enforceBodyLimit(body, { maxBodyBytes: 10 }));
});

test("enforceBodyLimit is a no-op when maxBodyBytes is unset", () => {
  const body = new Uint8Array(1_000);
  assert.doesNotThrow(() => enforceBodyLimit(body, {}));
  assert.doesNotThrow(() => enforceBodyLimit(body, undefined));
});

test("enforceBodyLimit is a no-op when the body is undefined", () => {
  assert.doesNotThrow(() => enforceBodyLimit(undefined, { maxBodyBytes: 10 }));
});

// ── resolveHeaderTimeoutMs ───────────────────────────────────────────────────────

test("resolveHeaderTimeoutMs returns the configured value", () => {
  assert.equal(resolveHeaderTimeoutMs({ headerTimeoutMs: 5_000 }), 5_000);
});

test("resolveHeaderTimeoutMs returns undefined when unset or no policy", () => {
  assert.equal(resolveHeaderTimeoutMs({}), undefined);
  assert.equal(resolveHeaderTimeoutMs(undefined), undefined);
});
