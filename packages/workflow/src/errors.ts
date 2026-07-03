/**
 * @streetjs/workflow — typed error hierarchy
 *
 * Every error thrown by the workflow engine derives from {@link WorkflowError},
 * so consumers can catch the whole family with a single `instanceof WorkflowError`
 * check while still discriminating on concrete subclasses for specific handling.
 *
 * Each subclass carries descriptive, strongly typed fields appropriate to its
 * purpose (the offending workflow name, the run identifier, the failing
 * operation, the missing command sequence, etc.) and sets `this.name`. Because
 * TypeScript emits to ES2022 with `Error` subclassing, we call
 * `Object.setPrototypeOf` in every constructor to keep the prototype chain intact
 * for `instanceof` under ESM/TS.
 *
 * This module imports no other workflow module, no pillar package, and no Redis
 * client, so it is safe to load from the base entry point.
 *
 * _Requirements: 1.4, 1.5, 11.5, 13.4, 14.3, 15.4_
 */

/**
 * Base class for every error raised by `@streetjs/workflow`.
 *
 * Catch this to handle any workflow failure; narrow to a subclass for specific
 * cases. Carries an optional `cause` (the underlying error, when this error
 * wraps another) following the standard `Error` `cause` convention.
 */
export class WorkflowError extends Error {
  /** The underlying error this error wraps, when applicable. */
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "WorkflowError";
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, WorkflowError.prototype);
  }
}

/**
 * Raised when `define` is called with a name that is already registered. The
 * engine retains the previously registered Workflow_Definition and surfaces this
 * descriptive registration error (Requirement 1.4).
 *
 * Carries the offending `workflowName` so callers know exactly which definition
 * collided.
 */
export class RegistrationError extends WorkflowError {
  /** The workflow definition name that was already registered. */
  readonly workflowName: string;

  constructor(
    workflowName: string,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(
      message ??
        `A workflow named "${workflowName}" is already registered; the previously registered definition is retained.`,
      options,
    );
    this.name = "RegistrationError";
    this.workflowName = workflowName;
    Object.setPrototypeOf(this, RegistrationError.prototype);
  }
}

/**
 * Raised when `run` (or another operation) is requested for a name that is not a
 * registered Workflow_Definition. No Workflow_Run is created (Requirement 1.5).
 *
 * Carries the requested `workflowName` that could not be resolved.
 */
export class WorkflowNotFoundError extends WorkflowError {
  /** The workflow definition name that was not registered. */
  readonly workflowName: string;

  constructor(
    workflowName: string,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(
      message ??
        `No workflow named "${workflowName}" is registered; no run was created.`,
      options,
    );
    this.name = "WorkflowNotFoundError";
    this.workflowName = workflowName;
    Object.setPrototypeOf(this, WorkflowNotFoundError.prototype);
  }
}

/**
 * Raised when `resume` is requested for a Workflow_Run whose Run_Status is
 * `cancelled`. No Activity is invoked (Requirement 14.3).
 *
 * Carries the `runId` of the cancelled run that could not be resumed.
 */
export class CancelledResumeError extends WorkflowError {
  /** The identifier of the cancelled run that could not be resumed. */
  readonly runId: string;

  constructor(runId: string, message?: string, options?: { cause?: unknown }) {
    super(
      message ??
        `Workflow run "${runId}" was cancelled and cannot be resumed; no activity will be invoked.`,
      options,
    );
    this.name = "CancelledResumeError";
    this.runId = runId;
    Object.setPrototypeOf(this, CancelledResumeError.prototype);
  }
}

/**
 * Raised when a `ctx` bridge operation (for example a `ctx.storage` call) is used
 * but no corresponding structural bridge was supplied in configuration
 * (Requirement 15.4).
 *
 * Carries the `bridge` name (e.g. "storage", "queue", "events", "realtime") and
 * the attempted `operation` so the misconfiguration can be surfaced precisely.
 */
export class WorkflowConfigError extends WorkflowError {
  /** The bridge that was used without being wired, when known. */
  readonly bridge?: string;
  /** The attempted operation on the missing bridge, when known. */
  readonly operation?: string;

  constructor(
    message: string,
    options?: { bridge?: string; operation?: string; cause?: unknown },
  ) {
    super(message, options);
    this.name = "WorkflowConfigError";
    this.bridge = options?.bridge;
    this.operation = options?.operation;
    Object.setPrototypeOf(this, WorkflowConfigError.prototype);
  }
}

/**
 * Raised when a persistence operation fails, including an internal failure of the
 * Memory_Workflow_Store such as memory exhaustion. The last successfully
 * persisted Workflow_Run state is left unchanged (Requirement 11.5).
 *
 * Carries the failing `operation` (e.g. "save", "load", "append") and the
 * `runId` involved, when known.
 */
export class PersistenceError extends WorkflowError {
  /** The persistence operation that failed (e.g. "save", "load", "append"). */
  readonly operation?: string;
  /** The run identifier the failed persistence operation targeted, when known. */
  readonly runId?: string;

  constructor(
    message: string,
    options?: { operation?: string; runId?: string; cause?: unknown },
  ) {
    super(message, options);
    this.name = "PersistenceError";
    this.operation = options?.operation;
    this.runId = options?.runId;
    Object.setPrototypeOf(this, PersistenceError.prototype);
  }
}

/**
 * Raised when a Workflow_Run is resumed and the recorded result of a command that
 * reached the `completed` state is missing. The run transitions to `failed` and
 * the command is not re-invoked (Requirement 13.4).
 *
 * Carries the `runId` and the offending command `seq` whose recorded result was
 * absent, so the integrity violation can be diagnosed precisely.
 */
export class ResumeIntegrityError extends WorkflowError {
  /** The identifier of the run whose journal integrity check failed. */
  readonly runId: string;
  /** The sequence number of the completed command missing its recorded result. */
  readonly seq?: number;

  constructor(
    runId: string,
    message?: string,
    options?: { seq?: number; cause?: unknown },
  ) {
    super(
      message ??
        `Workflow run "${runId}" cannot be resumed: a completed command is missing its recorded result; the run is marked failed.`,
      options,
    );
    this.name = "ResumeIntegrityError";
    this.runId = runId;
    this.seq = options?.seq;
    Object.setPrototypeOf(this, ResumeIntegrityError.prototype);
  }
}
