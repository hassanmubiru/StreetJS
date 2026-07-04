// src/observability.ts
// @streetjs/gateway — health check + metrics wiring over the reused core
// `HealthCheckRegistry` and `MetricsRegistry` primitives.
//
// This module mirrors the sibling `packages/workflow/src/observability.ts`
// pattern exactly: a single entry point, `registerGatewayObservability`, that
// returns a handle with:
//
//   1. a `telemetry` sink the gateway feeds live as requests/connections flow —
//      it drives the request + error counters, the request-duration histogram,
//      and the active-connections gauge;
//   2. a `refresh()` that recomputes the gauges (active connections, healthy
//      backends) from the gateway's `stats()` snapshot; and
//   3. an `attach(introspect)` that registers the upstream-availability health
//      check against the `HealthCheckRegistry`, mapping `healthyUpstreams > 0`
//      onto a `CheckResult` (`up`/`down`), and primes the gauges.
//
// Everything is opt-in: with no `metrics` registry the telemetry is inert and no
// metric is registered; with no `health` registry no check is registered.
// Registration is idempotent against a shared registry (reuses an existing
// metric rather than throwing — `reg.has(name) ? reg.get(name) : reg.counter(...)`),
// so several gateways can share one registry. Only the existing core primitives
// are reused; no separate metrics / health system is introduced.

import type {
  HealthCheckRegistry,
  MetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  CheckResult,
} from "streetjs";

/**
 * A live, best-effort gateway metrics snapshot. Consumed by the gauges (active
 * connections, healthy/unhealthy upstreams) and by the upstream health check.
 */
export interface GatewayStats {
  activeConnections: number;
  requestsTotal: number;
  errorsTotal: number;
  healthyUpstreams: number;
  unhealthyUpstreams: number;
}

/** The name the upstream-availability health check is registered under. */
export const GATEWAY_HEALTH_CHECK_NAME = "gateway_upstreams";

export const GATEWAY_REQUESTS_TOTAL = "gateway_requests_total";
export const GATEWAY_ERRORS_TOTAL = "gateway_errors_total";
export const GATEWAY_LATENCY = "gateway_request_duration_ms";
export const GATEWAY_ACTIVE_CONNECTIONS = "gateway_active_connections";
export const GATEWAY_BACKEND_HEALTHY = "gateway_backend_healthy";

/**
 * The introspection slice the observability layer reads: a synchronous stats
 * snapshot used both for the gauges and for the upstream health check.
 */
export interface GatewayIntrospect {
  /** Live, best-effort metrics snapshot (never throws). */
  stats(): GatewayStats;
}

/**
 * The live telemetry sink the gateway feeds as requests and connections flow.
 * Every hook is optional so an inert sink (no metrics registry) is a complete
 * no-op. All hooks are isolated so observability never destabilizes a request.
 */
export interface GatewayTelemetry {
  /** A request completed in `latencyMs`; `isError` marks a 5xx/failed proxy. */
  onRequest?(latencyMs: number, isError: boolean): void;
  /** A new client connection was opened. */
  onConnectionOpen?(): void;
  /** A client connection was closed. */
  onConnectionClose?(): void;
}

/** Options for {@link registerGatewayObservability}. */
export interface GatewayObservabilityOptions {
  /** Registry the gateway metrics are exported through. */
  metrics?: MetricsRegistry;
  /** Registry the upstream-availability health check is registered with. */
  health?: HealthCheckRegistry;
}

/** Handle returned by {@link registerGatewayObservability}. */
export interface GatewayObservabilityHandle {
  /**
   * The telemetry sink the gateway feeds live. Drives the request/error counters,
   * the latency histogram, and the active-connections gauge.
   */
  readonly telemetry: GatewayTelemetry;
  /**
   * Register the upstream-availability health check against the supplied gateway
   * introspection and prime the gauges from `introspect.stats()`. Call once at
   * gateway construction.
   */
  attach(introspect: GatewayIntrospect): void;
  /** Recompute the gauges from `introspect.stats()` (best-effort; never throws). */
  refresh(): void;
  /** Release resources. Safe to call more than once. */
  close(): void;
}

