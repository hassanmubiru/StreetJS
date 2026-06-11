// Verification Artifact subsystem — Consumer-Platform Certification scorecard
// (zero runtime deps).
//
// This module is the single place that computes the Consumer-Platform
// Certification Report. Like the Platform-Leadership aggregator it sits next
// to (`computeLeadership` in `aggregator.ts`), the scorecard is derived SOLELY
// from recorded Verification Artifacts (Requirement 12.4) — it is never
// authored, set, or edited by hand. A contributing capability with no recorded
// artifact is treated as not VERIFIED (Requirement 12.3); a report category is
// fully certified iff every capability contributing to it is VERIFIED
// (Requirement 12.2), otherwise the category is reported not-fully-certified
// together with the unverified contributing capabilities (Requirement 12.3).
// The emitted report records each of the eight categories with its
// contributing/unverified capabilities (Requirement 12.1), an ISO-8601
// timestamp, and the artifact paths it was computed from as the evidence
// reference set (Requirement 12.4). Uses only language built-ins — no runtime
// dependencies.
//
// _Requirements: 1.5, 12.1, 12.2, 12.3, 12.4_

import type { VerificationStatus } from './status.js';
import type { VerificationArtifact } from './artifact.js';
import type { CapabilityStatus, ArtifactSource } from './aggregator.js';

/**
 * The frozen set of dotted capability ids that the Zero-Trust Certification
 * Standard applies to uniformly across every phase (Requirement 1.5) — one id
 * per consumer-platform feature/phase. These are the only join keys between the
 * capability verifiers, their artifacts, and this scorecard.
 */
export const CONSUMER_PLATFORM_CAPABILITIES: readonly string[] = Object.freeze([
  'validation.runtime',
  'ratelimit.sliding-window',
  'headers.defaults',
  'upload.guard',
  'encryption.field',
  'abuse.engine',
  'moderation.toolkit',
  'secrets.provider',
  'privacy.controls',
  'dating.auth',
  'dating.profiles',
  'dating.messaging',
  'dating.moderation',
]);

/**
 * The eight report categories the Certification Report scores
 * (Requirement 12.1).
 */
export type ReportCategory =
  | 'Security'
  | 'Privacy'
  | 'Abuse Prevention'
  | 'Authentication'
  | 'Moderation'
  | 'Developer Experience'
  | 'Enterprise Readiness'
  | 'Production Readiness';

/** The eight categories in their reporting order (Requirement 12.1). */
export const REPORT_CATEGORIES: readonly ReportCategory[] = Object.freeze([
  'Security',
  'Privacy',
  'Abuse Prevention',
  'Authentication',
  'Moderation',
  'Developer Experience',
  'Enterprise Readiness',
  'Production Readiness',
]);

/**
 * Maps each consumer-platform capability to the one or more report categories
 * it contributes to (Requirement 12.2). A capability may contribute to several
 * categories (e.g. field encryption is both a Security and a Privacy/Enterprise
 * concern). This mapping is the fixed definition of which features contribute
 * to which category; it is the only place that relationship is encoded.
 */
const CAPABILITY_CATEGORIES: Readonly<Record<string, readonly ReportCategory[]>> =
  Object.freeze({
    'validation.runtime': ['Security', 'Production Readiness'],
    'ratelimit.sliding-window': ['Security', 'Abuse Prevention', 'Production Readiness'],
    'headers.defaults': ['Security', 'Production Readiness'],
    'upload.guard': ['Security', 'Production Readiness'],
    'encryption.field': ['Security', 'Privacy', 'Enterprise Readiness'],
    'abuse.engine': ['Abuse Prevention', 'Authentication'],
    'moderation.toolkit': ['Moderation'],
    'secrets.provider': ['Security', 'Enterprise Readiness', 'Production Readiness'],
    'privacy.controls': ['Privacy', 'Enterprise Readiness'],
    'dating.auth': ['Authentication', 'Developer Experience'],
    'dating.profiles': ['Developer Experience'],
    'dating.messaging': ['Developer Experience'],
    'dating.moderation': ['Moderation', 'Developer Experience'],
  });

/** The status of a single report category, derived solely from artifacts. */
export interface CategoryStatus {
  /** The report category being scored. */
  category: ReportCategory;
  /** True iff every contributing capability is VERIFIED (Requirement 12.2). */
  fullyCertified: boolean;
  /** Every capability contributing to this category, with its status. */
  contributing: CapabilityStatus[];
  /** The contributing capabilities that are non-VERIFIED or missing an artifact (Requirement 12.3). */
  unverified: CapabilityStatus[];
}

