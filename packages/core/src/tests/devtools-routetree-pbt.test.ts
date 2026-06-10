// tests/devtools-routetree-pbt.test.ts
// Property-based test for the Route Explorer route tree (Req 7.2).
// Kept in its own file so it does not clobber the example/edge-case unit tests
// in devtools.test.ts. The universal property here is exercised across many
// generated route sets; the concrete examples live in devtools.test.ts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  assembleRouteTree,
  flattenRouteTree,
} from '../devx/devtools.js';

// ── Generators ────────────────────────────────────────────────────────────────
//
// Intelligently constrain to the route input space:
//  - method: a real HTTP verb, generated in MIXED case so the property exercises
//    the implementation's method up-casing (Req 7.2 requires each registered
//    route to surface its HTTP method).
//  - path: always non-empty and rooted with '/'. Non-empty paths are required so
//    a leaf's stored path (`route.path || '/'`) is identical to the originating
//    path; this keeps the de-duplication key (uppercased-method + original path)
//    aligned with the flattened leaf, with no ambiguity introduced by the empty
//    path → '/' fallback. Segments may be plain, `:param`, or `{param}` style so
//    shared prefixes and templated paths are both covered.

const HTTP_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** A real HTTP verb, randomly upper/lower/mixed-cased to test up-casing. */
const methodArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(...HTTP_VERBS),
    fc.constantFrom<'upper' | 'lower'>('upper', 'lower'),
  )
  .map(([verb, casing]) => (casing === 'lower' ? verb.toLowerCase() : verb));

/** A single path segment: plain, a `:param`, or a `{param}` template. */
const segmentArb: fc.Arbitrary<string> = fc.oneof(
  fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/),
  fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/).map((s) => `:${s}`),
  fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/).map((s) => `{${s}}`),
);

/** A non-empty, rooted path. Allows the bare root '/' and multi-segment paths. */
const pathArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant('/'),
  fc.array(segmentArb, { minLength: 1, maxLength: 4 }).map((segs) => `/${segs.join('/')}`),
);

const routeArb: fc.Arbitrary<{ method: string; path: string }> = fc.record({
  method: methodArb,
  path: pathArb,
});

/** An arbitrary set (list, possibly with duplicates) of routes. */
const routesArb: fc.Arbitrary<Array<{ method: string; path: string }>> = fc.array(routeArb, {
  minLength: 0,
  maxLength: 30,
});

/** Normalize a route to its canonical "METHOD path" key. */
const key = (r: { method: string; path: string }): string => `${r.method.toUpperCase()} ${r.path}`;

// Feature: platform-leadership-gaps, Property 17: The route tree reflects exactly the registered routes
// Validates: Requirements 7.2
describe('Property 17: the route tree reflects exactly the registered routes', () => {
  it('flatten(assemble(routes)) equals the de-duplicated, method-uppercased route set — no more, no fewer', () => {
    fc.assert(
      fc.property(routesArb, (routes) => {
        const tree = assembleRouteTree(routes);
        const leaves = flattenRouteTree(tree);

        // The expected set: every registered route, with its method upper-cased,
        // de-duplicated by (uppercased method, path).
        const expected = new Set(routes.map(key));

        // The actual set produced by the tree's leaves.
        const actualKeys = leaves.map(key);
        const actual = new Set(actualKeys);

        // 1. Exactly the registered routes — no more, no fewer (set equality).
        assert.deepEqual(
          [...actual].sort(),
          [...expected].sort(),
          'leaf set must equal the de-duplicated registered route set',
        );

        // 2. No duplicate leaves: the tree de-duplicates, so the flattened
        //    multiset has no repeats (its length equals the unique count).
        assert.equal(
          actualKeys.length,
          actual.size,
          'flattened leaves must contain no duplicate routes',
        );

        // 3. Every leaf carries a non-empty, upper-cased HTTP method (Req 7.2):
        //    each registered route surfaces its method and path.
        for (const leaf of leaves) {
          assert.notEqual(leaf.method, '', 'a leaf must carry an HTTP method');
          assert.equal(leaf.method, leaf.method.toUpperCase(), 'leaf method must be upper-cased');
        }
      }),
      { numRuns: 200 },
    );
  });
});
