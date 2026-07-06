// tests/release-semver-notes-pbt.test.ts
// Property-based test for the Release Engineering semver + release-notes
// validation logic (Req 11.2 / 11.3). Kept in its own file so the universal
// "validation is correct" property is exercised across many generated versions
// and changelogs without clobbering the bounded-score property (Property 28) or
// the health-delta property (Property 30).
//
// Requirement 11.2: a prepared release validates that the changelog version
// conforms to semver MAJOR.MINOR.PATCH AND that the release notes contain a
// non-empty entry for the release version.
// Requirement 11.3: when the version does not conform to semver, or the release
// notes fail validation, the report records which control failed so CI can fail
// the release indicating the cause (and not publish).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  isValidSemver,
  validateReleaseNotes,
  buildReleaseReport,
} from '../release/scorecard.js';

const NUM_RUNS = 200; // ≥ 100 runs as required.

// ── Generators ────────────────────────────────────────────────────────────────

// A numeric semver identifier with no leading zeros: 0, or a non-zero leading
// digit followed by any digits. This is exactly what MAJOR.MINOR.PATCH permits.
const semverIdentifierArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant('0'),
  fc
    .tuple(
      fc.integer({ min: 1, max: 9 }).map(String),
      fc.string({ unit: fc.constantFrom(...'0123456789'.split('')), maxLength: 4 }),
    )
    .map(([head, rest]) => head + rest),
);

// A well-formed semver MAJOR.MINOR.PATCH version string.
const validSemverArb: fc.Arbitrary<string> = fc
  .tuple(semverIdentifierArb, semverIdentifierArb, semverIdentifierArb)
  .map(([maj, min, patch]) => `${maj}.${min}.${patch}`);

// Strings that are NOT valid MAJOR.MINOR.PATCH cores: leading zeros, extra or
// missing segments, prerelease/build metadata, non-numeric parts, empty string.
const invalidSemverArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.constant('1'),
  fc.constant('1.2'),
  fc.constant('1.2.3.4'),
  fc.constant('01.2.3'),
  fc.constant('1.02.3'),
  fc.constant('1.2.03'),
  fc.constant('1.2.3-alpha'),
  fc.constant('1.2.3+build'),
  fc.constant('v1.2.3'),
  fc.constant('1.2.x'),
  fc.constant('a.b.c'),
  fc.constant(' 1.2.3'),
  fc.constant('1.2.3 '),
  // Arbitrary free text, which is almost never a valid core version.
  fc.string({ maxLength: 12 }),
);

