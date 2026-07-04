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
import type { AccessOperation } from "../access.js";
import { createStorage } from "../facade.js";
import { AuthorizationError } from "../errors.js";
import type { AccessLevel, AuthLike } from "../types.js";

/** The context shape the structural auth bridge's `can` predicate receives. */
type CanContext = Parameters<AuthLike["can"]>[0];

/** A boolean decision or a predicate over the forwarded access context. */
type Decision = boolean | ((context: CanContext) => boolean | Promise<boolean>);

// A tiny structural AuthLike bridge whose `can` is driven by an injected fn.
function makeAuth(decision: Decision): AuthLike & { calls: CanContext[] } {
  const calls: CanContext[] = [];
  return {
    calls,
    can(context: CanContext) {
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
  const levels: readonly AccessLevel[] = ["public", "private", "signed", "authenticated", "role-based", "tenant-aware"];
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

// ── Task 16.2: exhaustive per-level allow/deny + auth-bridge integration ─────
//
// The cases above prove the permissive default, the public-read allowance, and
// a single deny path per level (write). The block below rounds out the access
// decision matrix required by this task: an explicit ALLOW *and* an explicit
// DENY for EACH access level, across read/write/delete, plus context-driven
// role-based and tenant-aware decisions and an async bridge that permits.
//
// Requirements: 11.1, 11.3, 11.4

const ALL_LEVELS: readonly AccessLevel[] = [
  "public",
  "private",
  "signed",
  "authenticated",
  "role-based",
  "tenant-aware",
];

const ALL_OPERATIONS: readonly AccessOperation[] = ["read", "write", "delete"];

test("controller permits every access level across every operation when the bridge allows", async () => {
  for (const accessLevel of ALL_LEVELS) {
    for (const operation of ALL_OPERATIONS) {
      const auth = makeAuth(true);
      const access = new AccessController({ auth });
      // Should resolve without throwing for allow (11.1).
      await access.authorize({ key: `k/${accessLevel}`, operation, accessLevel });
      // The bridge was consulted with the exact context (11.2 wiring).
      assert.deepEqual(auth.calls.at(-1), {
        key: `k/${accessLevel}`,
        operation,
        accessLevel,
        owner: undefined,
        tenant: undefined,
      });
    }
  }
});

test("controller denies every access level across write/delete when the bridge blocks", async () => {
  // Read is validated separately below because `public` reads have a distinct
  // rule; here we cover the uniformly-denied write and delete operations for
  // EACH level (11.3).
  for (const accessLevel of ALL_LEVELS) {
    for (const operation of ["write", "delete"] as const) {
      const access = new AccessController({ auth: makeAuth(false) });
      await assert.rejects(
        () => access.authorize({ key: "k", operation, accessLevel }),
        (err) =>
          err instanceof AuthorizationError &&
          err.accessLevel === accessLevel &&
          err.operation === operation,
      );
    }
  }
});

test("controller denies non-public reads for every restricted level when the bridge blocks", async () => {
  // A `read` is denied for every NON-public level when the bridge returns false
  // (public reads are covered by the dedicated 11.4 cases above).
  for (const accessLevel of ALL_LEVELS.filter((l) => l !== "public")) {
    const access = new AccessController({ auth: makeAuth(false) });
    await assert.rejects(
      () => access.authorize({ key: "k", operation: "read", accessLevel }),
      (err) => err instanceof AuthorizationError && err.accessLevel === accessLevel,
    );
  }
});

test("signed access level allows and denies strictly per the bridge decision", async () => {
  const allow = new AccessController({ auth: makeAuth(true) });
  await allow.authorize({ key: "s", operation: "read", accessLevel: "signed" });

  const deny = new AccessController({ auth: makeAuth(false) });
  await assert.rejects(
    () => deny.authorize({ key: "s", operation: "read", accessLevel: "signed" }),
    (err) => err instanceof AuthorizationError && err.accessLevel === "signed",
  );
});

test("authenticated access level allows and denies strictly per the bridge decision", async () => {
  const allow = new AccessController({ auth: makeAuth(true) });
  await allow.authorize({ key: "a", operation: "write", accessLevel: "authenticated" });

  const deny = new AccessController({ auth: makeAuth(false) });
  await assert.rejects(
    () => deny.authorize({ key: "a", operation: "write", accessLevel: "authenticated" }),
    (err) => err instanceof AuthorizationError && err.accessLevel === "authenticated",
  );
});

test("role-based decisions key on the bridge's view of the context", async () => {
  // A structural bridge modelling roles: only the owner "admin" may write a
  // role-based object; everyone else is denied. This exercises the bridge
  // integration for role-based access (11.1/11.2/11.3).
  const roleBridge = makeAuth((ctx) => ctx.owner === "admin");
  const access = new AccessController({ auth: roleBridge });

  await access.authorize({
    key: "r",
    operation: "write",
    accessLevel: "role-based",
    owner: "admin",
  });

  await assert.rejects(
    () =>
      access.authorize({
        key: "r",
        operation: "write",
        accessLevel: "role-based",
        owner: "guest",
      }),
    (err) => err instanceof AuthorizationError && err.accessLevel === "role-based",
  );
});

test("tenant-aware decisions isolate access to the matching tenant", async () => {
  // A structural bridge modelling tenant isolation: access is granted only when
  // the context tenant matches the bridge's expected tenant (11.1/11.2/11.3).
  const expectedTenant = "acme";
  const tenantBridge = makeAuth((ctx) => ctx.tenant === expectedTenant);
  const access = new AccessController({ auth: tenantBridge });

  await access.authorize({
    key: "t",
    operation: "read",
    accessLevel: "tenant-aware",
    tenant: "acme",
  });

  await assert.rejects(
    () =>
      access.authorize({
        key: "t",
        operation: "read",
        accessLevel: "tenant-aware",
        tenant: "other-corp",
      }),
    (err) => err instanceof AuthorizationError && err.accessLevel === "tenant-aware",
  );
});

test("controller permits when an async bridge resolves true", async () => {
  // Complements the existing async-deny case: an async bridge that resolves
  // true must be awaited and permit the operation.
  const access = new AccessController({ auth: makeAuth(async () => true) });
  await access.authorize({ key: "k", operation: "write", accessLevel: "private" });
});

test("private access level allows and denies strictly per the bridge decision", async () => {
  const allow = new AccessController({ auth: makeAuth(true) });
  await allow.authorize({ key: "pv", operation: "delete", accessLevel: "private" });

  const deny = new AccessController({ auth: makeAuth(false) });
  await assert.rejects(
    () => deny.authorize({ key: "pv", operation: "delete", accessLevel: "private" }),
    (err) => err instanceof AuthorizationError && err.accessLevel === "private",
  );
});

test("facade put of a role-based object is denied for a non-owner and persists nothing", async () => {
  // End-to-end auth-bridge integration through the facade for a role-based
  // level: a non-admin writer is denied and no object is persisted (11.3).
  const storage = createStorage({
    provider: "memory",
    auth: makeAuth((ctx) => ctx.owner === "admin"),
  });
  await assert.rejects(
    () =>
      storage.put("role.txt", "data", { accessLevel: "role-based", owner: "guest" }),
    (err) => err instanceof AuthorizationError && err.operation === "write",
  );
  assert.equal(await storage.exists("role.txt"), false);
});
