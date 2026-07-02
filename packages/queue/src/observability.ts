// src/observability.ts
// @streetjs/queue — health check + metrics wiring (Req 12.1–12.6).
//
// This module registers a queue health check against the reused core
// `HealthCheckRegistry` (reported through the existing `/health/*` routes,
// Req 12.1) and exports queue-length/worker-status/latency/processed/failure
// metrics through the reused core `MetricsRegistry` (Req 12.2). Both the health
// check and the metric snapshot read live state from the active driver and
// worker best-effort — they never throw (Req 12.3).
//
// Driver connectivity is delegated to `driver.health()` (Req 12.4–12.6): the
// MemoryDriver is always `up`, while a configured RedisDriver reports `down` on
// connection loss and stays `up` while connected even when an individual
// command fails (auth error / timeout). Mapping the driver's own `health()`
// onto the CheckResult is therefore all the queue layer must do — the
// connected-vs-command-error distinction lives in the RedisDriver (task 15.1).
//
// Observability is deliberately opt-in: `registerQueueObservability` only
// touches a registry that is actually provided, so Memory-driver users who wire
// no observability pay nothing. It mirrors `@streetjs/realtime`'s
// `registerRealtimeObservability`, and is called by `createQueue`/`QueuePlugin`
// when a `health` and/or `metrics` registry is configured.

import type {
  HealthCheckRegistry,
  MetricsRegistry,
  Gauge,
  Counter,
  Histogram,
  CheckResult,
} from 'streetjs';
import type { QueueDriver } from './drivers/driver.js';
import type { Worker } from './worker.js';

/**
 * The name the queue health check is registered under with the
 * {@link HealthCheckRegistry}. Reported through the existing `/health/*` routes
 * (Req 12.1).
 */
export const QUEUE_HEALTH_CHECK_NAME = 'queue';

/**
 * Gauge exporting the number of ready (immediately eligible) jobs across the
 * active driver, plus delayed/reserved/dead-lettered breakdowns via labels
 * (Req 12.2). Sourced from {@link QueueDriver.stats}.
 */
export const QUEUE_LENGTH_METRIC = 'queue_length';
const QUEUE_LENGTH_HELP =
  'Number of jobs in the queue by state (ready/delayed/reserved/dead_lettered) (Req 12.2).';

/**
 * Gauge exporting worker liveness/throughput fields labelled by `field`
 * (running/concurrency/in_flight/processed/failed) (Req 12.2). Sourced from
 * {@link Worker.status}.
 */
export const QUEUE_WORKER_STATUS_METRIC = 'queue_worker_status';
const QUEUE_WORKER_STATUS_HELP =
  'Worker liveness and throughput fields (running/concurrency/in_flight/processed/failed) (Req 12.2).';

/**
 * Histogram exporting observed job execution latency in seconds (Req 12.2).
 * Populated by the caller via {@link QueueObservabilityHandle.observeLatency}
 * (wired from the facade's `job.completed` event).
 */
export const QUEUE_JOB_LATENCY_METRIC = 'queue_job_latency_seconds';
const QUEUE_JOB_LATENCY_HELP = 'Job execution latency in seconds (Req 12.2).';

/**
 * Counter exporting the total number of jobs processed successfully (Req 12.2).
 * Kept in step with the worker's `processed` count on every snapshot.
 */
export const QUEUE_PROCESSED_METRIC = 'queue_processed_total';
const QUEUE_PROCESSED_HELP = 'Total jobs processed successfully (Req 12.2).';

/**
 * Counter exporting the total number of jobs that failed terminally
 * (dead-lettered) (Req 12.2). Kept in step with the worker's `failed` count on
 * every snapshot.
 */
export const QUEUE_FAILURES_METRIC = 'queue_failures_total';
const QUEUE_FAILURES_HELP = 'Total jobs that failed terminally / were dead-lettered (Req 12.2).';

/** Default interval at which the exported gauges/counters are refreshed. */
const DEFAULT_REFRESH_INTERVAL_MS = 5_000;

/**
 * Everything {@link registerQueueObservability} needs to wire the queue health
 * check and metrics. The observability layer reads live state from the active
 * `driver` (connectivity for the health check plus queue-length counts) and the
 * optional `worker` (liveness + processed/failure counts); the target
 * `health`/`metrics` registries are the existing core subsystems. All
 * registries and the worker are optional so observability degrades to a no-op
 * when a registry is absent.
 */
