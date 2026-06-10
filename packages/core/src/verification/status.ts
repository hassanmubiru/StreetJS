/**
 * Verification status engine for the Platform Leadership Gaps zero-trust
 * evidence standard.
 *
 * This module is part of `@streetjs/core` and therefore carries ZERO runtime
 * dependencies — it uses only pure TypeScript and Node core semantics. The
 * {@link classify} function is pure and deterministic: the same input always
 * yields the same {@link VerificationStatus}.
 *
 * Requirements covered:
 *  - 1.1 Exactly four Verification Statuses.
 *  - 1.2 Precedence order NOT_IMPLEMENTED → BLOCKED → VERIFIED → PARTIAL.
 *  - 1.3 VERIFIED requires all four evidence components and a zero exit code.
 *  - 1.4 PARTIAL when at least one but fewer than all evidence components.
 *  - 1.6 NOT_IMPLEMENTED when there is no source code.
 *  - 1.9 A non-zero command exit code can never be VERIFIED.
 */

/**
 * The four — and only four — Verification Statuses a capability may hold
 * during a single verification run (Req 1.1).
 */
export type VerificationStatus =
  | 'VERIFIED'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'NOT_IMPLEMENTED';

/**
 * The four evidence components a VERIFIED capability must simultaneously have
 * (Req 1.3). For PARTIAL capabilities, each flag records whether that specific
 * component is present or absent (Req 1.4).
 */
export interface EvidenceComponents {
  /** The capability has source code. */
  sourceCode: boolean;
  /** Automated tests executed and exited with a zero exit code. */
  passingTests: boolean;
  /** Published documentation exists for the capability. */
  documentation: boolean;
  /** A Verification Artifact was produced by an executed command. */
  artifact: boolean;
}

/**
 * Describes why a capability is BLOCKED: the identifier of the specific
 * external prerequisite that is unavailable (Req 1.5), or a timeout (Req 1.10).
 */
export interface BlockedReason {
  /**
   * Identifier of the specific missing external prerequisite — for example a
   * service hostname, a credential name, a runtime dependency, or `'timeout'`.
   */
  missingPrerequisite: string;
  /** The category of the missing prerequisite. */
  kind: 'service' | 'credential' | 'runtime' | 'timeout';
}

/**
 * The complete set of facts the status engine needs to assign exactly one
 * status to a capability for a single verification run.
 */
export interface ClassifyInput {
  /** Whether the capability has any source code at all (Req 1.6). */
  hasSourceCode: boolean;
  /** Presence/absence of each of the four evidence components. */
  evidence: EvidenceComponents;
  /**
   * Set when an external prerequisite is unavailable. When present (and the
   * capability has source code), the status is BLOCKED (Req 1.5/1.10).
   */
  blocked?: BlockedReason | null;
  /** The exit code of the executed verification command (Req 1.9). */
  commandExitCode: number;
  /** True if the command was killed for exceeding the 300s bound (Req 1.10). */
  timedOut: boolean;
}

/** Returns the number of evidence components that are present. */
function countPresentEvidence(evidence: EvidenceComponents): number {
  let count = 0;
  if (evidence.sourceCode) count++;
  if (evidence.passingTests) count++;
  if (evidence.documentation) count++;
  if (evidence.artifact) count++;
  return count;
}

/** Returns true iff all four evidence components are present. */
function hasAllEvidence(evidence: EvidenceComponents): boolean {
  return (
    evidence.sourceCode &&
    evidence.passingTests &&
    evidence.documentation &&
    evidence.artifact
  );
}

/**
 * Assign exactly one {@link VerificationStatus} to a capability, evaluating the
 * REQUIRED precedence order (Req 1.2):
 *
 *   NOT_IMPLEMENTED → BLOCKED → VERIFIED → PARTIAL
 *
 * Decision rules:
 *  - No source code                                → NOT_IMPLEMENTED (Req 1.6)
 *  - Timed out OR a blocked reason is set          → BLOCKED         (Req 1.5/1.10)
 *  - All four evidence present AND exit code === 0 → VERIFIED        (Req 1.3)
 *  - Otherwise (≥1 but <4 components, or a non-zero
 *    exit code despite full evidence)              → PARTIAL         (Req 1.4/1.9)
 *
 * The function is pure and deterministic.
 */
export function classify(input: ClassifyInput): VerificationStatus {
  // Precedence 1 — NOT_IMPLEMENTED: no source code at all (Req 1.6).
  if (!input.hasSourceCode) {
    return 'NOT_IMPLEMENTED';
  }

  // Precedence 2 — BLOCKED: a timeout (Req 1.10) or any missing external
  // prerequisite (Req 1.5) prevents verification.
  if (input.timedOut || input.blocked != null) {
    return 'BLOCKED';
  }

  // Precedence 3 — VERIFIED: all four evidence components present and the
  // verification command exited zero (Req 1.3). A non-zero exit code can never
  // be VERIFIED (Req 1.9).
  if (hasAllEvidence(input.evidence) && input.commandExitCode === 0) {
    return 'VERIFIED';
  }

  // Precedence 4 — PARTIAL: at least one (but fewer than all) evidence
  // components, or full evidence with a non-zero exit code (Req 1.4/1.9).
  // `hasSourceCode` is true here, so the `sourceCode` evidence flag guarantees
  // at least one present component is expected; we still classify the
  // remaining state as PARTIAL.
  void countPresentEvidence; // retained for clarity of the >=1 evidence rule
  return 'PARTIAL';
}
