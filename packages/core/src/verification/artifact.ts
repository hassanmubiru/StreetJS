// Verification Artifact subsystem — artifact schema + validator (zero runtime deps).
//
// A Verification Artifact is the single machine-readable evidence record that
// every capability verifier emits. It MUST be produced by an executed command
// and never hand-authored (Requirement 1.8); the presence and shape of the
// `generator` field is what marks an artifact as command-produced. This module
// defines the artifact shape and a hand-rolled JSON Schema validator that uses
// only language built-ins (no runtime dependencies).
//
// _Requirements: 1.7, 1.8_

import type {
  VerificationStatus,
  EvidenceComponents,
  BlockedReason,
} from './status.js';

/**
 * The single Verification Artifact record (Requirement 1.7). Conforms to the
 * JSON Schema enforced by {@link validateArtifact}.
 */
export interface VerificationArtifact {
  /** Schema version discriminator; always 1 for this schema. */
  schemaVersion: 1;
  /** Dotted capability identifier, e.g. `cloud.deploy.kubernetes`. */
  capabilityId: string;
  /** The single assigned Verification Status. */
  status: VerificationStatus;
  /** Present/absent flags for each of the four evidence components. */
  evidence: EvidenceComponents;
  /** The exact command that was executed to produce this artifact. */
  command: string;
  /** The exit code of the executed command (Requirements 1.7 / 1.9). */
  exitCode: number;
  /** ISO-8601 timestamp of the verification run (Requirement 1.7). */
  timestamp: string;
  /** Wall-clock duration of the command in milliseconds. */
  durationMs?: number;
  /** True when the command was terminated for exceeding its timeout. */
  timedOut?: boolean;
  /** Present iff `status === 'BLOCKED'` — records the missing prerequisite. */
  blockedReason?: BlockedReason;
  /** Area-specific, schema-validated payload (counts, params, reports). */
  details?: Record<string, unknown>;
  /**
   * Identifies the command/tool that produced the artifact. Its presence marks
   * the artifact as command-produced rather than hand-authored (Requirement 1.8).
   */
  generator: { tool: string; version: string };
}

/** Result of validating a candidate against the Verification Artifact schema. */
export interface ArtifactValidationResult {
  valid: boolean;
  errors: string[];
}

/** The four permitted Verification Statuses. */
const STATUSES: readonly VerificationStatus[] = [
  'VERIFIED',
  'PARTIAL',
  'BLOCKED',
  'NOT_IMPLEMENTED',
];

/** The permitted `BlockedReason.kind` values. */
const BLOCKED_KINDS: readonly BlockedReason['kind'][] = [
  'service',
  'credential',
  'runtime',
  'timeout',
];

/** Required top-level properties (JSON Schema `required`). */
const REQUIRED_TOP_LEVEL = [
  'schemaVersion',
  'capabilityId',
  'status',
  'evidence',
  'command',
  'exitCode',
  'timestamp',
  'generator',
] as const;

/** Every property the schema permits at the top level (`additionalProperties: false`). */
const ALLOWED_TOP_LEVEL = new Set<string>([
  ...REQUIRED_TOP_LEVEL,
  'durationMs',
  'timedOut',
  'blockedReason',
  'details',
]);

/** Dotted capability-id pattern: `area.capability[.target]`. */
const CAPABILITY_ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Returns true iff `value` is a non-empty string that is a valid ISO-8601
 * date-time (JSON Schema `format: date-time`). Uses only `Date` parsing plus a
 * shape check so the validator stays dependency-free.
 */
function isIso8601DateTime(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  // Require a date-time shape (date, 'T' separator, time) — not just a date.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
}

function validateEvidence(evidence: unknown, errors: string[]): void {
  if (!isPlainObject(evidence)) {
    errors.push('evidence: must be an object');
    return;
  }
  for (const key of ['sourceCode', 'passingTests', 'documentation', 'artifact']) {
    if (!(key in evidence)) {
      errors.push(`evidence.${key}: is required`);
    } else if (typeof evidence[key] !== 'boolean') {
      errors.push(`evidence.${key}: must be a boolean`);
    }
  }
}