export interface QueueObservabilityDeps {
  /** The active driver; source of connectivity (Req 12.1, 12.4–12.6) and stats (Req 12.2). */
  readonly driver: QueueDriver;
  /** The active worker; source of liveness + processed/failure counts (Req 12.2). */
  readonly worker?: Worker;
  /** Registry the queue health check is registered with (Req 12.1). */
  readonly health?: HealthCheckRegistry;
  /** Registry the queue metrics are exported through (Req 12.2). */
  readonly metrics?: MetricsRegistry;
  /** Queues to report a length gauge for. Defaults to `['default']`. */
  readonly queues?: readonly string[];
  /** Gauge/counter refresh cadence; defaults to {@link DEFAULT_REFRESH_INTERVAL_MS}. */
  readonly refreshIntervalMs?: number;
  /**
   * When `false` (the default), no background refresh timer is started and the
   * caller drives {@link QueueObservabilityHandle.refresh} on scrape. When
   * `true`, a low-frequency unref'd timer keeps the gauges primed.
   */
  readonly autoRefresh?: boolean;
}

/**
 * Handle returned by {@link registerQueueObservability} so the caller can force
 * an immediate metric snapshot (used on Prometheus scrape and by tests to
 * observe current values without waiting for a timer), record job latency, and
 * release any background refresh timer on teardown. Wired into `Queue.close()`.
 */
export interface QueueObservabilityHandle {
  /**
   * Recompute and set the exported gauges/counters from current live state
   * (Req 12.2, 12.3). Best-effort: reads `driver.stats()`/`worker.status()`
   * guarded so it never throws.
   */
  refresh(): Promise<void>;
  /** Record one job's execution latency (seconds) in the latency histogram. */
  observeLatency(seconds: number): void;
  /** Stop any background refresh timer and release resources. Safe to call once. */
  close(): void;
}

/** An inert handle used when no metrics registry is provided. */
const NOOP_HANDLE: QueueObservabilityHandle = {
  refresh: async () => {},
  observeLatency: () => {},
  close: () => {},
};

/**
 * Register the queue health check and metrics with the provided core
 * observability registries (Req 12.1–12.6).
 *
 * - **Health check (Req 12.1, 12.4–12.6).** When a `health` registry is
 *   provided, a check named {@link QUEUE_HEALTH_CHECK_NAME} is registered that
 *   maps the active driver's `health()` — `up`/`down` — onto a `CheckResult`
 *   reported through the existing `/health/*` routes. The MemoryDriver is
 *   always `up` (Req 12.5); a configured RedisDriver reports `down` on
 *   connection loss (Req 12.4) and stays `up` while connected even when an
 *   individual command fails with an auth error or timeout (Req 12.6) — that
 *   distinction is the RedisDriver's own `health()` responsibility, so the
 *   queue layer simply delegates. Worker liveness is attached to the check
 *   details. The check body is guarded so it never throws (Req 12.3).
 * - **Metrics (Req 12.2, 12.3).** When a `metrics` registry is provided, a
 *   queue-length gauge, a worker-status gauge, a job-latency histogram, and
 *   processed/failure counters are registered and refreshed immediately and
 *   (optionally) on a background interval. Every refresh reads
 *   `driver.stats()`/`worker.status()` best-effort inside a try/catch so a
 *   scrape never throws (Req 12.3).
 *
 * Registering against a registry that already holds a metric/check (for example
 * a second facade or the QueuePlugin over the same registry) reuses the
 * existing metric rather than throwing — important because QueuePlugin (task
 * 13) and tests may register more than once against a shared registry. When
 * neither registry is provided the returned handle is an inert no-op.
 */
