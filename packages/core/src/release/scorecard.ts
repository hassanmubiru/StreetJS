// Release Engineering — scorecard, validation, and health-delta logic (zero runtime deps).
//
// This module holds the pure decision logic for the Release Engineering
// subsystem (Requirement 11). It lives in `@streetjs/core` so the same helpers
// can be reused by the CLI/scripts renderer and exercised by property tests
// without third-party dependencies — it uses only language built-ins.
//
//   - `isValidSemver()`        validate MAJOR.MINOR.PATCH (Req 11.2)
//   - `validateReleaseNotes()` confirm a non-empty changelog entry (Req 11.2)
//   - `ReleaseScorecard`       bounded 0–100 scores (Req 11.1)
//   - `HealthMetrics`          counts + deltas (current − previous) (Req 11.4)
//   - `buildReleaseReport()`   assemble the report, recording the failed
//                              control when a validation fails (Req 11.3/11.5)
//
// _Requirements: 11.1, 11.2, 11.4, 11.5_

/**
 * The four release quality dimensions, each scored on a 0–100 numeric scale
 * (Requirement 11.1). Values produced by {@link buildReleaseReport} are always
 * bounded to `[0, 100]` by {@link boundScorecard}.
 */
export interface ReleaseScorecard {
  security: number;
  reliability: number;
  coverage: number;
  performance: number;
}

/** A single health metric: an absolute count and its delta vs. the previous release. */
export interface HealthMetric {
  /** The metric's count for this release. */
  count: number;
  /** `current − previous` (Requirement 11.4). */
  deltaVsPrevious: number;
}

/**
 * Release health metrics covering dependency freshness, test trends, and
 * vulnerability trends, each as a count and as a delta relative to the previous
 * release (Requirement 11.4).
 */
export interface HealthMetrics {
  dependencyFreshness: HealthMetric;
  testTrends: HealthMetric;
  vulnerabilityTrends: HealthMetric;
}

/** Raw per-release health counts used to compute {@link HealthMetrics} deltas. */
export interface HealthCounts {
  dependencyFreshness: number;
  testTrends: number;
  vulnerabilityTrends: number;
}

/** Validation outcomes for the release controls (Requirements 11.2 / 11.3). */
export interface ReleaseValidation {
  /** True iff the version conforms to semver MAJOR.MINOR.PATCH. */
  semverOk: boolean;
  /** True iff the changelog has a non-empty entry for the version. */
  releaseNotesOk: boolean;
  /**
   * Identifies the first failed control (`'semver'` or `'release-notes'`) so CI
   * can indicate which validation failed (Requirement 11.3). Absent when both
   * controls pass.
   */
  failedControl?: 'semver' | 'release-notes';
}

/** The complete, machine-readable release report (Requirement 11.5). */
export interface ReleaseReport {
  version: string;
  scorecard: ReleaseScorecard;
  validation: ReleaseValidation;
  health: HealthMetrics;
  /** ISO-8601 timestamp of when the report was built. */
  timestamp: string;
}

/** Input to {@link buildReleaseReport}. */
export interface ReleaseReportInput {
  /** The release version under evaluation (validated against semver). */
  version: string;
  /** Raw scorecard scores; bounded to `[0, 100]` in the produced report. */
  scorecard: ReleaseScorecard;
  /** The changelog text searched for a non-empty entry for `version`. */
  changelog: string;
  /** Current and previous health counts used to compute deltas. */
  health: {
    current: HealthCounts;
    previous: HealthCounts;
  };
  /**
   * Optional ISO-8601 timestamp override (used by tests for determinism). When
   * omitted, the current time is used.
   */
  timestamp?: string;
}

/** The lowest permitted score on the scorecard scale. */
export const MIN_SCORE = 0;
/** The highest permitted score on the scorecard scale. */
export const MAX_SCORE = 100;

/**
 * Strict semver MAJOR.MINOR.PATCH core: three numeric identifiers with no
 * leading zeros and no prerelease/build metadata (Requirement 11.2).
 */
const SEMVER_CORE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * Returns true iff `version` is a valid semver MAJOR.MINOR.PATCH string —
 * exactly three dot-separated numeric identifiers, each without leading zeros
 * (Requirement 11.2). Pure and deterministic.
 */
export function isValidSemver(version: string): boolean {
  if (typeof version !== 'string') return false;
  return SEMVER_CORE_PATTERN.test(version);
}

