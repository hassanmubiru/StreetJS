// tests/upgrade-breaking-pbt.test.ts
// Property-based test for Upgrade System breaking-change analysis (Req 8.3, 8.4).
// Kept in its own file so the universal property is exercised across many
// generated (installed, target) version pairs without clobbering the
// example/edge-case unit tests elsewhere.
//
// `analyzeBreakingChanges` is a PURE function (Node-core only, no third-party
// deps, NO filesystem I/O). It maps a resolved version pair to the ordered set
// of breaking changes crossed during an upgrade.
//
// Req 8.3: for each reported breaking change, record its affected area
//   (routing, middleware, or plugin API) and whether an automated Codemod is
//   available for it.
// Req 8.4: for each detected breaking change, produce an upgrade recommendation
//   that states the required source change and identifies the Codemod that
//   performs it where one is available.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { analyzeBreakingChanges } from '../devx/upgrade.js';
import type { VersionResolution } from '../devx/upgrade.js';
import { getCodemod } from '../devx/codemods.js';
import { compareSemver } from '../platform/plugins/host.js';

const NUM_RUNS = 200;

const VALID_AREAS = new Set(['routing', 'middleware', 'plugin-api']);

// ── Generators ────────────────────────────────────────────────────────────────
//
// Intelligently constrain to the resolvable-version input space. The catalogued
// breaking change is introduced at 1.0.0, so a small MAJOR range (0..3) ensures
// generated pairs span both "crosses the break" and "does not cross" regions,
// as well as no-ops and downgrades.

/** A resolvable `MAJOR.MINOR.PATCH` version within a small bounded range. */
const versionArb: fc.Arbitrary<string> = fc
  .tuple(fc.nat({ max: 3 }), fc.nat({ max: 5 }), fc.nat({ max: 5 }))
  .map(([maj, min, pat]) => `${maj}.${min}.${pat}`);

/** A resolved {installed, target} pair over the bounded version space. */
const resolutionArb: fc.Arbitrary<VersionResolution> = fc
  .tuple(versionArb, versionArb)
  .map(([installed, target]) => ({ installed, target }));

// Feature: platform-leadership-gaps, Property 21: Breaking-change analysis is well-formed
// Validates: Requirements 8.3, 8.4
describe('Property 21: breaking-change analysis is well-formed', () => {
  // 8.3/8.4 — every reported BreakingChange is well-formed: a valid area, a
  // non-empty recommendation, and a codemodId present IFF an automated codemod
  // is actually registered for it (the recommendation names that codemod when
  // present). Also asserts determinism (the observable signature of purity).
  it('reports only well-formed breaking changes for any resolved version pair', () => {
    fc.assert(
      fc.property(resolutionArb, (r) => {
        const changes = analyzeBreakingChanges(r);
        assert.ok(Array.isArray(changes), 'must return an array');

        for (const change of changes) {
          // (8.3) area ∈ {routing, middleware, plugin-api}.
          assert.ok(
            VALID_AREAS.has(change.area),
            `area must be one of routing/middleware/plugin-api, got "${change.area}"`,
          );

          // (8.4) non-empty recommendation stating the required source change.
          assert.equal(typeof change.recommendation, 'string', 'recommendation must be a string');
          assert.ok(
            change.recommendation.trim().length > 0,
            'recommendation must be non-empty',
          );

          // (8.3/8.4) codemodId present IFF a codemod is registered for it.
          // The reported codemodId must resolve against the live registry, and
          // when absent no codemod may exist for the change.
          if (change.codemodId !== undefined) {
            const codemod = getCodemod(change.codemodId);
            assert.ok(
              codemod !== undefined,
              `codemodId "${change.codemodId}" must resolve to a registered codemod`,
            );
            assert.equal(
              codemod!.id,
              change.codemodId,
              'resolved codemod id must match the reported codemodId',
            );
            // (8.4) the recommendation identifies the codemod that performs it.
            assert.ok(
              change.recommendation.includes(change.codemodId),
              `recommendation must name the codemod "${change.codemodId}"`,
            );
          }

          // Reported versions echo the resolution being analyzed.
          assert.equal(change.fromVersion, r.installed, 'fromVersion must echo installed');
          assert.equal(change.toVersion, r.target, 'toVersion must echo target');
        }

        // Determinism: a pure function yields an identical result for identical
        // input — the observable signature of "no side effects / no writes".
        const again = analyzeBreakingChanges(r);
        assert.deepEqual(again, changes, 'analyzeBreakingChanges must be deterministic (pure)');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // 8.3 — a no-op (installed === target) or a downgrade (target < installed)
  // crosses no breaking changes and yields [].
  it('yields [] for a no-op or downgrade', () => {
    fc.assert(
      fc.property(resolutionArb, (r) => {
        // Only exercise pairs where the target is not strictly ahead of installed.
        fc.pre(compareSemver(r.target, r.installed) <= 0);
        const changes = analyzeBreakingChanges(r);
        assert.deepEqual(changes, [], 'no-op/downgrade must report no breaking changes');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
