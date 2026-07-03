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

// --- Backoff delay math (Task 2.3) ---
export { computeBackoff } from "./backoff.js";

// --- Shared typed models (Task 2.1) ---
export type {
  // Run status + durable run
  RunStatus,
  WorkflowRun,
  // Command journaling
  CommandRecord,
  CommandKind,
  HistoryEvent,
  RecordedSignal,
  SerializedError,
  // Retry + backoff
  RetryPolicy,
  Backoff,
  // Activities, options, middleware, compensation
  Activity,
  ActivityOptions,
  ActivityMiddleware,
  Compensation,
  Saga,
  Branch,
  ParallelInput,
  // ctx surface
  WorkflowContext,
  QueueContext,
  EventsContext,
  StorageContext,
  RealtimeContext,
  WorkflowMetadata,
  WorkflowState,
  WorkflowLogger,
  // Function + handle
  WorkflowFunction,
  WorkflowHandle,
  // Structural pillar bridge contracts
  StorageLike,
  QueueLike,
  EventsLike,
  RealtimeLike,
  // Persistence contract
  WorkflowStore,
  StoreProbe,
  // Summaries, config, options, stats
  WorkflowSummary,
  WorkflowConfig,
  RunOptions,
  WorkflowStats,
} from "./types.js";

// Value re-export: the terminal Run_Status set (Task 2.1).
export { TERMINAL } from "./types.js";

// --- Persistence store: zero-dependency default (Task 3.1) ---
// The WorkflowStore/StoreProbe types are re-exported above from "./types.js";
// here we add the concrete MemoryWorkflowStore value export.
export { MemoryWorkflowStore } from "./store.js";
