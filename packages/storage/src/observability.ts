// src/observability.ts
// @streetjs/storage — health check + metrics wiring over the reused core
// `HealthCheckRegistry` and `MetricsRegistry`.
//
// Following the events package's `observability.ts` pattern, this module
// exposes a single entry point, `registerStorageObservability`, that returns a
// handle with:
//
//   1. a `telemetry` sink the facade feeds live as operations occur — it drives
//      the upload / download / bytes / failed-upload counters, the active-uploads
//      and storage-usage gauges, the operation-latency histogram, and the
//      multipart / resumable counters (Requirement 23.2);
//   2. an `attach(storage)` method that registers the `storage` health check
//      against the `HealthCheckRegistry`, sourced from `storage.probe()` for
//      provider connectivity, writability, readability, and quota availability
//      (Requirement 23.3), and primes the gauges from `storage.stats()`.
//
// Everything is opt-in: with no `metrics` registry the telemetry is inert; with
// no `health` registry no check is registered. Registration is idempotent
// against a shared registry (reuses an existing metric rather than throwing —
// `reg.has(name) ? reg.get(name) : reg.counter(...)`), so several storage
// instances can share one registry (Requirement 23.1).
//
// Only the existing core primitives (`MetricsRegistry`, `HealthCheckRegistry`)
// are reused; no separate metrics / health / scheduling / retry / event system
// is introduced (Requirement 23.4).

import type {
  HealthCheckRegistry,
  MetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  CheckResult,
} from "streetjs";

import type { StorageStats, DriverProbe } from "./types.js";

/**
 * The introspection slice of a {@link Storage} facade the observability layer
 * reads: a synchronous stats snapshot and the best-effort driver probe.
 */
export interface StorageIntrospect {
  stats(): StorageStats;
  probe(): Promise<DriverProbe>;
}

/** The name the storage health check is registered under. */
export const STORAGE_HEALTH_CHECK_NAME = "storage";

export const STORAGE_UPLOADS_METRIC = "storage_uploads_total";
export const STORAGE_DOWNLOADS_METRIC = "storage_downloads_total";
export const STORAGE_BYTES_UPLOADED_METRIC = "storage_bytes_uploaded_total";
export const STORAGE_BYTES_DOWNLOADED_METRIC = "storage_bytes_downloaded_total";
export const STORAGE_ACTIVE_UPLOADS_METRIC = "storage_active_uploads";
export const STORAGE_FAILED_UPLOADS_METRIC = "storage_failed_uploads_total";
export const STORAGE_USAGE_METRIC = "storage_usage_bytes";
export const STORAGE_LATENCY_METRIC = "storage_operation_latency_seconds";
export const STORAGE_MULTIPART_METRIC = "storage_multipart_uploads_total";
export const STORAGE_RESUMABLE_METRIC = "storage_resumable_sessions_total";

const DEFAULT_REFRESH_INTERVAL_MS = 5_000;

/**
 * The live telemetry sink the facade feeds as operations occur. Every hook is
 * optional so an inert sink (no metrics registry) is a complete no-op. All
 * hooks are isolated by the facade so observability never destabilizes an
 * operation.
 */
export interface StorageTelemetry {
  /** A successful upload persisted `bytes` in `latencySeconds`. */
  onUpload?(bytes: number, latencySeconds: number): void;
  /** A successful download returned `bytes` in `latencySeconds`. */
  onDownload?(bytes: number, latencySeconds: number): void;
  /** An upload failed (validation, authorization, or driver error). */
  onUploadFailed?(): void;
  /** The number of in-flight (streamed/resumable) uploads changed. */
  onActiveUploadsChange?(active: number): void;
  /** The tracked storage usage (bytes) changed. */
  onStorageUsage?(bytes: number): void;
  /** A multipart upload was created. */
  onMultipartUpload?(): void;
  /** A resumable upload session was started. */
  onResumableSession?(): void;
}

/** Options for {@link registerStorageObservability}. */
export interface StorageObservabilityOptions {
  /** Registry the `storage` health check is registered with (Req 23.3). */
  health?: HealthCheckRegistry;
  /** Registry the storage metrics are exported through (Req 23.1, 23.2). */
  metrics?: MetricsRegistry;
  /** Refresh cadence for gauges when `autoRefresh` is enabled. */
  refreshIntervalMs?: number;
  /**
   * When `true`, an unref'd interval keeps the gauges primed. Default `false`
   * (pull-based: the caller drives {@link StorageObservabilityHandle.refresh}).
   */
  autoRefresh?: boolean;
}

/** Handle returned by {@link registerStorageObservability}. */
export interface StorageObservabilityHandle {
  /**
   * The telemetry sink the facade feeds live. Drives the counters, gauges, and
   * latency histogram as operations occur.
   */
  readonly telemetry: StorageTelemetry;
  /**
   * Register the `storage` health check against the created facade and prime the
   * gauges from `storage.stats()`. Call once after `createStorage`.
   */
  attach(storage: StorageIntrospect): void;
  /** Recompute the gauges from `storage.stats()` (best-effort; never throws). */
  refresh(): void;
  /** Stop any refresh timer and release resources. Safe to call once. */
  close(): void;
}

