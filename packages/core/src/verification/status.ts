// Verification Artifact subsystem — shared status types (zero runtime deps).
//
// These are the shared type definitions used across the verification
// subsystem. The `classify()` status engine that consumes `ClassifyInput`
// lives alongside these types (task 1.1). This module uses only Node core
// concepts and declares no runtime dependencies.

/**
 * The four — and only four — Verification Statuses a capability may hold
 * (Requirement 1.1).
 */
export type VerificationStatus =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'NOT_IMPLEMENTED';

/**
 * The four evidence components a VERIFIED capability must have, recorded as
 * present/absent for each (Requirements 1.3 / 1.4).
 */
export interface EvidenceComponents {
  /** Capability has source code. */
  sourceCode: boolean;
  /** Automated tests executed and exited with code 0. */
  passingTests: boolean;
  /** Published documentation exists. */
  documentation: boolean;
  /** A Verification Artifact was produced by an executed command. */
  artifact: boolean;
}

/**
 * Records the specific external prerequisite that prevented verification
 * (Requirements 1.5 / 1.10).
 */
export interface BlockedReason {
  /** Identifier of the specific missing external prerequisite. */
  missingPrerequisite: string;
  /** The category of the missing prerequisite. */
  kind: 'service' | 'credential' | 'runtime' | 'timeout';
}

/**
 * Input to the status engine's `classify()` function.
 */
export interface ClassifyInput {
  hasSourceCode: boolean;
  evidence: EvidenceComponents;
  /** Set when an external prerequisite is unavailable. */
  blocked?: BlockedReason | null;
  /** The exit code of the executed verification command (Requirement 1.9). */
  commandExitCode: number;
  /** True if the command was killed for exceeding the timeout (Requirement 1.10). */
  timedOut: boolean;
}
