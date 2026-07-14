/**
 * Counter: a monotonically increasing value that resets only on restart (or an
 * explicit `reset()`).
 *
 * Depends on `types` and `metric`.
 */

import type { Labels, MetricSnapshot, Sample } from './types.js';
import { BaseMetric } from './metric.js';

interface Series {
  labels: Record<string, string>;
  value: number;
}

export class Counter extends BaseMetric {
  readonly type = 'counter' as const;
  private readonly series = new Map<string, Series>();

  /**
   * Increment the counter.
   *
   * @param labelsOrValue label values (labeled metrics) or the increment amount
   *   (unlabeled metrics).
   * @param value increment amount when labels are given (default `1`).
   * @throws when the amount is negative.
   */
  inc(labelsOrValue?: Labels | number, value?: number): void {
    const { series, value: amount } = this.parse(labelsOrValue, value, 1);
    if (amount < 0) {
      throw new Error(`Counter ${this.name} cannot be incremented by a negative amount`);
    }
    const existing = this.series.get(series.key);
    if (existing) {
      existing.value += amount;
    } else {
      this.series.set(series.key, { labels: series.labels, value: amount });
    }
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
