// src/telemetry/tracker.ts
//
// The telemetry tracker now lives in the standalone @streetjs/telemetry package
// (single source of truth). This module re-exports it so the `streetjs/telemetry`
// subpath and all internal imports keep working unchanged — dependency
// inversion, not duplication. The framework-specific request-timing middleware
// stays here because it depends on the core request context.

import type { TelemetryTracker } from '@streetjs/telemetry';

export { TelemetryTracker } from '@streetjs/telemetry';
export type { TelemetrySample } from '@streetjs/telemetry';

/** Request timing middleware factory. */
export function telemetryMiddleware(tracker: TelemetryTracker) {
  return async (
    _ctx: import('../core/context.js').StreetContext,
    next: () => Promise<void>,
  ): Promise<void> => {
    const start = process.hrtime.bigint();
    let isError = false;
    try {
      await next();
    } catch (err) {
      isError = true;
      throw err;
    } finally {
      const elapsed = process.hrtime.bigint() - start;
      tracker.recordRequest(elapsed, isError);
    }
  };
}