/** An inert telemetry sink used when no metrics registry is provided. */
const NOOP_TELEMETRY: GatewayTelemetry = {};

/**
 * Register gateway observability. Returns a {@link GatewayObservabilityHandle}
 * whose `telemetry` the gateway feeds live, whose `refresh` recomputes the gauges
 * from the gateway's `stats()`, and whose `attach` wires the upstream health
 * check.
 */
export function registerGatewayObservability(
  options: GatewayObservabilityOptions = {},
): GatewayObservabilityHandle {
  const { metrics, health } = options;

  let introspect: GatewayIntrospect | undefined;

  // ── Metrics (idempotent registration; skipped entirely without a registry) ──
  let requestsCounter: Counter | undefined;
  let errorsCounter: Counter | undefined;
  let latencyHistogram: Histogram | undefined;
  let activeConnectionsGauge: Gauge | undefined;
  let healthyBackendsGauge: Gauge | undefined;

  if (metrics) {
    requestsCounter = counter(metrics, GATEWAY_REQUESTS_TOTAL, "Total gateway requests handled.");
    errorsCounter = counter(metrics, GATEWAY_ERRORS_TOTAL, "Total gateway requests that errored.");
    latencyHistogram = histogram(
      metrics,
      GATEWAY_LATENCY,
      "Gateway request handling duration in milliseconds.",
    );
    activeConnectionsGauge = gauge(
      metrics,
      GATEWAY_ACTIVE_CONNECTIONS,
      "Client connections currently open.",
    );
    healthyBackendsGauge = gauge(
      metrics,
      GATEWAY_BACKEND_HEALTHY,
      "Upstream backends currently healthy.",
    );
  }

  // The core `Gauge` primitive only exposes `set(value)` (no `inc`/`dec`), so —
  // adapting the sibling which drives gauges purely from `refresh()` — we track
  // the live connection count locally and `set()` the gauge on each change.
  let liveConnections = 0;

  const telemetry: GatewayTelemetry = metrics
    ? {
        onRequest: (latencyMs, isError) =>
          safe(() => {
            requestsCounter?.inc();
            latencyHistogram?.observe(latencyMs);
            if (isError) {
              errorsCounter?.inc();
            }
          }),
        onConnectionOpen: () =>
          safe(() => {
            liveConnections++;
            activeConnectionsGauge?.set(liveConnections);
          }),
        onConnectionClose: () =>
          safe(() => {
            liveConnections = Math.max(0, liveConnections - 1);
            activeConnectionsGauge?.set(liveConnections);
          }),
      }
    : NOOP_TELEMETRY;

  const refresh = (): void => {
    if (!introspect) {
      return;
    }
    safe(() => {
      const stats = introspect!.stats();
      activeConnectionsGauge?.set(stats.activeConnections);
      healthyBackendsGauge?.set(stats.healthyUpstreams);
    });
  };

  const attach = (gateway: GatewayIntrospect): void => {
    introspect = gateway;

    if (health) {
      health.addCheck(
        GATEWAY_HEALTH_CHECK_NAME,
        // The upstream check is derived from the synchronous `stats()` snapshot
        // (there is no async probe on the gateway), so — adapting the sibling's
        // async store-probe check — we resolve immediately from `stats()`.
        async (): Promise<CheckResult> => {
          try {
            const stats = gateway.stats();
            return {
              status: stats.healthyUpstreams > 0 ? "up" : "down",
              details: {
                healthyUpstreams: stats.healthyUpstreams,
                unhealthyUpstreams: stats.unhealthyUpstreams,
              },
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

    // Prime the gauges immediately from the gateway's initial snapshot.
    refresh();
  };

  return {
    telemetry,
    attach,
    refresh,
    close: () => {
      // No long-lived resources are held; metrics/gauges are driven synchronously
      // by the gateway. Present for symmetry with the sibling observability layers.
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
    // Observability must never destabilize a gateway request or a metrics scrape.
  }
}
