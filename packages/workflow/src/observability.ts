// src/observability.ts
// @streetjs/workflow — health check + metrics wiring over the reused core
// `HealthCheckRegistry` and `MetricsRegistry` primitives (Requirement 21.6).
//
// Following the storage/events package `observability.ts` pattern, this module
// exposes a single entry point, `registerWorkflowObservability`, that returns a
// handle with:
//
//   1. a `telemetry` sink the engine feeds live as runs transition — it drives
//      the completed / failed run counters, the retry and compensation counters,
//      and the run-duration histogram (Requirement 21.3);
//   2. a `refresh()` that recomputes the gauges (running workflows, active
//      timers, queued activities) from the engine's `stats()` snapshot; and
//   3. an `attach(introspect)` method that registers the persistence-store
//      availability health check against the `HealthCheckRegistry`, mapping
//      `store.probe()` onto a `CheckResult` (Requirement 21.5), and primes the
//      gauges.
//
// Everything is opt-in: with no `metrics` registry the telemetry is inert and no
// metric is registered (Requirement 21.4); with no `health` registry no check is
// registered. Registration is idempotent against a shared registry (reuses an
// existing metric rather than throwing — `reg.has(name) ? reg.get(name) :
// reg.counter(...)`), so several engines can share one registry (Requirement
// 21.6). Only the existing core primitives are reused; no separate metrics /
// health system is introduced (Requirement 21.6).

import type {
  HealthCheckRegistry,
  MetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  CheckResult,
} from "streetjs";

import type { StoreProbe, WorkflowStats } from "./types.js";

/**
 * The introspection slice of the {@link WorkflowEngine} the observability layer
 * reads: a synchronous stats snapshot for the gauges and the best-effort store
 * probe for the health check.
 */
export interface WorkflowIntrospect {
  /** Live, best-effort metrics snapshot (never throws). */
  stats(): WorkflowStats;
  /** Best-effort persistence-store availability probe. */
  probe(): Promise<StoreProbe>;
}

/** The name the persistence-store health check is registered under. */
export const WORKFLOW_STORE_HEALTH_CHECK_NAME = "workflow_store";

export const WORKFLOW_RUNNING_METRIC = "workflow_runs_running";
export const WORKFLOW_COMPLETED_METRIC = "workflow_runs_completed_total";
export const WORKFLOW_FAILED_METRIC = "workflow_runs_failed_total";
export const WORKFLOW_RETRIES_METRIC = "workflow_activity_retries_total";
export const WORKFLOW_COMPENSATIONS_METRIC = "workflow_compensations_total";
export const WORKFLOW_DURATION_METRIC = "workflow_run_duration_seconds";
export const WORKFLOW_ACTIVE_TIMERS_METRIC = "workflow_active_timers";
export const WORKFLOW_QUEUED_ACTIVITIES_METRIC = "workflow_queued_activities";

/**
 * The live telemetry sink the engine feeds as runs transition. Every hook is
 * optional so an inert sink (no metrics registry) is a complete no-op. All hooks
 * are isolated so observability never destabilizes a run.
 */
export interface WorkflowTelemetry {
  /** A run reached the terminal `completed` state after `durationSeconds`. */
  onCompleted?(durationSeconds: number): void;
  /** A run reached a terminal failure (`failed`/`compensated`) after `durationSeconds`. */
  onFailed?(durationSeconds: number): void;
  /** `count` additional activity retries were consumed. */
  onRetries?(count: number): void;
  /** `count` additional activity compensations ran. */
  onCompensations?(count: number): void;
}

/** Options for {@link registerWorkflowObservability}. */
export interface WorkflowObservabilityOptions {
  /** Registry the workflow metrics are exported through (Req 21.3, 21.4). */
  metrics?: MetricsRegistry;
  /** Registry the persistence-store health check is registered with (Req 21.5). */
  health?: HealthCheckRegistry;
}

/** Handle returned by {@link registerWorkflowObservability}. */
export interface WorkflowObservabilityHandle {
  /**
   * The telemetry sink the engine feeds live. Drives the run counters and the
   * duration histogram as runs transition.
   */
  readonly telemetry: WorkflowTelemetry;
  /**
   * Register the persistence-store health check against the supplied engine
   * introspection and prime the gauges from `introspect.stats()`. Call once at
   * engine construction.
   */
  attach(introspect: WorkflowIntrospect): void;
  /** Recompute the gauges from `introspect.stats()` (best-effort; never throws). */
  refresh(): void;
  /** Release resources. Safe to call more than once. */
  close(): void;
}

/** An inert telemetry sink used when no metrics registry is provided. */
const NOOP_TELEMETRY: WorkflowTelemetry = {};

