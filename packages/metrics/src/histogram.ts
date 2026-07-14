/**
 * Histogram: samples observations into cumulative buckets and tracks sum/count.
 * The standard choice for latencies and sizes.
 *
 * Depends on `types` and `metric`.
 */

import type { HistogramOptions, Labels, MetricSnapshot, MetricTimer, Sample } from './types.js';
import { BaseMetric } from './metric.js';

/** Default latency-oriented buckets (seconds), matching common Prometheus clients. */
export const DEFAULT_BUCKETS: readonly number[] = Object.freeze([
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]);

interface Series {
  labels: Record<string, string>;
  counts: number[];
  sum: number;
  count: number;
}

function validateBuckets(buckets: readonly number[]): number[] {
  if (buckets.length === 0) {
    throw new Error('Histogram requires at least one bucket');
  }
  const out = [...buckets];
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) {
      throw new Error('Histogram bucket bounds must be finite numbers (+Inf is implicit)');
    }
    if (i > 0 && out[i] <= out[i - 1]) {
      throw new Error('Histogram buckets must be strictly increasing');
    }
  }
  return out;
}

export class Histogram extends BaseMetric {
  readonly type = 'histogram' as const;
  readonly buckets: readonly number[];
  private readonly series = new Map<string, Series>();
  private readonly now: () => number;

  constructor(options: HistogramOptions, clock: () => number = Date.now) {
    super(options);
    if (options.labelNames?.includes('le')) {
      throw new Error(`Histogram ${options.name} may not use the reserved label "le"`);
    }
    this.buckets = validateBuckets(options.buckets ?? DEFAULT_BUCKETS);
    this.now = clock;
  }

  /**
   * Record an observation.
   *
   * @param labelsOrValue label values, or the observed value for unlabeled metrics.
   * @param value the observed value when labels are given.
   */
  observe(labelsOrValue: Labels | number, value?: number): void {
    let observed: number;
    let labels: Labels;
    if (typeof labelsOrValue === 'number') {
      observed = labelsOrValue;
      labels = {};
    } else {
      labels = labelsOrValue;
      if (typeof value !== 'number') {
        throw new Error(`Histogram ${this.name}: observe() requires a numeric value`);
      }
      observed = value;
    }
    if (!Number.isFinite(observed)) {
      throw new Error(`Histogram ${this.name}: cannot observe a non-finite value`);
    }

    const series = this.resolve(labels);
    let entry = this.series.get(series.key);
    if (!entry) {
      entry = {
        labels: series.labels,
        counts: new Array(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.series.set(series.key, entry);
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (observed <= this.buckets[i]) {
        entry.counts[i]++;
      }
    }
    entry.sum += observed;
    entry.count++;
  }

  /**
   * Start a timer; the returned function observes the elapsed seconds when
   * called and returns that duration.
   */
  startTimer(labels: Labels = {}): MetricTimer {
    const start = this.now();
    return () => {
      const seconds = (this.now() - start) / 1000;
      this.observe(labels, seconds);
      return seconds;
    };
  }

  reset(): void {
    this.series.clear();
  }

  collect(): MetricSnapshot {
    const samples: Sample[] = [];
    for (const entry of this.series.values()) {
      for (let i = 0; i < this.buckets.length; i++) {
        samples.push({
          name: `${this.name}_bucket`,
          labels: { ...entry.labels, le: String(this.buckets[i]) },
          value: entry.counts[i],
        });
      }
      samples.push({
        name: `${this.name}_bucket`,
        labels: { ...entry.labels, le: '+Inf' },
        value: entry.count,
      });
      samples.push({ name: `${this.name}_sum`, labels: entry.labels, value: entry.sum });
      samples.push({ name: `${this.name}_count`, labels: entry.labels, value: entry.count });
    }
    return { name: this.name, help: this.help, type: this.type, samples };
  }
}
