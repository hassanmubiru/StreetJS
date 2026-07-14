/**
 * Shared base for all metric types: name/label validation and per-series
 * bookkeeping keyed by a deterministic label key.
 *
 * Depends on `types` and `validation`.
 */

import type { Collectable, Labels, MetricOptions, MetricSnapshot, MetricType } from './types.js';
import { assertValidLabelName, assertValidMetricName, normalizeLabels, seriesKey } from './validation.js';

/** Resolved label information for a single call. */
export interface ResolvedSeries {
  /** Normalized (string) label values. */
  readonly labels: Record<string, string>;
  /** Deterministic key used to store/find the series. */
  readonly key: string;
}

export abstract class BaseMetric implements Collectable {
  readonly name: string;
  readonly help: string;
  readonly labelNames: readonly string[];

  abstract readonly type: MetricType;

  constructor(options: MetricOptions) {
    assertValidMetricName(options.name);
    if (typeof options.help !== 'string' || options.help.length === 0) {
      throw new Error(`Metric ${options.name} requires a non-empty help string`);
    }
    const labelNames = options.labelNames ?? [];
    for (const label of labelNames) {
      assertValidLabelName(label);
    }
    this.name = options.name;
    this.help = options.help;
    this.labelNames = [...labelNames];
  }

  /** Validate + normalize provided labels into a stored series descriptor. */
  protected resolve(labels: Labels = {}): ResolvedSeries {
    const normalized = normalizeLabels(this.labelNames, labels);
    return { labels: normalized, key: seriesKey(normalized) };
  }

  /**
   * Parse the `(labels?, value?)` / `(value?)` overload used by `inc`/`set`/
   * `observe` into a resolved series and numeric value.
   */
  protected parse(
    arg1: Labels | number | undefined,
    arg2: number | undefined,
    defaultValue: number,
  ): { series: ResolvedSeries; value: number } {
    if (typeof arg1 === 'number') {
      return { series: this.resolve({}), value: arg1 };
    }
    const series = this.resolve(arg1 ?? {});
    return { series, value: arg2 ?? defaultValue };
  }

  abstract collect(): MetricSnapshot;

  /** Discard all series. */
  abstract reset(): void;
}
