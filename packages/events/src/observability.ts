// src/observability.ts
// @streetjs/events — health check + metrics wiring over the reused core
// `HealthCheckRegistry` and `MetricsRegistry`.
//
// Two integration points, mirroring the shape used across StreetJS subsystems:
//   1. a `telemetry` sink (fed live from the dispatch path) drives the
//      published / delivered / failed counters and the handler-latency
//      histogram — pass it to `createEvents({ telemetry })`;
//   2. `attach(events)` registers the `events` health check and the
//      subscriber / async-depth gauges, refreshed best-effort from
//      `events.stats()` (which never throws).
//
// Everything is opt-in: with no `metrics` registry the telemetry is inert; with
// no `health` registry no check is registered. Registration is idempotent
// against a shared registry (reuses an existing metric rather than throwing).

import type {
  HealthCheckRegistry,
  MetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  CheckResult,
} from 'streetjs';
import type { Events, EventsStats, EventsTelemetry } from './facade.js';

/** The name the events health check is registered under. */
export const EVENTS_HEALTH_CHECK_NAME = 'events';

export const EVENTS_PUBLISHED_METRIC = 'events_published_total';
export const EVENTS_DELIVERED_METRIC = 'events_delivered_total';
export const EVENTS_FAILED_METRIC = 'events_failed_total';
export const EVENTS_HANDLER_LATENCY_METRIC = 'event_handler_latency_seconds';
export const EVENTS_LISTENERS_METRIC = 'events_listeners';
export const EVENTS_ASYNC_PENDING_METRIC = 'events_async_pending';

const DEFAULT_REFRESH_INTERVAL_MS = 5_000;

/** Options for {@link registerEventsObservability}. */
export interface EventsObservabilityOptions {
  /** Registry the `events` health check is registered with (Req: health). */
  health?: HealthCheckRegistry;
  /** Registry the event metrics are exported through (Req: metrics). */
  metrics?: MetricsRegistry;
  /** Refresh cadence for gauges when `autoRefresh` is enabled. */
  refreshIntervalMs?: number;
  /**
   * When `true`, an unref'd interval keeps the gauges primed. Default `false`
   * (pull-based: the caller drives {@link EventsObservabilityHandle.refresh}).
   */
  autoRefresh?: boolean;
}

/** Handle returned by {@link registerEventsObservability}. */
export interface EventsObservabilityHandle {
  /**
   * The telemetry sink to pass to `createEvents({ telemetry })`. Feeds the
   * published / delivered / failed counters and the latency histogram live.
   */
  readonly telemetry: EventsTelemetry;
  /**
   * Wire the gauges' source and register the health check against a created
   * facade. Call once after `createEvents`. Idempotent per handle.
   */
  attach(events: Events): void;
  /** Recompute the gauges from `events.stats()` (best-effort; never throws). */
  refresh(): void;
  /** Stop any refresh timer and release resources. Safe to call once. */
  close(): void;
}

/** An inert telemetry sink used when no metrics registry is provided. */
const NOOP_TELEMETRY: EventsTelemetry = {};

/**
 * Register events observability. Returns a {@link EventsObservabilityHandle}
 * whose `telemetry` is passed to `createEvents` and whose `attach` wires the
 * health check + gauges to the created facade.
 */
export function registerEventsObservability(
  options: EventsObservabilityOptions = {},
): EventsObservabilityHandle {
  const { metrics, health } = options;

  let events: Events | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  // ── Metrics (idempotent registration) ────────────────────────────────────────
  let publishedCounter: Counter | undefined;
  let deliveredCounter: Counter | undefined;
  let failedCounter: Counter | undefined;
  let latencyHistogram: Histogram | undefined;
  let listenersGauge: Gauge | undefined;
  let asyncPendingGauge: Gauge | undefined;

  if (metrics) {
    publishedCounter = counter(metrics, EVENTS_PUBLISHED_METRIC, 'Total application events published.');
    deliveredCounter = counter(
      metrics,
      EVENTS_DELIVERED_METRIC,
      'Total successful (event, listener) deliveries.',
    );
    failedCounter = counter(metrics, EVENTS_FAILED_METRIC, 'Total listener failures (isolated).');
    latencyHistogram = histogram(
      metrics,
      EVENTS_HANDLER_LATENCY_METRIC,
      'Event listener execution latency in seconds.',
    );
    listenersGauge = gauge(metrics, EVENTS_LISTENERS_METRIC, 'Active event subscriptions by kind.', [
      'kind',
    ]);
    asyncPendingGauge = gauge(
      metrics,
      EVENTS_ASYNC_PENDING_METRIC,
      'Fire-and-forget deliveries currently queued/in-flight (async depth).',
    );
  }

  const telemetry: EventsTelemetry = metrics
    ? {
        onPublished: () => safe(() => publishedCounter?.inc()),
        onDelivered: (_ctx, ms) =>
          safe(() => {
            deliveredCounter?.inc();
            latencyHistogram?.observe(ms / 1000);
          }),
        onFailed: () => safe(() => failedCounter?.inc()),
      }
    : NOOP_TELEMETRY;

  const refresh = (): void => {
    if (!events) {
      return;
    }
    safe(() => {
      const stats: EventsStats = events!.stats();
      listenersGauge?.set(stats.listeners, { kind: 'total' });
      listenersGauge?.set(stats.patterns, { kind: 'wildcard' });
      asyncPendingGauge?.set(stats.asyncPending);
    });
  };

  const attach = (created: Events): void => {
    events = created;

    if (health) {
      health.addCheck(EVENTS_HEALTH_CHECK_NAME, async (): Promise<CheckResult> => {
        try {
          const stats = created.stats();
          const storeHealth = created.store?.health();
          // Dispatcher is in-process (always up); a configured store's health
          // gates the overall status. Store outage does not affect delivery, so
          // the store contributes `down` only when explicitly unreachable.
          const status: 'up' | 'down' = storeHealth?.status === 'down' ? 'down' : 'up';
          return {
            status,
            details: {
              dispatcher: 'up',
              listeners: stats.listeners,
              patterns: stats.patterns,
              asyncPending: stats.asyncPending,
              published: stats.published,
              failed: stats.failed,
              store: storeHealth?.status ?? 'none',
            },
          };
        } catch (err) {
          return { status: 'down', details: { error: err instanceof Error ? err.message : String(err) } };
        }
      });
    }

    // Prime the gauges immediately; optionally keep them fresh via an unref'd timer.
    refresh();
    if (options.autoRefresh) {
      timer = setInterval(refresh, options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS);
      timer.unref?.();
    }
  };

  return {
    telemetry,
    attach,
    refresh,
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
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
    // Observability must never destabilize dispatch or a metrics scrape.
  }
}
