// tests/upgrade-resolve-pbt.test.ts
// Property-based test for Upgrade System version resolution (Req 8.1, 8.2).
// Kept in its own file so the universal property is exercised across many
// generated (installed, targetArg, latest) triples without clobbering the
// example/edge-case unit tests elsewhere.
//
// `resolveVersions` is a PURE function (Node-core only, no third-party deps,
// NO filesystem I/O). Because it never touches the filesystem, "performs no
// writes" is structurally guaranteed: a thrown error cannot have mutated any
// file. The property below additionally asserts determinism (same input ->
// same result / same throw), which is the observable signature of purity.
//
// Req 8.1: detect the installed version and resolve the target from the
//   target argument, defaulting to the latest available version when no
//   target argument is supplied.
// Req 8.2: if the installed or target version cannot be determined, halt,
//   leave all source files unchanged, and report an error indicating WHICH
//   version could not be resolved.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { resolveVersions } from '../devx/upgrade.js';

const NUM_RUNS = 200;

// ── Local mirror of the implementation's resolvability predicate ──────────────
// Used ONLY to constrain/validate the generators (so "valid" arbitraries are
// truly accepted and "invalid" ones truly rejected by the function). Mirrors
// `isResolvableVersion` in upgrade.ts.
const isResolvable = (v: string | null | undefined): v is string => {
  if (typeof v !== 'string') return false;
  const core = v.trim().replace(/^v/, '');
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z-.]+)?$/.test(core);
};

// ── Generators ────────────────────────────────────────────────────────────────
//
// Intelligently constrain to the version input space.

/** A pre-release/build suffix: `[-+]` followed by 1..8 chars from `[0-9A-Za-z-.]`. */
const suffixArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('-', '+'),
    fc
      .array(fc.constantFrom(...'0123456789ABCDEFabcdef-.'.split('')), {
        minLength: 1,
        maxLength: 8,
      })
      .map((cs) => cs.join('')),
  )
  .map(([lead, body]) => lead + body);

/** A resolvable `MAJOR.MINOR.PATCH` version, optionally `v`-prefixed and
 *  optionally carrying a pre-release/build suffix. Every value satisfies the
 *  implementation's `isResolvableVersion`. */
const validSemverArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 }),
    fc.nat({ max: 999 }),
    fc.option(suffixArb, { nil: undefined }),
    fc.boolean(),
  )
  .map(([maj, min, pat, suffix, vPrefix]) => `${vPrefix ? 'v' : ''}${maj}.${min}.${pat}${suffix ?? ''}`)
  // Guard the generator against any drift from the predicate.
  .filter(isResolvable);

/** A NON-EMPTY string that is NOT a resolvable version. Non-empty matters
 *  because an empty target argument means "use latest", not "unresolvable". */
const invalidNonEmptyArb: fc.Arbitrary<string> = fc
  .oneof(
    fc.constantFrom(
      '1',
      '1.2',
      '1.2.',
      '1..2',
      '1.2.3.4',
      '1.2.x',
      'v',
      'abc',
      'latest',
      'x.y.z',
      '1.2.beta',
      '1.2.3 4',
      ' ',
    ),
    fc.string(),
  )
  .filter((s) => s.length > 0 && !isResolvable(s));

/** A target argument that defaults resolution to `latest`: undefined or empty. */
const absentTargetArb: fc.Arbitrary<string | undefined> = fc.constantFrom(undefined, '');

/** Any well-formed target argument: absent (undefined/''), or a valid version. */
const anyTargetArb: fc.Arbitrary<string | undefined> = fc.oneof(
  absentTargetArb,
  validSemverArb,
);

