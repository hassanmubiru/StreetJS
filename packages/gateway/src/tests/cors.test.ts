import test from "node:test";
import assert from "node:assert/strict";

import { resolveCors } from "../cors.js";
import type { CorsPolicy, GatewayRequest, Headers } from "../types.js";

/** Build a minimal GatewayRequest with the given method and headers. */
function req(method: string, headers: Headers = {}): GatewayRequest {
  return { method, url: "/", path: "/", headers };
}

test("wildcard origin without credentials answers with literal '*'", () => {
  const policy: CorsPolicy = { origins: "*" };
  const res = resolveCors(policy, req("GET", { origin: "https://app.example" }));
  assert.equal(res.allowed, true);
  assert.equal(res.isPreflight, false);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(res.headers["Access-Control-Allow-Credentials"], undefined);
});

test("explicit allowlist echoes a matching origin", () => {
  const policy: CorsPolicy = { origins: ["https://a.example", "https://b.example"] };
  const res = resolveCors(policy, req("GET", { origin: "https://b.example" }));
  assert.equal(res.allowed, true);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://b.example");
  assert.equal(res.headers["Vary"], "Origin");
});

test("explicit allowlist rejects a non-matching origin (allowed=false, no ACAO)", () => {
  const policy: CorsPolicy = { origins: ["https://a.example"] };
  const res = resolveCors(policy, req("GET", { origin: "https://evil.example" }));
  assert.equal(res.allowed, false);
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("credentials echoes the specific origin, never '*'", () => {
  const policy: CorsPolicy = { origins: "*", credentials: true };
  const res = resolveCors(policy, req("GET", { origin: "https://app.example" }));
  assert.equal(res.allowed, true);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://app.example");
  assert.notEqual(res.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(res.headers["Access-Control-Allow-Credentials"], "true");
});

test("preflight sets methods, headers and max-age, and isPreflight is true", () => {
  const policy: CorsPolicy = {
    origins: ["https://a.example"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAgeSeconds: 600,
  };
  const res = resolveCors(
    policy,
    req("OPTIONS", {
      origin: "https://a.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type",
    }),
  );
  assert.equal(res.isPreflight, true);
  assert.equal(res.allowed, true);
  assert.equal(res.headers["Access-Control-Allow-Methods"], "GET,POST");
  assert.equal(res.headers["Access-Control-Allow-Headers"], "Content-Type,Authorization");
  assert.equal(res.headers["Access-Control-Max-Age"], "600");
});

test("preflight without policy headers echoes the requested headers and defaults methods", () => {
  const policy: CorsPolicy = { origins: "*" };
  const res = resolveCors(
    policy,
    req("OPTIONS", {
      origin: "https://app.example",
      "access-control-request-method": "PUT",
      "access-control-request-headers": "x-custom, content-type",
    }),
  );
  assert.equal(res.isPreflight, true);
  assert.equal(res.headers["Access-Control-Allow-Methods"], "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
  assert.equal(res.headers["Access-Control-Allow-Headers"], "x-custom, content-type");
});

test("non-preflight sets Access-Control-Expose-Headers when configured", () => {
  const policy: CorsPolicy = { origins: "*", exposedHeaders: ["X-Total-Count", "X-Page"] };
  const res = resolveCors(policy, req("GET", { origin: "https://app.example" }));
  assert.equal(res.isPreflight, false);
  assert.equal(res.headers["Access-Control-Expose-Headers"], "X-Total-Count,X-Page");
  // Expose-Headers is an actual-request concern, not a preflight one.
  assert.equal(res.headers["Access-Control-Allow-Methods"], undefined);
});

test("OPTIONS without access-control-request-method is not a preflight", () => {
  const policy: CorsPolicy = { origins: "*", exposedHeaders: ["X-Total-Count"] };
  const res = resolveCors(policy, req("OPTIONS", { origin: "https://app.example" }));
  assert.equal(res.isPreflight, false);
  assert.equal(res.headers["Access-Control-Allow-Methods"], undefined);
  assert.equal(res.headers["Access-Control-Expose-Headers"], "X-Total-Count");
});

test("missing Origin header → allowed true with no Access-Control-Allow-Origin", () => {
  const policy: CorsPolicy = { origins: ["https://a.example"] };
  const res = resolveCors(policy, req("GET"));
  assert.equal(res.allowed, true);
  assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("origin header is read case-insensitively", () => {
  const policy: CorsPolicy = { origins: ["https://a.example"] };
  const res = resolveCors(policy, req("GET", { Origin: "https://a.example" }));
  assert.equal(res.allowed, true);
  assert.equal(res.headers["Access-Control-Allow-Origin"], "https://a.example");
});