export function registerQueueObservability(
  deps: QueueObservabilityDeps,
): QueueObservabilityHandle {
  const { driver, worker, health, metrics } = deps;
  const queues = deps.queues && deps.queues.length > 0 ? [...deps.queues] : ['default'];

  // ── Health check (Req 12.1, 12.4–12.6) ──────────────────────────────────────
  // The driver's connectivity drives the subsystem status. The MemoryDriver is
  // always `up`; a configured RedisDriver reports `down` on connection loss and
  // stays `up` while connected even when an individual command errors — the
  // queue layer only maps `driver.health()` onto the CheckResult and delegates
  // that distinction to the driver. Worker liveness is attached for operator
  // visibility. Guarded so the check body never throws (Req 12.3).
  if (health) {
    health.addCheck(QUEUE_HEALTH_CHECK_NAME, async (): Promise<CheckResult> => {
      try {
        const driverHealth = driver.health();
        const details: Record<string, unknown> = { driver: driverHealth.status };
        if (driverHealth.details) details['driverDetails'] = driverHealth.details;
        if (worker) {
          const status = worker.status();
          details['worker'] = {
            running: status.running,
            inFlight: status.inFlight,
            concurrency: status.concurrency,
            processed: status.processed,
            failed: status.failed,
            queues: status.queues,
          };
        }
        return { status: driverHealth.status, details };
      } catch (err) {
        // Best-effort: a misbehaving driver.health() must not crash the probe.
        return {
          status: 'down',
          details: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    });
  }

  // ── Metrics (Req 12.2, 12.3) ─────────────────────────────────────────────────
  // No metrics registry ⇒ nothing to export; return an inert handle so callers
  // (and Queue.close) can treat observability uniformly.
  if (!metrics) {
    return NOOP_HANDLE;
  }

  // Idempotent registration: reuse an existing metric rather than throwing a
  // MetricConflictError if the same registry was wired twice (Req: QueuePlugin
  // + tests may register against a shared registry).
  const lengthGauge = metrics.has(QUEUE_LENGTH_METRIC)
    ? (metrics.get(QUEUE_LENGTH_METRIC) as Gauge)
    : metrics.gauge(QUEUE_LENGTH_METRIC, QUEUE_LENGTH_HELP, ['queue', 'state']);

  const workerGauge = metrics.has(QUEUE_WORKER_STATUS_METRIC)
    ? (metrics.get(QUEUE_WORKER_STATUS_METRIC) as Gauge)
    : metrics.gauge(QUEUE_WORKER_STATUS_METRIC, QUEUE_WORKER_STATUS_HELP, ['field']);

  const latencyHistogram = metrics.has(QUEUE_JOB_LATENCY_METRIC)
    ? (metrics.get(QUEUE_JOB_LATENCY_METRIC) as Histogram)
    : metrics.histogram(QUEUE_JOB_LATENCY_METRIC, QUEUE_JOB_LATENCY_HELP);

  const processedCounter = metrics.has(QUEUE_PROCESSED_METRIC)
    ? (metrics.get(QUEUE_PROCESSED_METRIC) as Counter)
    : metrics.counter(QUEUE_PROCESSED_METRIC, QUEUE_PROCESSED_HELP);

  const failuresCounter = metrics.has(QUEUE_FAILURES_METRIC)
    ? (metrics.get(QUEUE_FAILURES_METRIC) as Counter)
    : metrics.counter(QUEUE_FAILURES_METRIC, QUEUE_FAILURES_HELP);

  // Counters are monotonic — track the last observed worker totals so each
  // snapshot increments only by the delta since the previous refresh (setting a
  // counter absolutely is not supported by the core Counter surface).
  let lastProcessed = 0;
  let lastFailed = 0;

  /**
   * Best-effort snapshot (Req 12.3): read live counts from the driver and worker
   * and set/increment the exported metrics. Every read is guarded so a failure
   * in one source never prevents the others from updating and never throws to
   * the caller (a Prometheus scrape must always succeed).
   */
  const refresh = async (): Promise<void> => {
    // Queue length gauge from the driver's best-effort stats (never throws).
    for (const queue of queues) {
      try {
        const stats = await driver.stats(queue);
        lengthGauge.set(stats.ready, { queue, state: 'ready' });
        lengthGauge.set(stats.delayed, { queue, state: 'delayed' });
        lengthGauge.set(stats.reserved, { queue, state: 'reserved' });
        lengthGauge.set(stats.deadLettered, { queue, state: 'dead_lettered' });
      } catch {
        // Ignore: keep the previous gauge values rather than failing the scrape.
      }
    }

    // Worker status gauge + processed/failure counters from live worker status.
    if (worker) {
      try {
        const status = worker.status();
        workerGauge.set(status.running ? 1 : 0, { field: 'running' });
        workerGauge.set(status.concurrency, { field: 'concurrency' });
        workerGauge.set(status.inFlight, { field: 'in_flight' });
        workerGauge.set(status.processed, { field: 'processed' });
        workerGauge.set(status.failed, { field: 'failed' });

        // Counters are monotonic: advance by the delta since the last snapshot.
        // Guard against a worker whose totals reset (e.g. replaced instance) so
        // a negative delta never decrements the counter.
        const processedDelta = status.processed - lastProcessed;
        if (processedDelta > 0) processedCounter.inc({}, processedDelta);
        const failedDelta = status.failed - lastFailed;
        if (failedDelta > 0) failuresCounter.inc({}, failedDelta);
        lastProcessed = status.processed;
        lastFailed = status.failed;
      } catch {
        // Ignore: best-effort worker snapshot.
      }
    }
  };

  const observeLatency = (seconds: number): void => {
    try {
      if (Number.isFinite(seconds) && seconds >= 0) {
        latencyHistogram.observe(seconds);
      }
    } catch {
      // Ignore: recording latency must never throw into the hot path.
    }
  };

  // Prime the gauges immediately so the first scrape reflects live state. By
  // default no timer is started (pull-based scrape drives `refresh()`), so the
  // handle leaks no timer; enabling `autoRefresh` starts a low-frequency unref'd
  // interval so a long-lived process keeps the gauges fresh without keeping the
  // event loop alive.
  void refresh();

  let timer: ReturnType<typeof setInterval> | undefined;
  if (deps.autoRefresh) {
    const intervalMs = deps.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    timer = setInterval(() => {
      void refresh();
    }, intervalMs);
    timer.unref?.();
  }

  let closed = false;
  return {
    refresh,
    observeLatency,
    close: () => {
      if (closed) return;
      closed = true;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