// Feature: platform-leadership-gaps, Property 20: Version resolution prefers the explicit target, else latest
// Validates: Requirements 8.1, 8.2
describe('Property 20: version resolution prefers the explicit target, else latest', () => {
  // 8.1 — happy path: target = targetArg when supplied & non-empty, else latest;
  // installed is echoed through. Also asserts determinism (purity signature).
  it('resolves target to the explicit argument when supplied, else to latest, and echoes installed', () => {
    fc.assert(
      fc.property(validSemverArb, validSemverArb, anyTargetArb, (installed, latest, targetArg) => {
        const result = resolveVersions({ targetArg, latest, installed });

        const expectedTarget =
          targetArg !== undefined && targetArg !== '' ? targetArg : latest;

        assert.equal(result.installed, installed, 'installed must be echoed through unchanged');
        assert.equal(result.target, expectedTarget, 'target must prefer the explicit arg, else latest');

        // Determinism: a pure function yields an identical result for identical
        // input — the observable signature of "no side effects / no writes".
        const again = resolveVersions({ targetArg, latest, installed });
        assert.deepEqual(again, result, 'resolveVersions must be deterministic (pure)');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // 8.1 — when an explicit, resolvable target is supplied it is ALWAYS used,
  // independent of `latest`.
  it('prefers the explicit target over latest whenever a resolvable target argument is present', () => {
    fc.assert(
      fc.property(validSemverArb, validSemverArb, validSemverArb, (installed, latest, targetArg) => {
        const result = resolveVersions({ targetArg, latest, installed });
        assert.equal(result.target, targetArg, 'an explicit resolvable target must win over latest');
        assert.equal(result.installed, installed);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // 8.1 — when no target argument is supplied (undefined or empty), `latest`
  // is used.
  it('falls back to latest when the target argument is absent or empty', () => {
    fc.assert(
      fc.property(validSemverArb, validSemverArb, absentTargetArb, (installed, latest, targetArg) => {
        const result = resolveVersions({ targetArg, latest, installed });
        assert.equal(result.target, latest, 'absent/empty target argument must resolve to latest');
        assert.equal(result.installed, installed);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // 8.2 — installed version cannot be determined (null or unresolvable): the
  // function throws an error indicating the installed version could not be
  // resolved. Because it is pure, no files are written.
  it('throws an error naming the installed version when it cannot be resolved', () => {
    const installedArb = fc.oneof(fc.constant(null), invalidNonEmptyArb);
    fc.assert(
      fc.property(installedArb, validSemverArb, anyTargetArb, (installed, latest, targetArg) => {
        let threw = false;
        try {
          resolveVersions({ targetArg, latest, installed });
        } catch (err) {
          threw = true;
          assert.ok(err instanceof Error, 'must throw an Error');
          assert.match(err.message, /installed/i, 'error must indicate the installed version');
          // When the unresolvable installed value is a non-empty string, the
          // error names that exact offending value.
          if (typeof installed === 'string') {
            assert.ok(
              err.message.includes(installed),
              `error must name the offending installed version: "${installed}"`,
            );
          }
        }
        assert.ok(threw, 'an unresolvable installed version must halt with a thrown error');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // 8.2 — target version cannot be determined: either an explicit non-empty
  // unresolvable argument, or an absent argument with an unresolvable `latest`.
  // The function throws an error naming the offending target version.
  it('throws an error naming the target version when it cannot be resolved', () => {
    // Two shapes of an unresolvable target, with the offending value computed
    // exactly as the implementation resolves it.
    const unresolvableTargetCaseArb = fc.oneof(
      // (a) explicit, non-empty, unresolvable target argument
      invalidNonEmptyArb.map((targetArg) => ({ targetArg, latest: '1.0.0' as string })),
      // (b) absent/empty target argument with an unresolvable `latest`
      fc
        .tuple(absentTargetArb, invalidNonEmptyArb)
        .map(([targetArg, latest]) => ({ targetArg, latest })),
    );

    fc.assert(
      fc.property(validSemverArb, unresolvableTargetCaseArb, (installed, { targetArg, latest }) => {
        const offending = targetArg !== undefined && targetArg !== '' ? targetArg : latest;
        let threw = false;
        try {
          resolveVersions({ targetArg, latest, installed });
        } catch (err) {
          threw = true;
          assert.ok(err instanceof Error, 'must throw an Error');
          assert.match(err.message, /target/i, 'error must indicate the target version');
          assert.ok(
            err.message.includes(offending),
            `error must name the offending target version: "${offending}"`,
          );
        }
        assert.ok(threw, 'an unresolvable target version must halt with a thrown error');
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
