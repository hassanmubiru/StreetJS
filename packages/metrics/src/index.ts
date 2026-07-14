/**
 * @streetjs/metrics — the StreetJS metrics foundation.
 *
 * A Prometheus-compatible metrics library: Counter, Gauge, Histogram, a
 * Registry, the text exposition format, and optional default process metrics.
 * Zero runtime dependencies. Public API only.
 *
 * ```ts
 * import { MetricsRegistry, Counter, Histogram } from '@streetjs/metrics';
 *
 * const registry = new MetricsRegistry();
 * const requests = new Counter({
 *   name: 'http_requests_total',
 *   help: 'Total HTTP requests.',
 *   labelNames: ['method', 'status'],
 * });
 * registry.register(requests);
 * requests.inc({ method: 'GET', status: '200' });
 *
 * // Expose registry.render() with Content-Type registry.contentType.
 * ```
 */

export { Counter } from './counter.js';
export { Gauge } from './gauge.js';
export { Histogram, DEFAULT_BUCKETS } from './histogram.js';
export { MetricsRegistry, defaultRegistry } from './registry.js';
export { collectDefaultMetrics, type ProcessSource, type DefaultMetricsOptions } from './process.js';

export {
  CONTENT_TYPE,
  formatValue,
  escapeHelp,
  escapeLabelValue,
  renderSample,
  renderSnapshot,
} from './render.js';

export {
  assertValidMetricName,
  assertValidLabelName,
  normalizeLabels,
  seriesKey,
} from './validation.js';

export type {
  MetricType,
  Labels,
  MetricOptions,
  HistogramOptions,
  Sample,
  MetricSnapshot,
  Collectable,
  MetricTimer,
  Registry,
} from './types.js';

/**
 * Dependency-injection token for a {@link Registry}.
 *
 * `@streetjs/metrics` depends on no container, so the token is a plain unique
 * symbol. Register a `MetricsRegistry` under this token in your application's
 * container and resolve it wherever metrics are recorded or exposed.
 */
export const METRICS_REGISTRY: unique symbol = Symbol.for('@streetjs/metrics:Registry');
