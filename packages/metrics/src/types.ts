/**
 * Public types for @streetjs/metrics.
 *
 * Interface-first: metrics and the registry are described here as interfaces so
 * applications can substitute their own implementation and wire everything
 * through dependency injection.
 */

/** The three supported metric types (Prometheus-compatible). */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/** Label values for a single metric series. Values are coerced to strings. */
export type Labels = Record<string, string | number | boolean>;

/** Options shared by every metric. */
export interface MetricOptions {
  /** Metric name, e.g. `http_requests_total`. Must match Prometheus naming rules. */
  readonly name: string;
  /** Human-readable description emitted as `# HELP`. */
  readonly help: string;
  /** Declared label names. Every series must supply exactly these labels. */
  readonly labelNames?: readonly string[];
}

/** Options for a {@link Histogram}. */
export interface HistogramOptions extends MetricOptions {
  /** Upper bounds (`le`) for observation buckets. Sorted ascending; `+Inf` is implicit. */
  readonly buckets?: readonly number[];
}

/** A single exported measurement. */
export interface Sample {
  /** Sample metric name (may differ from the parent, e.g. `_bucket`, `_sum`, `_count`). */
  readonly name: string;
  /** Label values for this sample (including synthetic labels like `le`). */
  readonly labels: Readonly<Record<string, string>>;
  /** Numeric value. */
  readonly value: number;
}

/** The result of collecting one metric: metadata plus its current samples. */
export interface MetricSnapshot {
  readonly name: string;
  readonly help: string;
  readonly type: MetricType;
  readonly samples: readonly Sample[];
}

/** Anything the registry can collect. Every metric implements this. */
export interface Collectable {
  readonly name: string;
  /** Produce the current samples for this metric. */
  collect(): MetricSnapshot;
}

/** A stoppable duration timer that records elapsed seconds when finished. */
export interface MetricTimer {
  /** Record the elapsed time (seconds) into the originating metric. Returns the value. */
  (): number;
}

/** A collection of registered metrics that renders the exposition format. */
export interface Registry {
  /** Register a metric. Throws on a duplicate name. */
  register(metric: Collectable): void;
  /** Remove a metric by name. Returns `true` if one was removed. */
  unregister(name: string): boolean;
  /** Look up a registered metric by name. */
  get(name: string): Collectable | undefined;
  /** All registered metrics. */
  readonly metricsList: readonly Collectable[];
  /** Render the Prometheus text exposition format. */
  render(): string;
  /** Structured snapshots of every registered metric. */
  collect(): readonly MetricSnapshot[];
  /** The exposition content type, suitable for an HTTP `Content-Type` header. */
  readonly contentType: string;
  /** Remove every registered metric. */
  clear(): void;
}
