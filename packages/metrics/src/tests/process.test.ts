import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collectDefaultMetrics, type ProcessSource } from '../process.js';
import { MetricsRegistry } from '../registry.js';

function fakeSource(): ProcessSource {
  return {
    memoryUsage: () => ({ rss: 100, heapTotal: 80, heapUsed: 50, external: 10 }),
    cpuUsage: () => ({ user: 2_000_000, system: 1_000_000 }),
    uptime: () => 42,
    now: () => 1_000_000,
  };
}

test('registers the standard process metrics', () => {
  const r = new MetricsRegistry();
  const created = collectDefaultMetrics(r, { source: fakeSource() });
  const names = created.map((m) => m.name);
  assert.ok(names.includes('process_resident_memory_bytes'));
  assert.ok(names.includes('nodejs_heap_size_used_bytes'));
  assert.ok(names.includes('process_cpu_seconds_total'));
  assert.ok(names.includes('process_uptime_seconds'));
  assert.equal(r.metricsList.length, created.length);
});

test('metrics read live values from the source at render time', () => {
  const r = new MetricsRegistry();
  collectDefaultMetrics(r, { source: fakeSource() });
  const out = r.render();
  assert.match(out, /process_resident_memory_bytes 100/);
  assert.match(out, /nodejs_heap_size_used_bytes 50/);
  assert.match(out, /nodejs_external_memory_bytes 10/);
  // (2_000_000 + 1_000_000) / 1e6 = 3
  assert.match(out, /process_cpu_seconds_total 3/);
  assert.match(out, /process_uptime_seconds 42/);
  // start = now/1000 - uptime = 1000 - 42 = 958
  assert.match(out, /process_start_time_seconds 958/);
});

test('cpu metric is typed as a counter', () => {
  const r = new MetricsRegistry();
  collectDefaultMetrics(r, { source: fakeSource() });
  const out = r.render();
  assert.match(out, /# TYPE process_cpu_seconds_total counter/);
});

test('defaults fall back to the real process when no source is given', () => {
  const r = new MetricsRegistry();
  collectDefaultMetrics(r);
  const out = r.render();
  assert.match(out, /process_resident_memory_bytes \d/);
  assert.match(out, /process_uptime_seconds/);
});