// ── Property 29: semver validation is exactly the strict MAJOR.MINOR.PATCH core
// Feature: platform-leadership-gaps, Property 29: Semver and release-notes validation are correct
// Validates: Requirements 11.2, 11.3
describe('Property 29: semver and release-notes validation are correct', () => {
  it('isValidSemver accepts every well-formed MAJOR.MINOR.PATCH version', () => {
    fc.assert(
      fc.property(validSemverArb, (version) => {
        assert.equal(isValidSemver(version), true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('isValidSemver rejects versions that are not a strict MAJOR.MINOR.PATCH core', () => {
    fc.assert(
      fc.property(invalidSemverArb, (version) => {
        // The invalid generator may, via the free-text branch, occasionally
        // emit a coincidentally-valid core; only assert rejection for the
        // genuinely malformed inputs.
        fc.pre(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version));
        assert.equal(isValidSemver(version), false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // ── Release-notes validation: a non-empty entry must exist for the version ──

  it('validateReleaseNotes accepts a changelog with a non-empty entry for the version', () => {
    fc.assert(
      fc.property(
        validSemverArb,
        fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0 && !/^\s{0,3}#/.test(s)),
        (version, body) => {
          const changelog = `# Changelog\n\n## ${version}\n\n${body}\n`;
          assert.equal(validateReleaseNotes(changelog, version), true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // Regression: the real-world Keep a Changelog convention nests a deeper
  // sub-heading ("### Added" / "### Fixed" / etc.) directly under the version
  // heading, with the actual bullet content living under THAT sub-heading —
  // not immediately under the version heading itself. An earlier
  // implementation treated any heading (regardless of depth) as ending the
  // entry, so it never saw the bullets and always reported `false` for every
  // real changelog entry ever written this way.
  it('validateReleaseNotes accepts a version entry with a deeper Keep-a-Changelog sub-heading before its body', () => {
    fc.assert(
      fc.property(
        validSemverArb,
        fc.constantFrom('Added', 'Changed', 'Fixed', 'Removed', 'Security', 'Deprecated'),
        fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0 && !/^\s{0,3}#/.test(s)),
        (version, section, body) => {
          const changelog = `# Changelog\n\n## [${version}]\n\n### ${section}\n- ${body}\n`;
          assert.equal(validateReleaseNotes(changelog, version), true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // The sub-heading itself must NOT count as "next entry" only when it is
  // strictly deeper than the version heading; a heading at the SAME depth as
  // the version heading (e.g. another `##`) must still correctly end the
  // entry, even when no deeper sub-heading is present.
  it('validateReleaseNotes still rejects an empty entry when the next heading is at the same depth', () => {
    fc.assert(
      fc.property(validSemverArb, (version) => {
        const other = version === '9.9.9' ? '8.8.8' : '9.9.9';
        const changelog = `# Changelog\n\n## [${version}]\n\n## [${other}]\n\n### Added\n- something\n`;
        assert.equal(validateReleaseNotes(changelog, version), false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('validateReleaseNotes rejects when the version heading has no body before the next heading', () => {
    fc.assert(
      fc.property(validSemverArb, (version) => {
        // Heading present but immediately followed by another heading: empty entry.
        const changelog = `# Changelog\n\n## ${version}\n\n## ${version === '0.0.0' ? '1.0.0' : '0.0.0'}\n\nlater\n`;
        assert.equal(validateReleaseNotes(changelog, version), false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('validateReleaseNotes rejects when no heading mentions the release version', () => {
    fc.assert(
      fc.property(
        validSemverArb,
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
        (version, body) => {
          // A changelog that documents a different version only.
          const other = version === '9.9.9' ? '8.8.8' : '9.9.9';
          const changelog = `# Changelog\n\n## ${other}\n\n${body}\n`;
          assert.equal(validateReleaseNotes(changelog, version), false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('validateReleaseNotes rejects an empty changelog and any invalid version', () => {
    fc.assert(
      fc.property(invalidSemverArb, fc.string({ maxLength: 60 }), (version, changelog) => {
        fc.pre(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version));
        // An invalid version can never have valid release notes (Req 11.2).
        assert.equal(validateReleaseNotes(changelog, version), false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('the version match is delimited so a prefix version does not satisfy a longer one', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 8 }),
        (maj, min, patch) => {
          const version = `${maj}.${min}.${patch}`;
          const longer = `${maj}.${min}.${patch}0`; // e.g. 1.2.3 vs 1.2.30
          // Notes only mention the longer version; the shorter must not match.
          const changelog = `# Changelog\n\n## ${longer}\n\nsome notes\n`;
          assert.equal(validateReleaseNotes(changelog, version), false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ── Req 11.3: buildReleaseReport records exactly which control failed ──

  it('buildReleaseReport reports the failed control consistently with the validators', () => {
    fc.assert(
      fc.property(
        fc.oneof(validSemverArb, invalidSemverArb),
        fc.string({ maxLength: 80 }),
        (version, changelog) => {
          const report = buildReleaseReport({
            version,
            scorecard: { security: 0, reliability: 0, coverage: 0, performance: 0 },
            changelog,
            health: {
              current: { dependencyFreshness: 0, testTrends: 0, vulnerabilityTrends: 0 },
              previous: { dependencyFreshness: 0, testTrends: 0, vulnerabilityTrends: 0 },
            },
            timestamp: '2024-01-01T00:00:00.000Z',
          });

          const semverOk = isValidSemver(version);
          const releaseNotesOk = validateReleaseNotes(changelog, version);

          // The report mirrors the validators exactly.
          assert.equal(report.validation.semverOk, semverOk);
          assert.equal(report.validation.releaseNotesOk, releaseNotesOk);

          // failedControl points at the first failing control: semver first,
          // then release-notes; absent only when both pass (Req 11.3).
          if (!semverOk) {
            assert.equal(report.validation.failedControl, 'semver');
          } else if (!releaseNotesOk) {
            assert.equal(report.validation.failedControl, 'release-notes');
          } else {
            assert.equal(report.validation.failedControl, undefined);
          }

          // A failedControl is present iff at least one control failed — the
          // signal CI uses to fail the release and not publish (Req 11.3).
          assert.equal(
            report.validation.failedControl !== undefined,
            !(semverOk && releaseNotesOk),
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
