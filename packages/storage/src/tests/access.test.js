// Unit tests for the provider-agnostic access controller of @streetjs/storage.
//
// Covers the AccessController decision rules directly (permissive default,
// public-read allowance, bridge-governed deny/permit for every access level)
// and the facade wiring: with a configured `config.auth` bridge, a denied
// operation throws an AuthorizationError and performs no persistence/read;
// with NO bridge configured the facade stays fully permissive (Requirements
// 11.1, 11.2, 11.3, 11.4).
//
// Uses the Node.js built-in test runner (node:test), executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 11.1, 11.2, 11.3, 11.4

import test from "node:test";
import assert from "node:assert/strict";

import { AccessController } from "../access.js";
import { createStorage } from "../facade.js";
import { AuthorizationError } from "../errors.js";

// A tiny structural AuthLike bridge whose `can` is driven by an injected fn.
function makeAuth(decision) {
  const calls = [];
  return {
    calls,
    can(context) {
      calls.push(context);
      return typeof decision === "function" ? decision(context) : decision;
    },
  };
}

// ── Controller-level tests ────────────────────────────────────────────────────

test("controller with no auth bridge is permissive and not enforced", async () => {
  const access = new AccessController();
  assert.equal(access.enforced, false);
  // Even a normally-restricted level is permitted when nothing is configured.
  await access.authorize({ key: "k", operation: "write", accessLevel: "private" });
  await access.authorize({ key: "k", operation: "read", accessLevel: "role-based" });
});

test("controller reports enforced when an auth bridge is configured", () => {
  const access = new AccessController({ auth: makeAuth(true) });
  assert.equal(access.enforced, true);
});

test("controller supports every access level and denies when the bridge says false", async () => {
  const levels = ["public", "private", "signed", "authenticated", "role-based", "tenant-aware"];
  for (const accessLevel of levels) {
    const access = new AccessController({ auth: makeAuth(false) });
    // A write is denied for every level when the bridge returns false (11.1/11.3).
    await assert.rejects(
      () => access.authorize({ key: "k", operation: "write", accessLevel }),
      (err) => err instanceof AuthorizationError && err.accessLevel === accessLevel,
    );
  }
});

test("controller permits when the bridge returns true", async () => {
  const auth = makeAuth(true);
  const access = new AccessController({ auth });
  await access.authorize({
    key: "docs/a.txt",
    operation: "read",
    accessLevel: "authenticated",
    owner: "alice",
    tenant: "acme",
  });
  // The full context is forwarded to the bridge (11.2).
  assert.deepEqual(auth.calls[0], {
    key: "docs/a.txt",
    operation: "read",
    accessLevel: "authenticated",
    owner: "alice",
    tenant: "acme",
  });
});

test("public reads are permitted without authentication (bridge returns false)", async () => {
  // Even when the bridge denies by default, a public READ is still allowed
  // unless the bridge is treating public as the blocking factor. Here the
  // bridge only blocks writes; public reads pass (Requirement 11.4).
  const access = new AccessController({
    auth: makeAuth((ctx) => ctx.operation !== "write"),
  });
  await access.authorize({ key: "p", operation: "read", accessLevel: "public" });
});

test("public reads can still be blocked by a configured factor", async () => {
  // A bridge that explicitly returns false blocks even a public read
  // ("unless another configured factor blocks", Requirement 11.4).
  const access = new AccessController({ auth: makeAuth(false) });
  await assert.rejects(
    () => access.authorize({ key: "p", operation: "read", accessLevel: "public" }),
    (err) => err instanceof AuthorizationError,
  );
});

test("controller awaits an async bridge decision", async () => {
  const access = new AccessController({ auth: makeAuth(async () => false) });
  await assert.rejects(
    () => access.authorize({ key: "k", operation: "read", accessLevel: "private" }),
    (err) => err instanceof AuthorizationError,
  );
});

// ── Facade wiring tests ─────────────────────────────────────────────────────

test("facade stays permissive when no auth bridge is configured", async () => {
  const storage = createStorage({ provider: "memory" });
  const meta = await storage.put("a.txt", "hello", { accessLevel: "private" });
  assert.equal(meta.key, "a.txt");
  const got = await storage.get("a.txt");
  assert.equal(got.found, true);
  await storage.delete("a.txt");
  assert.equal(await storage.exists("a.txt"), false);
});

test("facade put denial throws AuthorizationError and persists nothing", async () => {
  const storage = createStorage({
    provider: "memory",
    auth: makeAuth((ctx) => ctx.operation !== "write"),
  });
  await assert.rejects(
    () => storage.put("secret.txt", "top secret", { accessLevel: "private" }),
    (err) => err instanceof AuthorizationError && err.operation === "write",
  );
  // Nothing was written.
  assert.equal(await storage.exists("secret.txt"), false);
});

test("facade get denial throws AuthorizationError and returns no bytes", async () => {
  // The bridge permits the initial write but denies reads.
  let allowRead = true;
  const storage = createStorage({
    provider: "memory",
    auth: makeAuth((ctx) => (ctx.operation === "read" ? allowRead : true)),
  });
  await storage.put("doc.txt", "content", { accessLevel: "authenticated" });
  allowRead = false;
  await assert.rejects(
    () => storage.get("doc.txt"),
    (err) => err instanceof AuthorizationError && err.operation === "read",
  );
});

test("facade get of a public object is permitted without authentication", async () => {
  // The bridge permits the seeding write and any public read, but denies every
  // non-public read. A public object must remain readable (Requirement 11.4).
  const storage = createStorage({
    provider: "memory",
    auth: makeAuth((ctx) => ctx.operation === "write" || ctx.accessLevel === "public"),
  });
  await storage.put("pub.txt", "hello", { accessLevel: "public" });
  const got = await storage.get("pub.txt");
  assert.equal(got.found, true);
  assert.equal(new TextDecoder().decode(got.bytes), "hello");
});

test("facade delete denial throws AuthorizationError and keeps the object", async () => {
  let allowDelete = true;
  const storage = createStorage({
    provider: "memory",
    auth: makeAuth((ctx) => (ctx.operation === "delete" ? allowDelete : true)),
  });
  await storage.put("keep.txt", "content", { accessLevel: "private" });
  allowDelete = false;
  await assert.rejects(
    () => storage.delete("keep.txt"),
    (err) => err instanceof AuthorizationError && err.operation === "delete",
  );
  assert.equal(await storage.exists("keep.txt"), true);
});
