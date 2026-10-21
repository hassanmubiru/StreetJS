// src/cloud/runtime.ts
// Cloud-native runtime helpers: graceful shutdown hook, service-mesh detection,
// and Kubernetes External Metrics API autoscale endpoint.

import type { StreetApp } from '../http/server.js';
import type { TelemetryTracker } from '../telemetry/tracker.js';

// ── Graceful shutdown ─────────────────────────────────────────────────────────

export interface Closeable {
  close(): Promise<void> | void;
}

export interface ShutdownHookOptions {
  /** Grace period before forced exit (ms). Default 30_000. */
  graceMs?: number;
  /** Resources to close in order after the HTTP listener stops. */
  closeables?: Closeable[];
  /** Called after all closeables are closed, before process.exit. */
  onShutdown?: () => Promise<void> | void;
  /** Override the exit function (testing). */
  exit?: (code: number) => void;
}

/**
 * Register SIGTERM/SIGINT handlers that drain the HTTP server, close the
 * provided resources (DB pools, etc.), then exit cleanly. If the grace period
 * elapses first, the process is force-exited.
 *
 * Returns a disposer that removes the signal listeners (useful in tests).
 */
export function registerShutdownHook(app: StreetApp, opts: ShutdownHookOptions = {}): () => void {
  const graceMs = opts.graceMs ?? 30_000;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    let force!: NodeJS.Timeout;
    const shutdownWork = (async (): Promise<'success' | 'failure'> => {
      try {
        await app.close();
        for (const c of opts.closeables ?? []) {
          await c.close();
        }
        if (opts.onShutdown) await opts.onShutdown();
        return 'success';
      } catch {
        return 'failure';
      }
    })();
    const timeout = new Promise<'timeout'>((resolve) => {
      force = setTimeout(() => {
        exit(1);
        resolve('timeout');
      }, graceMs);
      force.unref();
    });

    const result = await Promise.race([shutdownWork, timeout]);
    clearTimeout(force);
    if (result === 'success') exit(0);
    else if (result === 'failure') exit(1);
  };

  const onTerm = (): void => { void shutdown('SIGTERM'); };
  const onInt = (): void => { void shutdown('SIGINT'); };
  process.once('SIGTERM', onTerm);
  process.once('SIGINT', onInt);

  return () => {
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGINT', onInt);
  };
}

// ── Service-mesh detection ────────────────────────────────────────────────────

/**
 * Detect whether the process is running inside an Istio or Linkerd mesh by
 * inspecting well-known injected environment variables.
 */
export function isRunningInServiceMesh(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env['ISTIO_META_MESH_ID']) || Boolean(env['LINKERD_PROXY_INJECTION_ENABLED']);
}

// ── Autoscale metrics ─────────────────────────────────────────────────────────

/** A single metric value in the Kubernetes External Metrics API shape. */
export interface ExternalMetricValue {
  metricName: string;
  value: string;
}

/** Kubernetes External Metrics API response envelope. */
export interface AutoscaleMetrics {
  kind: 'ExternalMetricValueList';
  apiVersion: 'external.metrics.k8s.io/v1beta1';
  items: ExternalMetricValue[];
}

export interface AutoscaleSource {
  telemetry?: TelemetryTracker;
  /** Returns the current number of active connections. */
  activeConnections?: () => number;
  /** Returns the current background queue depth. */
  queueDepth?: () => number;
}

/**
 * Build a Kubernetes External Metrics API payload from runtime sources.
 * `requestsPerSecond` is derived from the telemetry request counter delta.
 */
export function buildAutoscaleMetrics(source: AutoscaleSource, windowSeconds = 60): AutoscaleMetrics {
  let rps = 0;
  if (source.telemetry) {
    const snap = source.telemetry.snapshot();
    rps = windowSeconds > 0 ? snap.requestCount / windowSeconds : snap.requestCount;
  }
  const items: ExternalMetricValue[] = [
    { metricName: 'http_requests_per_second', value: String(Math.round(rps * 100) / 100) },
    { metricName: 'active_connections', value: String(source.activeConnections?.() ?? 0) },
    { metricName: 'queue_depth', value: String(source.queueDepth?.() ?? 0) },
  ];
  return { kind: 'ExternalMetricValueList', apiVersion: 'external.metrics.k8s.io/v1beta1', items };
}

/**
 * Register `GET /metrics/autoscale` on the app, returning the External Metrics
 * API payload as JSON.
 */
export function registerAutoscaleRoute(app: StreetApp, source: AutoscaleSource, windowSeconds = 60): void {
  app.use(async (ctx, next) => {
    if (ctx.method === 'GET' && ctx.path === '/metrics/autoscale') {
      ctx.json(buildAutoscaleMetrics(source, windowSeconds));
      return;
    }
    await next();
  });
}
