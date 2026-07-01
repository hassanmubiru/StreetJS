// src/health.ts
// Realtime health check + metrics wiring (Req 17).
//
// This module registers a realtime health check with the core
// `HealthCheckRegistry` (reported through the existing `/health/*` routes,
// Req 17.1) and exports connection-count and per-Room member-count metrics
// through the core `MetricsRegistry` (Req 17.2). The realtime health check also
// surfaces the cluster adapter's connectivity — including a configured
// `RedisAdapter` (Req 17.4) — via `ClusterAdapter.health()`.
//
// Observability is deliberately opt-in: `registerRealtimeObservability` only
// touches a registry that is actually provided, so Memory_Adapter users who
// wire no observability pay nothing. It is called by `createRealtime` when a
// `health` and/or `metrics` registry is configured on `RealtimeOptions`, which
// is how `RealtimePlugin.onLoad` registers observability (the `SandboxedApp`
// handed to a plugin exposes neither the WebSocket server nor the registries,
// so those are resolved from `RealtimeOptions`).

import type {
  ChannelHub,
  HealthCheckRegistry,
  MetricsRegistry,
  StreetWebSocketServer,
  Gauge,
  CheckResult,
} from 'streetjs';
import type { ClusterAdapter } from './cluster/adapter.js';

/**
 * The name the realtime health check is registered under with the
 * {@link HealthCheckRegistry}. Reported through the existing `/health/*` routes
 * (Req 17.1).
 */
export const REALTIME_HEALTH_CHECK_NAME = 'realtime';

/**
 * Gauge exporting the number of live WebSocket connections on the realtime
 * subsystem's server (Req 17.2). Sourced from
 * {@link StreetWebSocketServer.connectionCount}.
 */
export const REALTIME_CONNECTIONS_METRIC = 'realtime_connections';

/** Help text for {@link REALTIME_CONNECTIONS_METRIC}. */
const REALTIME_CONNECTIONS_HELP =
  'Number of live realtime WebSocket connections on the subsystem server (Req 17.2).';

/**
 * Gauge exporting the count of members present in each Room, labelled by
 * `room` (Req 17.2). Sourced from {@link ChannelHub.memberCount} for every
 * channel that currently has at least one connection.
 */
export const REALTIME_ROOM_MEMBERS_METRIC = 'realtime_room_members';

/** Help text for {@link REALTIME_ROOM_MEMBERS_METRIC}. */
const REALTIME_ROOM_MEMBERS_HELP =
  'Number of members present in each realtime Room, labelled by room (Req 17.2).';

/** Default interval at which the exported gauges are refreshed from live state. */
const DEFAULT_REFRESH_INTERVAL_MS = 5_000;

/**
 * Everything {@link registerRealtimeObservability} needs to wire the realtime
 * health check and metrics. The observability layer reads live state from the
 * facade's owned `hub` (per-Room member counts, Req 17.2), the `adapter`
 * (connectivity for the health check, Req 17.1/17.4), and the WebSocket
 * `server` (connection count, Req 17.2); the target `health`/`metrics`
 * registries are the existing core subsystems. All registries and the server
 * are optional so observability degrades to a no-op when a registry is absent.
 */
export interface RealtimeObservabilityDeps {
  /** The facade-owned `ChannelHub`; source of per-Room member counts (Req 17.2). */
  readonly hub: ChannelHub;
  /** The active cluster adapter; source of connectivity for the health check (Req 17.1, 17.4). */
  readonly adapter: ClusterAdapter;
  /** The WebSocket server; source of the connection-count metric (Req 17.2). */
  readonly server?: StreetWebSocketServer;
  /** Registry the realtime health check is registered with (Req 17.1). */
  readonly health?: HealthCheckRegistry;
  /** Registry the connection/member-count gauges are exported through (Req 17.2). */
  readonly metrics?: MetricsRegistry;
  /** Gauge refresh cadence; defaults to {@link DEFAULT_REFRESH_INTERVAL_MS}. */
  readonly refreshIntervalMs?: number;
}

/**
 * Handle returned by {@link registerRealtimeObservability} so the caller can
 * force an immediate metric refresh (used by tests to observe current values
 * without waiting for the interval) and release the background refresh timer on
 * teardown. Wired into `Realtime.close()`.
 */
export interface RealtimeObservabilityHandle {
  /** Recompute and set the exported gauges from current live state (Req 17.2). */
  refresh(): void;
  /** Stop the background refresh timer and release resources. */
  close(): void;
}

