/**
 * @streetjs/workflow
 *
 * StreetJS Core v2 Pillar 5: a durable, strongly-typed workflow orchestration
 * engine. This is the public entry point of the package (`.`).
 *
 * IMPORTANT: This base entry imports NO pillar package (`@streetjs/storage`,
 * `@streetjs/queue`, `@streetjs/events`, `@streetjs/realtime`) and NO Redis
 * client. Pillar integration is achieved through optional, structural `*Like`
 * bridge contracts, and Redis persistence is isolated behind the dedicated
 * `@streetjs/workflow/redis` submodule. Core types, errors, the store contract,
 * the engine facade, and the context surface are re-exported from here as they
 * are implemented in subsequent tasks.
 *
 * For now this file provides a minimal placeholder export so that `tsc` emits a
 * valid `dist/index.js` and the package builds clean.
 */

/** The semantic version line of the workflow engine package surface. */
export const WORKFLOW_FRAMEWORK_VERSION = "1.0.0" as const;

/**
 * Marker identifying the package. Replaced/augmented with real public exports
 * (types, errors, store, engine facade, context) in later tasks.
 */
export const WORKFLOW_PACKAGE_NAME = "@streetjs/workflow" as const;

// --- Typed error hierarchy (Task 2.2) ---
export {
  WorkflowError,
  RegistrationError,
  WorkflowNotFoundError,
  CancelledResumeError,
  WorkflowConfigError,
  PersistenceError,
  ResumeIntegrityError,
} from "./errors.js";