function validateBlockedReason(blockedReason: unknown, errors: string[]): void {
  if (!isPlainObject(blockedReason)) {
    errors.push('blockedReason: must be an object');
    return;
  }
  const { missingPrerequisite, kind } = blockedReason;
  if (typeof missingPrerequisite !== 'string' || missingPrerequisite.length === 0) {
    errors.push('blockedReason.missingPrerequisite: must be a non-empty string');
  }
  if (typeof kind !== 'string' || !BLOCKED_KINDS.includes(kind as BlockedReason['kind'])) {
    errors.push(
      `blockedReason.kind: must be one of ${BLOCKED_KINDS.join(', ')}`,
    );
  }
}

function validateGenerator(generator: unknown, errors: string[]): void {
  if (!isPlainObject(generator)) {
    errors.push('generator: must be an object (artifacts must be command-produced)');
    return;
  }
  if (typeof generator.tool !== 'string') {
    errors.push('generator.tool: must be a string');
  }
  if (typeof generator.version !== 'string') {
    errors.push('generator.version: must be a string');
  }
}

/**
 * Validate a candidate value against the Verification Artifact JSON Schema.
 *
 * Enforces all required fields, value constraints, `additionalProperties:
 * false`, and the conditional rule that `status === 'BLOCKED'` requires a
 * `blockedReason`. The `generator` object is mandatory, which is what marks the
 * artifact as command-produced rather than hand-authored (Requirement 1.8).
 *
 * Pure and deterministic: never throws, always returns a result.
 */
export function validateArtifact(a: unknown): ArtifactValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(a)) {
    return { valid: false, errors: ['artifact: must be an object'] };
  }

  // additionalProperties: false
  for (const key of Object.keys(a)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) {
      errors.push(`${key}: is not a permitted property`);
    }
  }

  // required
  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in a)) {
      errors.push(`${key}: is required`);
    }
  }

  // schemaVersion: const 1
  if ('schemaVersion' in a && a.schemaVersion !== 1) {
    errors.push('schemaVersion: must be the constant 1');
  }

  // capabilityId: string matching the dotted pattern
  if ('capabilityId' in a) {
    if (typeof a.capabilityId !== 'string') {
      errors.push('capabilityId: must be a string');
    } else if (!CAPABILITY_ID_PATTERN.test(a.capabilityId)) {
      errors.push(
        'capabilityId: must match the dotted pattern area.capability[.target]',
      );
    }
  }

  // status: enum
  if ('status' in a && !STATUSES.includes(a.status as VerificationStatus)) {
    errors.push(`status: must be one of ${STATUSES.join(', ')}`);
  }

  // evidence
  if ('evidence' in a) {
    validateEvidence(a.evidence, errors);
  }

  // command: non-empty string
  if ('command' in a && (typeof a.command !== 'string' || a.command.length === 0)) {
    errors.push('command: must be a non-empty string');
  }

  // exitCode: integer
  if ('exitCode' in a && !isInteger(a.exitCode)) {
    errors.push('exitCode: must be an integer');
  }

  // timestamp: ISO-8601 date-time
  if ('timestamp' in a && !isIso8601DateTime(a.timestamp)) {
    errors.push('timestamp: must be an ISO-8601 date-time string');
  }

  // durationMs: integer >= 0 (optional)
  if ('durationMs' in a && a.durationMs !== undefined) {
    if (!isInteger(a.durationMs) || (a.durationMs as number) < 0) {
      errors.push('durationMs: must be an integer >= 0');
    }
  }

  // timedOut: boolean (optional)
  if ('timedOut' in a && a.timedOut !== undefined && typeof a.timedOut !== 'boolean') {
    errors.push('timedOut: must be a boolean');
  }

  // details: object (optional)
  if ('details' in a && a.details !== undefined && !isPlainObject(a.details)) {
    errors.push('details: must be an object');
  }

  // generator (required) — presence marks the artifact as command-produced
  if ('generator' in a) {
    validateGenerator(a.generator, errors);
  }

  // blockedReason (optional shape) — validate whenever present
  if ('blockedReason' in a && a.blockedReason !== undefined) {
    validateBlockedReason(a.blockedReason, errors);
  }

  // Conditional: status === 'BLOCKED' ⇒ blockedReason required
  if (a.status === 'BLOCKED' && (!('blockedReason' in a) || a.blockedReason === undefined)) {
    errors.push("blockedReason: is required when status is 'BLOCKED'");
  }

  return { valid: errors.length === 0, errors };
}