/** An inert telemetry sink used when no metrics registry is provided. */
const NOOP_TELEMETRY: StorageTelemetry = {};

/**
 * Register storage observability. Returns a {@link StorageObservabilityHandle}
 * whose `telemetry` the facade feeds live and whose `attach` wires the health
 * check + primes the gauges from the created facade.
 */
export function registerStorageObservability(
  options: StorageObservabilityOptions = {},
): StorageObservabilityHandle {
  const { metrics, health } = options;

  let storage: StorageIntrospect | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  // ── Metrics (idempotent registration) ─────────────────────────────────────
  let uploadsCounter: Counter | undefined;
  let downloadsCounter: Counter | undefined;
  let bytesUploadedCounter: Counter | undefined;
  let bytesDownloadedCounter: Counter | undefined;
  let failedUploadsCounter: Counter | undefined;
  let multipartCounter: Counter | undefined;
  let resumableCounter: Counter | undefined;
  let activeUploadsGauge: Gauge | undefined;
  let usageGauge: Gauge | undefined;
  let latencyHistogram: Histogram | undefined;

  if (metrics) {
    uploadsCounter = counter(metrics, STORAGE_UPLOADS_METRIC, "Total objects uploaded.");
    downloadsCounter = counter(metrics, STORAGE_DOWNLOADS_METRIC, "Total objects downloaded.");
    bytesUploadedCounter = counter(
      metrics,
      STORAGE_BYTES_UPLOADED_METRIC,
      "Total bytes uploaded.",
    );
    bytesDownloadedCounter = counter(
      metrics,
      STORAGE_BYTES_DOWNLOADED_METRIC,
      "Total bytes downloaded.",
    );
    failedUploadsCounter = counter(
      metrics,
      STORAGE_FAILED_UPLOADS_METRIC,
      "Total failed uploads.",
    );
    multipartCounter = counter(
      metrics,
      STORAGE_MULTIPART_METRIC,
      "Total multipart uploads created.",
    );
    resumableCounter = counter(
      metrics,
      STORAGE_RESUMABLE_METRIC,
      "Total resumable upload sessions started.",
    );
    activeUploadsGauge = gauge(
      metrics,
      STORAGE_ACTIVE_UPLOADS_METRIC,
      "Uploads currently in flight.",
    );
    usageGauge = gauge(metrics, STORAGE_USAGE_METRIC, "Tracked storage usage in bytes.");
    latencyHistogram = histogram(
      metrics,
      STORAGE_LATENCY_METRIC,
      "Storage operation latency in seconds.",
    );
  }

  const telemetry: StorageTelemetry = metrics
    ? {
        onUpload: (bytes, latencySeconds) =>
          safe(() => {
            uploadsCounter?.inc();
            bytesUploadedCounter?.inc({}, bytes);
            latencyHistogram?.observe(latencySeconds);
          }),
        onDownload: (bytes, latencySeconds) =>
          safe(() => {
            downloadsCounter?.inc();
            bytesDownloadedCounter?.inc({}, bytes);
            latencyHistogram?.observe(latencySeconds);
          }),
        onUploadFailed: () => safe(() => failedUploadsCounter?.inc()),
        onActiveUploadsChange: (active) => safe(() => activeUploadsGauge?.set(active)),
        onStorageUsage: (bytes) => safe(() => usageGauge?.set(bytes)),
        onMultipartUpload: () => safe(() => multipartCounter?.inc()),
        onResumableSession: () => safe(() => resumableCounter?.inc()),
      }
    : NOOP_TELEMETRY;

  const refresh = (): void => {
    if (!storage) {
      return;
    }
    safe(() => {
      const stats: StorageStats = storage!.stats();
      activeUploadsGauge?.set(stats.activeUploads);
      usageGauge?.set(stats.storageUsage);
    });
  };

  const attach = (created: StorageIntrospect): void => {
    storage = created;

    if (health) {
      health.addCheck(STORAGE_HEALTH_CHECK_NAME, async (): Promise<CheckResult> => {
        try {
          const probe = await created.probe();
          // The provider is healthy only when it is reachable and all of the
          // connectivity/writability/readability/quota dimensions hold
          // (Requirement 23.3).
          const status: "up" | "down" =
            probe.connectivity && probe.writable && probe.readable && probe.quotaAvailable
              ? "up"
              : "down";
          return {
            status,
            details: {
              connectivity: probe.connectivity,
              writable: probe.writable,
              readable: probe.readable,
              quotaAvailable: probe.quotaAvailable,
            },
          };
        } catch (err) {
          return {
            status: "down",
            details: { error: err instanceof Error ? err.message : String(err) },
          };
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
    // Observability must never destabilize a storage operation or a scrape.
  }
}
