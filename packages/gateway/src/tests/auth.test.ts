import test from "node:test";
import assert from "node:assert/strict";

import { authenticate, authorize, isAuthorized, type AuthDeps } from "../auth.js";
import { ForbiddenError, UnauthenticatedError } from "../errors.js";
import type {
  AuthPolicy,
  AuthorizationPolicy,
  GatewayRequest,
  Headers,
  Identity,
} from "../types.js";

/** Build a minimal GatewayRequest with the given headers. */
function req(headers: Headers = {}, method = "GET"): GatewayRequest {
  return { method, url: "/", path: "/", headers };
}

const alice: Identity = { subject: "alice", roles: ["admin"], permissions: ["read", "write"] };

// ── authenticate: none / custom ─────────────────────────────────────────────────

test("kind 'none' resolves to null", async () => {
  const identity = await authenticate({ kind: "none" }, req());
  assert.equal(identity, null);
});

test("kind 'custom' returns the verifier's identity", async () => {
  const policy: AuthPolicy = { kind: "custom", verify: () => alice };
  assert.deepEqual(await authenticate(policy, req()), alice);
});

test("kind 'custom' returns null when the verifier declines", async () => {
  const policy: AuthPolicy = { kind: "custom", verify: async () => null };
  assert.equal(await authenticate(policy, req()), null);
});

test("kind 'custom' returns null when no verifier is provided", async () => {
  assert.equal(await authenticate({ kind: "custom" }, req()), null);
});

// ── authenticate: api-key ────────────────────────────────────────────────────────

test("kind 'api-key' resolves a valid key via injected map", async () => {
  const deps: AuthDeps = { apiKeys: (k) => (k === "secret" ? alice : null) };
  const identity = await authenticate({ kind: "api-key" }, req({ "x-api-key": "secret" }), deps);
  assert.deepEqual(identity, alice);
});

test("kind 'api-key' returns null for an unknown key", async () => {
  const deps: AuthDeps = { apiKeys: (k) => (k === "secret" ? alice : null) };
  const identity = await authenticate({ kind: "api-key" }, req({ "x-api-key": "nope" }), deps);
  assert.equal(identity, null);
});

test("kind 'api-key' returns null when the header is missing", async () => {
  const deps: AuthDeps = { apiKeys: () => alice };
  assert.equal(await authenticate({ kind: "api-key" }, req(), deps), null);
});

test("kind 'api-key' falls back to policy.verify when no deps map", async () => {
  const policy: AuthPolicy = { kind: "api-key", verify: () => alice };
  assert.deepEqual(await authenticate(policy, req({ "x-api-key": "x" })), alice);
});

// ── authenticate: jwt ──────────────────────────────────────────────────────────────

test("kind 'jwt' parses Bearer token and resolves via injected verifier", async () => {
  let seen = "";
  const deps: AuthDeps = {
    verifyJwt: (t) => {
      seen = t;
      return alice;
    },
  };
  const identity = await authenticate({ kind: "jwt" }, req({ authorization: "Bearer tok.123" }), deps);
  assert.equal(seen, "tok.123");
  assert.deepEqual(identity, alice);
});

test("kind 'jwt' returns null when the verifier rejects", async () => {
  const deps: AuthDeps = { verifyJwt: async () => null };
  const identity = await authenticate({ kind: "jwt" }, req({ authorization: "Bearer bad" }), deps);
  assert.equal(identity, null);
});

test("kind 'jwt' returns null when the authorization header is missing", async () => {
  const deps: AuthDeps = { verifyJwt: () => alice };
  assert.equal(await authenticate({ kind: "jwt" }, req(), deps), null);
});

test("kind 'jwt' returns null for a non-Bearer scheme", async () => {
  const deps: AuthDeps = { verifyJwt: () => alice };
  const identity = await authenticate({ kind: "jwt" }, req({ authorization: "Basic abc" }), deps);
  assert.equal(identity, null);
});

test("kind 'jwt' returns null when neither verifier is provided", async () => {
  assert.equal(await authenticate({ kind: "jwt" }, req({ authorization: "Bearer t" })), null);
});

// ── bearer parsing: scheme, separators, and ReDoS regression ─────────────────────

test("kind 'jwt' is case-insensitive on the Bearer scheme and trims the token", async () => {
  let seen = "";
  const deps: AuthDeps = { verifyJwt: (t) => ((seen = t), alice) };
  await authenticate({ kind: "jwt" }, req({ authorization: "  bEaReR   tok.123  " }), deps);
  assert.equal(seen, "tok.123");
});

test("kind 'jwt' accepts a tab separator between scheme and token", async () => {
  let seen = "";
  const deps: AuthDeps = { verifyJwt: (t) => ((seen = t), alice) };
  await authenticate({ kind: "jwt" }, req({ authorization: "Bearer\t\ttok.123" }), deps);
  assert.equal(seen, "tok.123");
});

test("kind 'jwt' returns null when the scheme has no separator or token", async () => {
  const deps: AuthDeps = { verifyJwt: () => alice };
  // "Bearerx" (no separator) and bare "Bearer" (no token) must both be rejected.
  assert.equal(await authenticate({ kind: "jwt" }, req({ authorization: "Bearerx" }), deps), null);
  assert.equal(await authenticate({ kind: "jwt" }, req({ authorization: "Bearer" }), deps), null);
  assert.equal(await authenticate({ kind: "jwt" }, req({ authorization: "Bearer   " }), deps), null);
});

