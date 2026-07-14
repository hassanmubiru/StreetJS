/**
 * Optional default process metrics (memory, CPU, uptime).
 *
 * Metrics are pull-based: each registered collectable reads live process state
 * at render time, so there is no background timer to manage. The process source
 * is injectable for deterministic tests.
 *
 * Depends on `types` only.
 */

import type { Collectable, MetricType } from './types.js';

/** The subset of `process` the default metrics read. Injectable for tests. */
export interface ProcessSource {
  memoryUsage(): { rss: number; heapTotal: number; heapUsed: number; external: number };
  cpuUsage(): { user: number; system: number };
  uptime(): number;
  now(): number;
}

const nodeProcessSource: ProcessSource = {
  memoryUsage: () => process.memoryUsage(),
  cpuUsage: () => process.cpuUsage(),
  uptime: () => process.uptime(),
  now: () => Date.now(),
};

function reader(name: string, help: string, type: MetricType, read: () => number): Collectable {
  return {
    name,
    collect: () => ({
      name,
      help,
      type,
      samples: [{ name, labels: {}, value: read() }],
    }),
  };
}

export interface DefaultMetricsOptions {
  /** Override the process source (primarily for tests). */
  readonly source?: ProcessSource;
}

/**
 * Register the standard process metrics on `registry` and return the created
 * collectables (useful for scoped cleanup via `registry.unregister`).
 */
export function collectDefaultMetrics(
  registry: { register(metric: Collectable): void },
  options: DefaultMetricsOptions = {},
): readonly Collectable[] {
  const src = options.source ?? nodeProcessSource;
  const startTimeSeconds = src.now() / 1000 - src.uptime();

  const metrics: Collectable[] = [
    reader('process_resident_memory_bytes', 'Resident memory size in bytes.', 'gauge', () =>
      src.memoryUsage().rss,
    ),
    reader('nodejs_heap_size_total_bytes', 'Total V8 heap size in bytes.', 'gauge', () =>
      src.memoryUsage().heapTotal,
    ),
    reader('nodejs_heap_size_used_bytes', 'Used V8 heap size in bytes.', 'gauge', () =>
      src.memoryUsage().heapUsed,
    ),
    reader('nodejs_external_memory_bytes', 'V8 external memory in bytes.', 'gauge', () =>
      src.memoryUsage().external,
    ),
    reader(
      'process_cpu_seconds_total',
      'Total user and system CPU time spent in seconds.',
      'counter',
      () => {
        const cpu = src.cpuUsage();
        return (cpu.user + cpu.system) / 1e6;
      },
    ),
    reader(
      'process_start_time_seconds',
      'Start time of the process since unix epoch in seconds.',
      'gauge',
      () => startTimeSeconds,
    ),
    reader('process_uptime_seconds', 'Process uptime in seconds.', 'gauge', () => src.uptime()),
  ];

  for (const metric of metrics) {
    registry.register(metric);
  }
  return metrics;
}