/** The machine-readable Consumer-Platform Certification Report (Requirement 12.1). */
export interface CertificationReport {
  /** A status entry for each of the eight categories (Requirement 12.1). */
  categories: CategoryStatus[];
  /** ISO-8601 timestamp of when the report was computed (Requirement 12.4). */
  timestamp: string;
  /** The artifact file paths the report was computed from — the evidence reference set (Requirement 12.4). */
  computedFrom: string[];
}

/**
 * The status assigned to a contributing capability that has no recorded
 * artifact. A missing artifact is treated as not VERIFIED (Requirement 12.3);
 * with no recorded evidence at all, NOT_IMPLEMENTED is the faithful
 * representation, matching the aggregator.
 */
const MISSING_ARTIFACT_STATUS: VerificationStatus = 'NOT_IMPLEMENTED';

function isArtifactSource(
  entry: VerificationArtifact | ArtifactSource,
): entry is ArtifactSource {
  // A VerificationArtifact carries `capabilityId`/`schemaVersion` at the top
  // level and never a top-level `artifact` property; an ArtifactSource wraps
  // the artifact under `artifact`. Mirrors aggregator.ts.
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'artifact' in entry &&
    !('capabilityId' in entry)
  );
}

/**
 * Resolve a single capability's status solely from recorded artifacts: when an
 * artifact exists its recorded status is used; when none exists the capability
 * is treated as not VERIFIED with `hasArtifact: false` (Requirement 12.3).
 */
function resolveCapability(
  capabilityId: string,
  byCapability: ReadonlyMap<string, VerificationArtifact>,
): CapabilityStatus {
  const artifact = byCapability.get(capabilityId);
  if (artifact !== undefined) {
    return { capabilityId, status: artifact.status, hasArtifact: true };
  }
  return { capabilityId, status: MISSING_ARTIFACT_STATUS, hasArtifact: false };
}

/**
 * Compute the Consumer-Platform Certification Report SOLELY from recorded
 * Verification Artifacts (Requirement 12.4).
 *
 * Each capability in {@link CONSUMER_PLATFORM_CAPABILITIES} is resolved to its
 * recorded status (missing artifact ⇒ NOT_IMPLEMENTED, `hasArtifact: false`,
 * Requirement 12.3) and contributes to the categories named in the fixed
 * capability→category mapping (Requirement 12.2). For each of the eight
 * categories the report lists every contributing capability with its status and
 * is `fullyCertified` iff every contributing capability is VERIFIED; otherwise
 * the offending capabilities are listed in `unverified` (Requirement 12.3). The
 * report records the eight categories (Requirement 12.1), an ISO-8601
 * timestamp, and the artifact paths read as the evidence reference set
 * (Requirement 12.4).
 *
 * Pure and deterministic apart from the timestamp: the same artifacts always
 * yield the same categories, contributing lists, and unverified lists. Never
 * throws.
 *
 * @param artifacts Recorded artifacts, optionally paired with their source path.
 * @param now Injectable clock for the report timestamp (defaults to `new Date()`).
 */
export function computeCertification(
  artifacts: ReadonlyArray<VerificationArtifact | ArtifactSource>,
  now: Date = new Date(),
): CertificationReport {
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

  // Resolve every known capability's status once, so each category reuses the
  // same resolved entry.
  const resolved = new Map<string, CapabilityStatus>();
  for (const capabilityId of CONSUMER_PLATFORM_CAPABILITIES) {
    resolved.set(capabilityId, resolveCapability(capabilityId, byCapability));
  }

  const categories: CategoryStatus[] = REPORT_CATEGORIES.map((category) => {
    const contributing: CapabilityStatus[] = [];
    for (const capabilityId of CONSUMER_PLATFORM_CAPABILITIES) {
      if (CAPABILITY_CATEGORIES[capabilityId]?.includes(category)) {
        // Resolved above for every known capability.
        contributing.push(resolved.get(capabilityId)!);
      }
    }

    // A contributing capability is unverified when it is missing an artifact or
    // its resolved status is anything other than VERIFIED (Requirement 12.3).
    const unverified = contributing.filter(
      (c) => !c.hasArtifact || c.status !== 'VERIFIED',
    );

    return {
      category,
      fullyCertified: unverified.length === 0,
      contributing,
      unverified,
    };
  });

  return {
    categories,
    timestamp: now.toISOString(),
    computedFrom,
  };
}
