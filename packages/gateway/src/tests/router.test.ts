import test from "node:test";
import assert from "node:assert/strict";

import { Router, createRouter, resolveKind, specificity } from "../router.js";
import type { RouteConfig } from "../types.js";

/** Small helper to build a route with a sensible default service. */
function route(cfg: Partial<RouteConfig> & { pattern: string }): RouteConfig {
  return { service: "svc", ...cfg };
}

test("static kind matches only on exact path equality", () => {
  const r = createRouter([route({ pattern: "/users", kind: "static" })]);
  assert.deepEqual(r.match("/users"), {
    route: { service: "svc", pattern: "/users", kind: "static" },
    params: [],
  });
  assert.equal(r.match("/users/42"), null);
  assert.equal(r.match("/user"), null);
});

test("prefix kind matches the pattern itself and any sub-path", () => {
  const r = createRouter([route({ pattern: "/users", kind: "prefix" })]);
  assert.ok(r.match("/users"));
  assert.ok(r.match("/users/42"));
  assert.ok(r.match("/users/42/posts"));
  // A sibling that merely shares a prefix string must not match.
  assert.equal(r.match("/usersession"), null);
  assert.equal(r.match("/user"), null);
});

test("wildcard trailing '*' captures the remaining tail", () => {
  const r = createRouter([route({ pattern: "/users/*", kind: "wildcard" })]);
  assert.deepEqual(r.match("/users/42")?.params, ["42"]);
  assert.deepEqual(r.match("/users/42/posts")?.params, ["42/posts"]);
  // Needs at least one tail segment.
  assert.equal(r.match("/users"), null);
});

test("wildcard interior '*' captures exactly one segment", () => {
  const r = createRouter([route({ pattern: "/users/*/posts", kind: "wildcard" })]);
  assert.deepEqual(r.match("/users/42/posts")?.params, ["42"]);
  // Interior wildcard is single-segment: an extra segment must not match.
  assert.equal(r.match("/users/42/43/posts"), null);
  assert.equal(r.match("/users/42/comments"), null);
});

test("regex kind anchors the full path and exposes capture groups as params", () => {
  const r = createRouter([route({ pattern: "/api/(\\d+)/(\\w+)", kind: "regex" })]);
  assert.deepEqual(r.match("/api/42/posts")?.params, ["42", "posts"]);
  // Anchored: a partial match at the start is rejected.
  assert.equal(r.match("/api/42/posts/extra"), null);
  assert.equal(r.match("/prefix/api/42/posts"), null);
});

test("kind is inferred: '/*' → wildcard, otherwise static", () => {
  assert.equal(resolveKind(route({ pattern: "/files/*" })), "wildcard");
  assert.equal(resolveKind(route({ pattern: "/files" })), "static");

  const r = createRouter([route({ pattern: "/files/*" })]);
  assert.deepEqual(r.match("/files/a/b")?.params, ["a/b"]);
  assert.equal(r.match("/files"), null);

  const s = createRouter([route({ pattern: "/health" })]);
  assert.ok(s.match("/health"));
  assert.equal(s.match("/health/live"), null);
});

test("method filtering is case-insensitive and honored when methods are set", () => {
  const r = createRouter([route({ pattern: "/users", kind: "prefix", methods: ["GET", "post"] })]);
  assert.ok(r.match("/users", "get"));
  assert.ok(r.match("/users", "POST"));
  assert.equal(r.match("/users", "DELETE"), null);
  // No method supplied → method filter is skipped (path-only match).
  assert.ok(r.match("/users"));
});

test("priority selection returns the highest-priority matching route", () => {
  const low = route({ pattern: "/api", kind: "prefix", priority: 1, service: "low" });
  const high = route({ pattern: "/api", kind: "prefix", priority: 5, service: "high" });
  const r = createRouter([low, high]);
  assert.equal(r.match("/api/x")?.route.service, "high");

  // Order independence: same result regardless of declaration order.
  const r2 = createRouter([high, low]);
  assert.equal(r2.match("/api/x")?.route.service, "high");
});

test("ties break toward the most specific (longer literal prefix)", () => {
  const broad = route({ pattern: "/api", kind: "prefix", service: "broad" });
  const specific = route({ pattern: "/api/v1", kind: "prefix", service: "specific" });
  const r = createRouter([broad, specific]);
  assert.equal(r.match("/api/v1/users")?.route.service, "specific");

  assert.ok(specificity(specific) > specificity(broad));
});

test("remaining ties break by declaration order", () => {
  const first = route({ pattern: "/api", kind: "prefix", service: "first" });
  const second = route({ pattern: "/api", kind: "prefix", service: "second" });
  const r = createRouter([first, second]);
  // Equal priority and equal specificity → the earlier declaration wins.
  assert.equal(r.match("/api/x")?.route.service, "first");
});

test("no match returns null (never throws)", () => {
  const r = createRouter([route({ pattern: "/users", kind: "static" })]);
  assert.equal(r.match("/nope"), null);
  assert.equal(r.match("/nope", "GET"), null);
});

test("query strings are ignored during matching", () => {
  const r = createRouter([route({ pattern: "/users/*", kind: "wildcard" })]);
  assert.deepEqual(r.match("/users/42?full=1")?.params, ["42"]);

  const s = createRouter([route({ pattern: "/health", kind: "static" })]);
  assert.ok(s.match("/health?probe=1"));
});

test("Router class and createRouter factory are interchangeable", () => {
  const routes = [route({ pattern: "/x", kind: "static" })];
  const a = new Router(routes);
  const b = createRouter(routes);
  assert.deepEqual(a.match("/x"), b.match("/x"));
});
