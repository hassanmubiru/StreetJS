/**
 * @streetjs/telemetry — the StreetJS in-process telemetry foundation.
 *
 * A metrics tracker with bounded ring-buffer retention: heap/RSS sampling,
 * request counters, and p50/p99 latency percentiles, plus a health snapshot.
 * Zero runtime dependencies. Public API only.
 *
 * ```ts
 * import { TelemetryTracker } from '@streetjs/telemetry';
 *
 * const telemetry = new TelemetryTracker();
 * telemetry.recordRequest(elapsedNs, isError);
 * telemetry.snapshot();   // { heapUsedMb, latencyP50, latencyP99, requestCount, ... }
 * telemetry.destroy();    // stop the background collector on shutdown
 * ```
 *
 * > This is the standalone home of the tracker that also backs the
 * > `streetjs/telemetry` subpath; the `streetjs` framework re-exports it (and
 * > adds a request-timing middleware), so there is a single implementation.
 */

export { TelemetryTracker, type TelemetrySample } from './tracker.js';

/**
 * Dependency-injection token for a {@link TelemetryTracker}. This package
 * depends on no container, so the token is a plain unique symbol.
 */
export const TELEMETRY_TRACKER: unique symbol = Symbol.for('@streetjs/telemetry:Tracker');
