// Verification Artifact subsystem — Platform Leadership exit-criteria aggregator
// (zero runtime deps).
//
// This module is the single place that computes the Platform Leadership
// classification. The decision is derived SOLELY from recorded Verification
// Artifacts (Requirement 12.4) — it is never authored, set, or edited by hand.
// A required capability with no recorded artifact is treated as not VERIFIED
// (Requirement 12.3), and the classification is GRANTED iff every required
// capability is VERIFIED (Requirement 12.1), otherwise WITHHELD together with
// each offending capability and its current status (Requirement 12.2). The
// emitted report records each required capability + status, the overall
// decision, an ISO-8601 timestamp, and the artifact paths it was computed from
// (Requirement 12.5). Uses only language built-ins — no runtime dependencies.
//
// _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

import type { VerificationStatus } from './status.js';
import type { VerificationArtifact } from './artifact.js';

/**
 * The fixed set of capabilities Requirement 12.1 requires to simultaneously
 * hold the VERIFIED status before the Platform Leadership classification is
 * granted. These eleven identifiers are the only inputs to the gate; they are
 * the join key between the capability verifiers, their artifacts, and this
 * aggregator. Some are roll-ups (e.g. `cloud.deploy` is VERIFIED iff every
 * deployment target verified; `plugins.ecosystem` iff every official plugin
 * verified; `kafka.chaos` iff cold-start and every chaos scenario verified).
 */
export const PLATFORM_LEADERSHIP_CAPABILITIES: readonly string[] = Object.freeze([
  'dast.scan',
  'cloud.deploy',
  'registry.publish-install',
  'plugins.ecosystem',
  'enterprise.api',
  'devx.playground',
  'devx.route-explorer',
  'devx.dependency-graph',
  'kafka.chaos',
  'observability.validate',
  'release.scorecard',
]);

/** The status of a single required capability, plus whether it has an artifact. */
export interface CapabilityStatus {
  capabilityId: string;
  status: VerificationStatus;
  /** True iff a Verification Artifact was recorded for this capability. */
  hasArtifact: boolean;
}

/** The machine-readable Platform Leadership report (Requirement 12.5). */
export interface LeadershipReport {
  /** GRANTED iff every required capability is VERIFIED, else WITHHELD. */
  decision: 'GRANTED' | 'WITHHELD';
  /** Each required capability with its current status (Req 12.2/12.5). */
  required: CapabilityStatus[];
  /** The required capabilities that are non-VERIFIED or missing an artifact (Req 12.2/12.3). */
  withheld: CapabilityStatus[];
  /** ISO-8601 timestamp of when the decision was computed (Req 12.5). */
  timestamp: string;
  /** The artifact file paths the decision was computed from (provenance). */
  computedFrom: string[];
}

/**
 * A Verification Artifact paired with the file path it was read from. Allows
 * the aggregator to record provenance (`computedFrom`) when the caller (e.g.
 * `street verify --aggregate`) loads artifacts from disk.
 */
export interface ArtifactSource {
  artifact: VerificationArtifact;
  /** The file path this artifact was read from. */
  path?: string;
}

/**
 * The status assigned to a required capability that has no recorded artifact.
 * A missing artifact is treated as not VERIFIED (Requirement 12.3); with no
 * recorded evidence at all, NOT_IMPLEMENTED is the faithful representation.
 */
const MISSING_ARTIFACT_STATUS: VerificationStatus = 'NOT_IMPLEMENTED';

function isArtifactSource(
  entry: VerificationArtifact | ArtifactSource,
): entry is ArtifactSource {
  // A VerificationArtifact carries `capabilityId`/`schemaVersion` at the top
  // level and never a top-level `artifact` property; an ArtifactSource wraps
  // the artifact under `artifact`.
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'artifact' in entry &&
    !('capabilityId' in entry)
  );
}

/**
 * Compute the Platform Leadership decision SOLELY from recorded Verification
 * Artifacts (Requirement 12.4).
 *
 * For each capability in {@link PLATFORM_LEADERSHIP_CAPABILITIES}:
 *  - if a matching artifact exists, its recorded status is used (the most
 *    recently supplied artifact wins when duplicates are present);
 *  - if no artifact exists, the capability is treated as not VERIFIED with a
 *    status of NOT_IMPLEMENTED and `hasArtifact: false` (Requirement 12.3).
 *
 * The decision is GRANTED iff every required capability is VERIFIED
 * (Requirement 12.1); otherwise it is WITHHELD and `withheld` contains exactly
 * the required capabilities that are non-VERIFIED or missing an artifact
 * (Requirement 12.2/12.3). The report records each required capability + its
 * status, the decision, an ISO-8601 timestamp, and the artifact paths read
 * (Requirement 12.5).
 *
 * Pure and deterministic apart from the timestamp: the same artifacts always
 * yield the same decision, required list, and withheld list.
 *
 * @param artifacts Recorded artifacts, optionally paired with their source path.
 * @param now Injectable clock for the report timestamp (defaults to `new Date()`).
 */
export function computeLeadership(
  artifacts: ReadonlyArray<VerificationArtifact | ArtifactSource>,
  now: Date = new Date(),
): LeadershipReport {
  // Index the supplied artifacts by capability id (last write wins) and collect
  // the provenance paths in the order they were read.
  const byCapability = new Map<string, VerificationArtifact>();
  const computedFrom: string[] = [];

  for (const entry of artifacts) {
    const artifact = isArtifactSource(entry) ? entry.artifact : entry;
    const path = isArtifactSource(entry) ? entry.path : undefined;
    if (artifact && typeof artifact.capabilityId === 'string') {
      byCapability.set(artifact.capabilityId, artifact);
    }
    if (typeof path === 'string' && path.length > 0) {
      computedFrom.push(path);
    }
  }

  const required: CapabilityStatus[] = [];
  const withheld: CapabilityStatus[] = [];

  for (const capabilityId of PLATFORM_LEADERSHIP_CAPABILITIES) {
    const artifact = byCapability.get(capabilityId);
    const hasArtifact = artifact !== undefined;
    const status: VerificationStatus = hasArtifact
      ? artifact.status
      : MISSING_ARTIFACT_STATUS;

    const entry: CapabilityStatus = { capabilityId, status, hasArtifact };
    required.push(entry);

    // A capability is withheld when it is missing an artifact or its recorded
    // status is anything other than VERIFIED (Req 12.2/12.3).
    if (!hasArtifact || status !== 'VERIFIED') {
      withheld.push(entry);
    }
  }

  return {
    decision: withheld.length === 0 ? 'GRANTED' : 'WITHHELD',
    required,
    withheld,
    timestamp: now.toISOString(),
    computedFrom,
  };
}