/**
 * Register the realtime health check and connection/member-count metrics with
 * the provided core observability registries (Req 17.1, 17.2, 17.4).
 *
 * - **Health check (Req 17.1, 17.4).** When a `health` registry is provided, a
 *   check named {@link REALTIME_HEALTH_CHECK_NAME} is registered that maps the
 *   cluster adapter's `health()` — `up`/`down` — onto a `CheckResult` reported
 *   through the existing `/health/*` routes. For the `RedisAdapter` this
 *   surfaces broker connectivity (Req 17.4); the default `MemoryAdapter` is
 *   always `up`. The current connection count is attached to the check details.
 * - **Metrics (Req 17.2).** When a `metrics` registry is provided, a
 *   connection-count gauge ({@link REALTIME_CONNECTIONS_METRIC}) and a per-Room
 *   member-count gauge ({@link REALTIME_ROOM_MEMBERS_METRIC}, labelled `room`)
 *   are registered and refreshed immediately and then on a background interval.
 *   Rooms that empty out are set back to `0` so a stale non-zero value never
 *   lingers.
 *
 * Registering against a registry that already holds the metric/check (for
 * example a second facade over the same registry) reuses the existing metric
 * rather than throwing. When neither registry is provided the returned handle
 * is an inert no-op.
 */
export function registerRealtimeObservability(
  deps: RealtimeObservabilityDeps,
): RealtimeObservabilityHandle {
  const { hub, adapter, server, health, metrics } = deps;

  // ── Health check (Req 17.1, 17.4) ───────────────────────────────────────────
  // The adapter's connectivity drives the subsystem status. The MemoryAdapter is
  // always `up`; a configured RedisAdapter reports `down` on broker connection
  // loss (Req 17.4). Attach the live connection count for operator visibility.
  if (health) {
    health.addCheck(REALTIME_HEALTH_CHECK_NAME, async (): Promise<CheckResult> => {
      const adapterHealth = adapter.health();
      const details: Record<string, unknown> = { adapter: adapterHealth.status };
      if (adapterHealth.details) details['adapterDetails'] = adapterHealth.details;
      if (server) details['connections'] = server.connectionCount;
      return { status: adapterHealth.status, details };
    });
  }

  // ── Metrics (Req 17.2) ───────────────────────────────────────────────────────
  // No metrics registry ⇒ nothing to export; return an inert handle so callers
  // (and Realtime.close) can treat observability uniformly.
  if (!metrics) {
    return { refresh: () => {}, close: () => {} };
  }

  const connectionsGauge = metrics.has(REALTIME_CONNECTIONS_METRIC)
    ? (metrics.get(REALTIME_CONNECTIONS_METRIC) as Gauge)
    : metrics.gauge(REALTIME_CONNECTIONS_METRIC, REALTIME_CONNECTIONS_HELP);

  const roomMembersGauge = metrics.has(REALTIME_ROOM_MEMBERS_METRIC)
    ? (metrics.get(REALTIME_ROOM_MEMBERS_METRIC) as Gauge)
    : metrics.gauge(REALTIME_ROOM_MEMBERS_METRIC, REALTIME_ROOM_MEMBERS_HELP, ['room']);

  // Rooms seen on a previous refresh, so a room that empties (and thus drops off
  // `hub.channelNames()`) can be zeroed instead of retaining a stale count.
  const knownRooms = new Set<string>();

  const refresh = (): void => {
    if (server) connectionsGauge.set(server.connectionCount);
    const active = new Set<string>();
    for (const room of hub.channelNames()) {
      active.add(room);
      knownRooms.add(room);
      roomMembersGauge.set(hub.memberCount(room), { room });
    }
    // Zero out rooms that are no longer active so the gauge does not report a
    // stale non-zero member count for an emptied Room.
    for (const room of knownRooms) {
      if (!active.has(room)) roomMembersGauge.set(0, { room });
    }
  };

  // Prime the gauges immediately so the first scrape reflects live state, then
  // keep them fresh on an unref'd interval (mirrors the core Prometheus
  // middleware's background heap-gauge refresh) so the timer never keeps the
  // process alive.
  refresh();
  const intervalMs = deps.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const timer = setInterval(refresh, intervalMs);
  timer.unref();

  return {
    refresh,
    close: () => clearInterval(timer),
  };
}
