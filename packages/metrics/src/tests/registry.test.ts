import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MetricsRegistry, defaultRegistry } from '../registry.js';
import { Counter } from '../counter.js';
import { Gauge } from '../gauge.js';
import { Histogram } from '../histogram.js';
import { CONTENT_TYPE } from '../render.js';
import { METRICS_REGISTRY } from '../index.js';

test('register, get, unregister, and list', () => {
  const r = new MetricsRegistry();
  const c = new Counter({ name: 'a_total', help: 'a' });
  r.register(c);
  assert.equal(r.get('a_total'), c);
  assert.equal(r.metricsList.length, 1);
  assert.equal(r.unregister('a_total'), true);
  assert.equal(r.unregister('a_total'), false);
  assert.equal(r.get('a_total'), undefined);
});

test('duplicate registration throws', () => {
  const r = new MetricsRegistry();
  r.register(new Counter({ name: 'dup_total', help: 'd' }));
  assert.throws(() => r.register(new Counter({ name: 'dup_total', help: 'd' })), /already registered/);
});

test('render emits HELP, TYPE, and sample lines with a trailing newline', () => {
  const r = new MetricsRegistry();
  const c = new Counter({ name: 'http_requests_total', help: 'Total requests.', labelNames: ['method'] });
  r.register(c);
  c.inc({ method: 'GET' }, 2);
  const out = r.render();
  assert.match(out, /# HELP http_requests_total Total requests\./);
  assert.match(out, /# TYPE http_requests_total counter/);
  assert.match(out, /http_requests_total\{method="GET"\} 2/);
  assert.ok(out.endsWith('\n'));
});

test('render of an empty registry is an empty string', () => {
  assert.equal(new MetricsRegistry().render().length, 0);
});

test('histogram renders bucket/sum/count lines', () => {
  const r = new MetricsRegistry();
  const h = new Histogram({ name: 'lat', help: 'latency', buckets: [0.5, 1] });
  r.register(h);
  h.observe(0.3);
  const out = r.render();
  assert.match(out, /# TYPE lat histogram/);
  assert.match(out, /lat_bucket\{le="0.5"\} 1/);
  assert.match(out, /lat_bucket\{le="\+Inf"\} 1/);
  assert.match(out, /lat_sum 0.3/);
  assert.match(out, /lat_count 1/);
});

test('gauge is rendered with its type', () => {
  const r = new MetricsRegistry();
  const g = new Gauge({ name: 'temp', help: 'temperature' });
  r.register(g);
  g.set(21.5);
  assert.match(r.render(), /# TYPE temp gauge\ntemp 21.5/);
});

test('collect returns structured snapshots', () => {
  const r = new MetricsRegistry();
  r.register(new Counter({ name: 's_total', help: 's' }));
  const snaps = r.collect();
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].type, 'counter');
});

test('clear removes everything and exposes the content type', () => {
  const r = new MetricsRegistry();
  r.register(new Counter({ name: 'k_total', help: 'k' }));
  r.clear();
  assert.equal(r.metricsList.length, 0);
  assert.equal(r.contentType, CONTENT_TYPE);
});

test('a default registry and a DI token are exported', () => {
  assert.ok(defaultRegistry);
  assert.equal(typeof defaultRegistry.render, 'function');
  assert.equal(METRICS_REGISTRY, Symbol.for('@streetjs/metrics:Registry'));
});
