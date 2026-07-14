/**
 * The metrics registry: holds metrics and renders the exposition format.
 *
 * Depends on `types` and `render`.
 */

import type { Collectable, MetricSnapshot, Registry } from './types.js';
import { CONTENT_TYPE, renderSnapshot } from './render.js';

export class MetricsRegistry implements Registry {
  private readonly metrics = new Map<string, Collectable>();

  readonly contentType = CONTENT_TYPE;

  register(metric: Collectable): void {
    if (this.metrics.has(metric.name)) {
      throw new Error(`A metric named ${JSON.stringify(metric.name)} is already registered`);
    }
    this.metrics.set(metric.name, metric);
  }

  unregister(name: string): boolean {
    return this.metrics.delete(name);
  }

  get(name: string): Collectable | undefined {
    return this.metrics.get(name);
  }

  get metricsList(): readonly Collectable[] {
    return [...this.metrics.values()];
  }

  collect(): readonly MetricSnapshot[] {
    return this.metricsList.map((metric) => metric.collect());
  }

  render(): string {
    const blocks = this.collect().map(renderSnapshot);
    // Exposition format is newline-delimited and ends with a trailing newline.
    return blocks.length > 0 ? blocks.join('\n') + '\n' : '';
  }

  clear(): void {
    this.metrics.clear();
  }
}

/**
 * A process-wide default registry, mirroring common Prometheus clients. Prefer
 * an explicit {@link MetricsRegistry} instance in libraries and tests; the
 * default is a convenience for applications.
 */
export const defaultRegistry: Registry = new MetricsRegistry();