/** Escape a string for safe use inside a `RegExp`. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns true iff `changelog` contains a non-empty notes entry for `version`
 * (Requirement 11.2). An entry is a markdown heading line (`#`/`##`/…) that
 * mentions the version, followed by at least one line of non-blank content
 * before the next heading **at the same or a shallower level** (e.g. `##`
 * ends a `##` entry, but a deeper `###` sub-heading — such as the "Added" /
 * "Fixed" Keep a Changelog convention — is content WITHIN the entry, not the
 * start of the next one) or end of file.
 *
 * The version match is delimited so `1.2.3` does not match `1.2.30`. Pure and
 * deterministic.
 */
export function validateReleaseNotes(changelog: string, version: string): boolean {
  if (typeof changelog !== 'string' || changelog.length === 0) return false;
  if (!isValidSemver(version)) return false;

  const lines = changelog.split(/\r?\n/);
  // Heading lines that reference the version, delimited so 1.2.3 ≠ 1.2.30.
  const versionRef = new RegExp(`(?<![\\d.])${escapeRegExp(version)}(?![\\d.])`);
  const headingPattern = /^\s{0,3}(#{1,6})\s/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = headingPattern.exec(line);
    if (!headingMatch || !versionRef.test(line)) continue;
    const headingLevel = headingMatch[1]!.length;

    // Found the version's heading; scan its body until a heading at the same
    // or a shallower level begins the next entry. A deeper heading (greater
    // `#` count, e.g. this entry's own "### Added" sub-section) is part of
    // this entry's body, not the next one.
    for (let j = i + 1; j < lines.length; j++) {
      const body = lines[j];
      const bodyHeadingMatch = headingPattern.exec(body);
      if (bodyHeadingMatch && bodyHeadingMatch[1]!.length <= headingLevel) break; // next entry begins
      if (body.trim().length > 0) return true; // non-empty content found
    }
  }

  return false;
}

/**
 * Clamp a single score to `[MIN_SCORE, MAX_SCORE]`. Non-finite values (NaN,
 * ±Infinity) collapse to `MIN_SCORE` so the result is always a valid bounded
 * number.
 */
export function clampScore(value: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return MIN_SCORE;
  if (value < MIN_SCORE) return MIN_SCORE;
  if (value > MAX_SCORE) return MAX_SCORE;
  return value;
}

/**
 * Return a copy of `scorecard` with every dimension clamped to `[0, 100]`
 * (Requirement 11.1). Guarantees the produced scores are bounded regardless of
 * the raw inputs. Pure and deterministic.
 */
export function boundScorecard(scorecard: ReleaseScorecard): ReleaseScorecard {
  return {
    security: clampScore(scorecard.security),
    reliability: clampScore(scorecard.reliability),
    coverage: clampScore(scorecard.coverage),
    performance: clampScore(scorecard.performance),
  };
}

/** Compute a {@link HealthMetric} from current and previous counts (`current − previous`). */
function healthDelta(current: number, previous: number): HealthMetric {
  return { count: current, deltaVsPrevious: current - previous };
}

/**
 * Compute the {@link HealthMetrics} block from current and previous counts. Each
 * delta is exactly `current − previous` (Requirement 11.4). Pure and deterministic.
 */
export function computeHealthMetrics(
  current: HealthCounts,
  previous: HealthCounts,
): HealthMetrics {
  return {
    dependencyFreshness: healthDelta(current.dependencyFreshness, previous.dependencyFreshness),
    testTrends: healthDelta(current.testTrends, previous.testTrends),
    vulnerabilityTrends: healthDelta(current.vulnerabilityTrends, previous.vulnerabilityTrends),
  };
}

/**
 * Build the release report (Requirement 11.5): a bounded scorecard, the semver
 * and release-notes validation outcomes, and the health deltas. When a control
 * fails, the report records the failed control (`'semver'` first, then
 * `'release-notes'`) so CI can fail the release indicating which validation
 * failed (Requirement 11.3). Pure and deterministic given an explicit timestamp.
 */
export function buildReleaseReport(input: ReleaseReportInput): ReleaseReport {
  const semverOk = isValidSemver(input.version);
  const releaseNotesOk = validateReleaseNotes(input.changelog, input.version);

  const validation: ReleaseValidation = { semverOk, releaseNotesOk };
  if (!semverOk) {
    validation.failedControl = 'semver';
  } else if (!releaseNotesOk) {
    validation.failedControl = 'release-notes';
  }

  return {
    version: input.version,
    scorecard: boundScorecard(input.scorecard),
    validation,
    health: computeHealthMetrics(input.health.current, input.health.previous),
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}
