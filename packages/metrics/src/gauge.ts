/**
 * Gauge: a value that can go up or down (temperatures, queue depth, in-flight
 * requests, timestamps).
 *
 * Depends on `types` and `metric`.
 */

import type { Labels, MetricSnapshot, MetricTimer, Sample } from './types.js';
import { BaseMetric } from './metric.js';

interface Series {
  labels: Record<string, string>;
  value: number;
}

export class Gauge extends BaseMetric {
  readonly type = 'gauge' as const;
  private readonly series = new Map<string, Series>();
  private readonly now: () => number;

  /** `clock` returns epoch milliseconds; injectable for deterministic tests. */
  constructor(
    options: ConstructorParameters<typeof BaseMetric>[0],
    clock: () => number = Date.now,
  ) {
    super(options);
    this.now = clock;
  }

  private upsert(key: string, labels: Record<string, string>, mutate: (current: number) => number): void {
    const existing = this.series.get(key);
    if (existing) {
      existing.value = mutate(existing.value);
    } else {
      this.series.set(key, { labels, value: mutate(0) });
    }
  }

  /** Set the gauge to an exact value. */
  set(labelsOrValue: Labels | number, value?: number): void {
    const { series, value: v } = this.parse(labelsOrValue, value, 0);
    this.upsert(series.key, series.labels, () => v);
  }

  /** Increment (default `1`). */
  inc(labelsOrValue?: Labels | number, value?: number): void {
    const { series, value: v } = this.parse(labelsOrValue, value, 1);
    this.upsert(series.key, series.labels, (current) => current + v);
  }

  /** Decrement (default `1`). */
  dec(labelsOrValue?: Labels | number, value?: number): void {
    const { series, value: v } = this.parse(labelsOrValue, value, 1);
    this.upsert(series.key, series.labels, (current) => current - v);
  }

  /** Set the gauge to the current time in seconds. */
  setToCurrentTime(labels: Labels = {}): void {
    const series = this.resolve(labels);
    this.upsert(series.key, series.labels, () => this.now() / 1000);
  }

  /**
   * Start a timer; the returned function sets the gauge to the elapsed seconds
   * when called and returns that duration.
   */
  startTimer(labels: Labels = {}): MetricTimer {
    const start = this.now();
    const series = this.resolve(labels);
    return () => {
      const seconds = (this.now() - start) / 1000;
      this.upsert(series.key, series.labels, () => seconds);
      return seconds;
    };
  }

  /** Current value for a series (default the unlabeled series). */
  value(labels: Labels = {}): number {
    const { key } = this.resolve(labels);
    return this.series.get(key)?.value ?? 0;
  }

  reset(): void {
    this.series.clear();
  }

  collect(): MetricSnapshot {
    const samples: Sample[] = [];
    for (const series of this.series.values()) {
      samples.push({ name: this.name, labels: series.labels, value: series.value });
    }
    return { name: this.name, help: this.help, type: this.type, samples };
  }
}
