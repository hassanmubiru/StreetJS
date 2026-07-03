import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createRouter } from "../router.js";
import type { RouteConfig, RouteMatchKind } from "../types.js";

/**
 * Feature: gateway, Property: routing
 *
 * These properties check the router against an independent reference
 * implementation of matching and selection. Generators are deliberately small
 * and deterministic, and restricted to the `static`/`prefix`/`wildcard` kinds so
 * the reference notions of "genuinely matches" and "specificity" are precise.
 */

// ── Independent reference semantics (deliberately re-implemented) ──────────────

function stripQuery(path: string): string {
  const q = path.indexOf("?");
  return q === -1 ? path : path.slice(0, q);
}

function refMethodAllows(route: RouteConfig, method: string | undefined): boolean {
  if (!route.methods || route.methods.length === 0) return true;
  if (method === undefined) return true;
  const upper = method.toUpperCase();
  return route.methods.some((m) => m.toUpperCase() === upper);
}

/** Reference matcher: does the route genuinely match the (clean) path? */
function refMatches(route: RouteConfig, path: string): boolean {
  const kind: RouteMatchKind =
    route.kind ?? (route.pattern.endsWith("/*") ? "wildcard" : "static");
  switch (kind) {
    case "static":
      return path === route.pattern;
    case "prefix": {
      if (path === route.pattern) return true;
      const withSlash = route.pattern.endsWith("/") ? route.pattern : route.pattern + "/";
      return path.startsWith(withSlash);
    }
    case "wildcard": {
      const pSegs = route.pattern.split("/");
      const uSegs = path.split("/");
      let ui = 0;
      for (let pi = 0; pi < pSegs.length; pi++) {
        const seg = pSegs[pi]!;
        const isLast = pi === pSegs.length - 1;
        if (seg === "*") {
          if (ui >= uSegs.length) return false;
          if (isLast) {
            ui = uSegs.length;
          } else {
            ui++;
          }
        } else {
          if (ui >= uSegs.length || uSegs[ui] !== seg) return false;
          ui++;
        }
      }
      return ui === uSegs.length;
    }
    default:
      return false;
  }
}

/** Reference specificity: literal-prefix length used for tie-breaking. */
function refSpecificity(route: RouteConfig): number {
  const kind: RouteMatchKind =
    route.kind ?? (route.pattern.endsWith("/*") ? "wildcard" : "static");
  if (kind === "wildcard") {
    const star = route.pattern.indexOf("*");
    return star === -1 ? route.pattern.length : star;
  }
  return route.pattern.length;
}

// ── Generators ────────────────────────────────────────────────────────────────

const segArb = fc.constantFrom("users", "posts", "a", "b", "v1", "health", "x");
const litSegsArb = fc.array(segArb, { minLength: 1, maxLength: 3 });

const routeSpecArb = fc.record({
  segs: litSegsArb,
  kind: fc.constantFrom<RouteMatchKind>("static", "prefix", "wildcard"),
  starPos: fc.nat(),
  priority: fc.integer({ min: 0, max: 3 }),
  methods: fc.option(fc.subarray(["GET", "POST", "DELETE"], { minLength: 1 }), { nil: undefined }),
  service: fc.constantFrom("s0", "s1", "s2"),
});

function toRouteConfig(spec: {
  segs: string[];
  kind: RouteMatchKind;
  starPos: number;
  priority: number;
  methods: string[] | undefined;
  service: string;
}): RouteConfig {
  let pattern: string;
  if (spec.kind === "wildcard") {
    const arr = spec.segs.slice();
    const pos = spec.starPos % (arr.length + 1); // 0..arr.length (arr.length → trailing)
    arr.splice(pos, 0, "*");
    pattern = "/" + arr.join("/");
  } else {
    pattern = "/" + spec.segs.join("/");
  }
  return {
    pattern,
    kind: spec.kind,
    priority: spec.priority,
    service: spec.service,
    ...(spec.methods ? { methods: spec.methods } : {}),
  };
}

const pathArb = fc
  .array(segArb, { minLength: 0, maxLength: 4 })
  .map((a) => "/" + a.join("/"));

const requestArb = fc.record({
  path: pathArb,
  query: fc.option(fc.constantFrom("?a=1", "?full=1&x=2", ""), { nil: undefined }),
  method: fc.option(fc.constantFrom("GET", "POST", "DELETE"), { nil: undefined }),
});

// ── Properties ─────────────────────────────────────────────────────────────────

test("Feature: gateway, Property: routing — returned route genuinely matches and is maximal", () => {
  fc.assert(
    fc.property(
      fc.array(routeSpecArb, { minLength: 1, maxLength: 5 }),
      requestArb,
      (specs, req) => {
        const routes = specs.map(toRouteConfig);
        const router = createRouter(routes);
        const fullPath = req.path + (req.query ?? "");
        const clean = stripQuery(fullPath);

        const result = router.match(fullPath, req.method);

        // Independent set of genuinely-matching routes (respecting method filter).
        const matching = routes
          .map((r, i) => ({ r, i }))
          .filter(({ r }) => refMethodAllows(r, req.method) && refMatches(r, clean));

        if (result === null) {
          // (a) null iff nothing genuinely matches.
          assert(matching.length === 0);
          return;
        }

        // (a) the returned route genuinely matches under its kind + method.
        assert(refMatches(result.route, clean));
        assert(refMethodAllows(result.route, req.method));

        // (b) it is the maximal by (priority desc, specificity desc, index asc).
        const better = (cur: { r: RouteConfig; i: number }, best: { r: RouteConfig; i: number }) => {
          const cp = cur.r.priority ?? 0;
          const bp = best.r.priority ?? 0;
          if (cp !== bp) return cp > bp;
          const cs = refSpecificity(cur.r);
          const bs = refSpecificity(best.r);
          if (cs !== bs) return cs > bs;
          return cur.i < best.i;
        };
        const expected = matching.reduce((best, cur) => (better(cur, best) ? cur : best));
        assert(result.route === expected.r);
      },
    ),
    { numRuns: 100 },
  );
});