/**
 * Register workflow observability. Returns a {@link WorkflowObservabilityHandle}
 * whose `telemetry` the engine feeds live, whose `refresh` recomputes the gauges
 * from the engine's `stats()`, and whose `attach` wires the persistence-store
 * health check.
 */
export function registerWorkflowObservability(
  options: WorkflowObservabilityOptions = {},
): WorkflowObservabilityHandle {
  const { metrics, health } = options;

  let introspect: WorkflowIntrospect | undefined;

  // ── Metrics (idempotent registration; skipped entirely without a registry) ──
  let completedCounter: Counter | undefined;
  let failedCounter: Counter | undefined;
  let retriesCounter: Counter | undefined;
  let compensationsCounter: Counter | undefined;
  let runningGauge: Gauge | undefined;
  let activeTimersGauge: Gauge | undefined;
  let queuedActivitiesGauge: Gauge | undefined;
  let durationHistogram: Histogram | undefined;

  if (metrics) {
    completedCounter = counter(metrics, WORKFLOW_COMPLETED_METRIC, "Total workflow runs completed.");
    failedCounter = counter(metrics, WORKFLOW_FAILED_METRIC, "Total workflow runs failed.");
    retriesCounter = counter(
      metrics,
      WORKFLOW_RETRIES_METRIC,
      "Total activity retry attempts consumed.",
    );
    compensationsCounter = counter(
      metrics,
      WORKFLOW_COMPENSATIONS_METRIC,
      "Total activity compensations executed.",
    );
    runningGauge = gauge(metrics, WORKFLOW_RUNNING_METRIC, "Workflow runs currently running.");
    activeTimersGauge = gauge(
      metrics,
      WORKFLOW_ACTIVE_TIMERS_METRIC,
      "Workflow timers currently active (runs waiting).",
    );
    queuedActivitiesGauge = gauge(
      metrics,
      WORKFLOW_QUEUED_ACTIVITIES_METRIC,
      "Activities currently queued for execution.",
    );
    durationHistogram = histogram(
      metrics,
      WORKFLOW_DURATION_METRIC,
      "Workflow run execution duration in seconds.",
    );
  }

  const telemetry: WorkflowTelemetry = metrics
    ? {
        onCompleted: (durationSeconds) =>
          safe(() => {
            completedCounter?.inc();
            durationHistogram?.observe(durationSeconds);
          }),
        onFailed: (durationSeconds) =>
          safe(() => {
            failedCounter?.inc();
            durationHistogram?.observe(durationSeconds);
          }),
        onRetries: (count) =>
          safe(() => {
            if (count > 0) {
              retriesCounter?.inc({}, count);
            }
          }),
        onCompensations: (count) =>
          safe(() => {
            if (count > 0) {
              compensationsCounter?.inc({}, count);
            }
          }),
      }
    : NOOP_TELEMETRY;

  const refresh = (): void => {
    if (!introspect) {
      return;
    }
    safe(() => {
      const stats = introspect!.stats();
      runningGauge?.set(stats.running);
      activeTimersGauge?.set(stats.activeTimers);
      queuedActivitiesGauge?.set(stats.queuedActivities);
    });
  };

  const attach = (engine: WorkflowIntrospect): void => {
    introspect = engine;

    if (health) {
      health.addCheck(
        WORKFLOW_STORE_HEALTH_CHECK_NAME,
        async (): Promise<CheckResult> => {
          try {
            const probe = await engine.probe();
            return {
              status: probe.available ? "up" : "down",
              details: probe.detail !== undefined ? { detail: probe.detail } : {},
            };
          } catch (err) {
            return {
              status: "down",
              details: { error: err instanceof Error ? err.message : String(err) },
            };
          }
        },
        { type: "readiness" },
      );
    }

    // Prime the gauges immediately from the engine's initial snapshot.
    refresh();
  };

  return {
    telemetry,
    attach,
    refresh,
    close: () => {
      // No long-lived resources are held; timers/signals are driven synchronously
      // by the engine. Present for symmetry with the sibling observability layers.
    },
  };
}

// ── Idempotent metric helpers ────────────────────────────────────────────────

function counter(reg: MetricsRegistry, name: string, help: string): Counter {
  return reg.has(name) ? (reg.get(name) as Counter) : reg.counter(name, help);
}
function gauge(reg: MetricsRegistry, name: string, help: string, labels: string[] = []): Gauge {
  return reg.has(name) ? (reg.get(name) as Gauge) : reg.gauge(name, help, labels);
}
function histogram(reg: MetricsRegistry, name: string, help: string): Histogram {
  return reg.has(name) ? (reg.get(name) as Histogram) : reg.histogram(name, help);
}
function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // Observability must never destabilize a workflow run or a metrics scrape.
  }
}