test("bearer parsing stays linear on adversarial whitespace (polynomial-ReDoS regression)", async () => {
  // Formerly quadratic input for /^Bearer[ \t]+(.+)$/i: "bearer" + many tabs and
  // no non-whitespace token. Must resolve to null fast, not hang.
  const deps: AuthDeps = { verifyJwt: () => alice };
  const evil = "bearer" + "\t".repeat(200_000);
  const start = performance.now();
  const identity = await authenticate({ kind: "jwt" }, req({ authorization: evil }), deps);
  const elapsedMs = performance.now() - start;
  assert.equal(identity, null);
  assert.ok(elapsedMs < 1000, `bearer parse took ${elapsedMs.toFixed(1)}ms (expected < 1000ms)`);
});

// ── authenticate: session ────────────────────────────────────────────────────────

test("kind 'session' resolves via x-session-id header", async () => {
  const deps: AuthDeps = { sessions: (s) => (s === "sess-1" ? alice : null) };
  const identity = await authenticate({ kind: "session" }, req({ "x-session-id": "sess-1" }), deps);
  assert.deepEqual(identity, alice);
});

test("kind 'session' resolves via cookie header", async () => {
  const deps: AuthDeps = { sessions: (s) => (s === "sess-1" ? alice : null) };
  const identity = await authenticate({ kind: "session" }, req({ cookie: "foo=bar; session=sess-1" }), deps);
  assert.deepEqual(identity, alice);
});

test("kind 'session' returns null when no session id present", async () => {
  const deps: AuthDeps = { sessions: () => alice };
  assert.equal(await authenticate({ kind: "session" }, req(), deps), null);
});

// ── authorize: public / authenticated ──────────────────────────────────────────────

test("public allows an anonymous request", async () => {
  await assert.doesNotReject(authorize({ kind: "public" }, null, req()));
});

test("authenticated rejects anonymous with UnauthenticatedError", async () => {
  await assert.rejects(authorize({ kind: "authenticated" }, null, req()), UnauthenticatedError);
});

test("authenticated allows a resolved identity", async () => {
  await assert.doesNotReject(authorize({ kind: "authenticated" }, alice, req()));
});

// ── authorize: role ─────────────────────────────────────────────────────────────

test("role allows when a required role is present", async () => {
  const policy: AuthorizationPolicy = { kind: "role", roles: ["admin", "root"] };
  await assert.doesNotReject(authorize(policy, alice, req()));
});

test("role throws ForbiddenError when identity lacks the role", async () => {
  const policy: AuthorizationPolicy = { kind: "role", roles: ["root"] };
  await assert.rejects(authorize(policy, alice, req()), ForbiddenError);
});

test("role throws UnauthenticatedError when anonymous", async () => {
  const policy: AuthorizationPolicy = { kind: "role", roles: ["admin"] };
  await assert.rejects(authorize(policy, null, req()), UnauthenticatedError);
});

// ── authorize: permission ─────────────────────────────────────────────────────────

test("permission allows when a required permission is present", async () => {
  const policy: AuthorizationPolicy = { kind: "permission", permissions: ["write"] };
  await assert.doesNotReject(authorize(policy, alice, req()));
});

test("permission throws ForbiddenError when identity lacks the permission", async () => {
  const policy: AuthorizationPolicy = { kind: "permission", permissions: ["delete"] };
  await assert.rejects(authorize(policy, alice, req()), ForbiddenError);
});

test("permission throws UnauthenticatedError when anonymous", async () => {
  const policy: AuthorizationPolicy = { kind: "permission", permissions: ["read"] };
  await assert.rejects(authorize(policy, null, req()), UnauthenticatedError);
});

// ── authorize: custom ─────────────────────────────────────────────────────────────

test("custom allows when decide returns true", async () => {
  const policy: AuthorizationPolicy = { kind: "custom", decide: () => true };
  await assert.doesNotReject(authorize(policy, alice, req()));
});

test("custom throws ForbiddenError when decide returns false", async () => {
  const policy: AuthorizationPolicy = { kind: "custom", decide: async () => false };
  await assert.rejects(authorize(policy, alice, req()), ForbiddenError);
});

test("custom throws ForbiddenError for anonymous when decide returns false", async () => {
  const policy: AuthorizationPolicy = { kind: "custom", decide: () => false };
  await assert.rejects(authorize(policy, null, req()), ForbiddenError);
});

// ── isAuthorized: non-throwing mirror ──────────────────────────────────────────────

test("isAuthorized returns true when authorize allows", async () => {
  assert.equal(await isAuthorized({ kind: "public" }, null, req()), true);
  assert.equal(await isAuthorized({ kind: "role", roles: ["admin"] }, alice, req()), true);
});

test("isAuthorized returns false when authorize denies", async () => {
  assert.equal(await isAuthorized({ kind: "authenticated" }, null, req()), false);
  assert.equal(await isAuthorized({ kind: "role", roles: ["root"] }, alice, req()), false);
});
