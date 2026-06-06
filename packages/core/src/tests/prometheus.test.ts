// src/tests/prometheus.test.ts
// Unit tests for MetricsRegistry, Counter, Gauge, Histogram, prometheusMiddleware,
// metricsHandler and MetricConflictError (tasks 13.1–13.8).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';

import {
  MetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  MetricConflictError,
  prometheusMiddleware,
  metricsHandler,
  registerMetricsRoute,
  PROMETHEUS_CONTENT_TYPE,
} from '../observability/prometheus.js';
import { streetApp } from '../http/server.js';
import type { StreetContext } from '../core/context.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let testPort = 54300;
function nextPort(): number { return testPort++; }

function httpGet(
  port: number,
  path: string,
): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            contentType: res.headers['content-type'] ?? '',
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}


/** Minimal StreetContext for middleware tests. */
function makeCtx(opts: {
  method?: string;
  path?: string;
  statusCode?: number;
} = {}): StreetContext {
  const statusCode = opts.statusCode ?? 200;
  const sentHeaders: Record<string, string> = {};
  let bodyText = '';
  let sentStatus = 0;

  return {
    req: {} as StreetContext['req'],
    res: {
      statusCode,
      writableEnded: false,
      setHeader(name: string, value: string) { sentHeaders[name] = value; },
      writeHead(status: number, headers?: Record<string, string>) {
        sentStatus = status;
        if (headers) {
          for (const [k, v] of Object.entries(headers)) sentHeaders[k] = v;
        }
        return this;
      },
      end(data?: string) {
        if (typeof data === 'string') bodyText = data;
        (this as { writableEnded: boolean }).writableEnded = true;
      },
    } as unknown as StreetContext['res'],
    path: opts.path ?? '/test',
    method: opts.method ?? 'GET',
    params: {},
    query: {},
    headers: {},
    body: null,
    files: [],
    state: {},
    user: null,
    startTime: process.hrtime.bigint(),
    sent: false,
    json: () => undefined,
    text: (data: string, status = 200) => { bodyText = data; sentStatus = status; },
    html: () => undefined,
    send: () => undefined,
    setHeader: (name: string, value: string) => { sentHeaders[name] = value; },
    cookie: () => undefined,
    setCookie: () => undefined,
    _body: () => bodyText,
    _status: () => sentStatus,
    _headers: () => sentHeaders,
  } as unknown as StreetContext;
}

// ── 13.1 — Classes exist ─────────────────────────────────────────────────────

describe('MetricsRegistry / Counter / Gauge / Histogram (13.1)', () => {
  it('MetricsRegistry can create counter, gauge, histogram', () => {
    const registry = new MetricsRegistry();
    const c = registry.counter('test_counter', 'A counter');
    const g = registry.gauge('test_gauge', 'A gauge');
    const h = registry.histogram('test_hist', 'A histogram');
    assert.ok(c instanceof Counter);
    assert.ok(g instanceof Gauge);
    assert.ok(h instanceof Histogram);
  });

  it('MetricConflictError is an instance of Error', () => {
    const err = new MetricConflictError('foo');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof MetricConflictError);
    assert.ok(err.message.includes('foo'));
  });
});

// ── 13.2 — Synchronous operations ────────────────────────────────────────────

describe('Counter.inc (13.2)', () => {
  it('increments by 1 by default', () => {
    const c = new Counter('c', 'help');
    c.inc();
    c.inc();
    const output = c.render();
    assert.ok(output.includes('c 2'), `expected "c 2", got:\n${output}`);
  });

  it('increments by custom value', () => {
    const c = new Counter('reqs', 'help', ['method']);
    c.inc({ method: 'GET' }, 5);
    const output = c.render();
    assert.ok(output.includes('5'), output);
  });

  it('accumulates across multiple label sets', () => {
    const c = new Counter('http_reqs', 'help', ['method']);
    c.inc({ method: 'GET' });
    c.inc({ method: 'GET' });
    c.inc({ method: 'POST' });
    const output = c.render();
    assert.ok(output.includes('"GET"'), output);
    assert.ok(output.includes('"POST"'), output);
  });
});

describe('Gauge.set (13.2)', () => {
  it('sets a value', () => {
    const g = new Gauge('heap', 'help');
    g.set(1024);
    const output = g.render();
    assert.ok(output.includes('heap 1024'), output);
  });

  it('overrides previous value', () => {
    const g = new Gauge('heap', 'help');
    g.set(100);
    g.set(200);
    const output = g.render();
    assert.ok(output.includes('heap 200'), output);
    assert.ok(!output.includes('heap 100'), output);
  });
});

describe('Histogram.observe (13.2)', () => {
  it('records observations into buckets', () => {
    const h = new Histogram('dur', 'help', [0.1, 0.5, 1]);
    h.observe(0.05);
    h.observe(0.3);
    h.observe(0.8);
    const output = h.render();
    // 0.05 fits in 0.1 bucket, 0.3 in 0.5, 0.8 in 1
    assert.ok(output.includes('_count'), output);
    assert.ok(output.includes('_sum'), output);
  });

  it('tracks sum correctly', () => {
    const h = new Histogram('dur', 'help', [1, 2, 5]);
    h.observe(0.5);
    h.observe(1.5);
    const output = h.render();
    // sum should be 2.0
    assert.ok(output.includes('dur_sum'), output);
    assert.ok(output.includes(' 2'), output);
  });
});

// ── 13.3 — Prometheus text format ────────────────────────────────────────────

describe('MetricsRegistry.collect() — Prometheus text format (13.3)', () => {
  it('emits # HELP and # TYPE lines for each metric', () => {
    const registry = new MetricsRegistry();
    registry.counter('http_requests_total', 'Total requests');
    const output = registry.collect();
    assert.ok(output.includes('# HELP http_requests_total Total requests'), output);
    assert.ok(output.includes('# TYPE http_requests_total counter'), output);
  });

  it('emits correct label encoding', () => {
    const registry = new MetricsRegistry();
    const c = registry.counter('reqs', 'help', ['method', 'route']);
    c.inc({ method: 'GET', route: '/api' }, 42);
    const output = registry.collect();
    assert.ok(output.includes('"GET"'), output);
    assert.ok(output.includes('"api"') || output.includes('"/api"'), output);
    assert.ok(output.includes('42'), output);
  });

  it('emits histogram with _bucket, _sum, _count lines', () => {
    const registry = new MetricsRegistry();
    const h = registry.histogram('req_dur', 'Duration', [0.1, 0.5]);
    h.observe(0.05);
    const output = registry.collect();
    assert.ok(output.includes('req_dur_bucket'), output);
    assert.ok(output.includes('req_dur_sum'), output);
    assert.ok(output.includes('req_dur_count'), output);
    assert.ok(output.includes('+Inf'), output);
  });

  it('emits all metrics separated by newlines', () => {
    const registry = new MetricsRegistry();
    registry.counter('a', 'help a');
    registry.gauge('b', 'help b');
    const output = registry.collect();
    assert.ok(output.includes('# HELP a'), output);
    assert.ok(output.includes('# HELP b'), output);
  });
});

// ── 13.5 — Conflict detection ─────────────────────────────────────────────────

describe('MetricConflictError (13.5)', () => {
  it('throws MetricConflictError when registering duplicate counter', () => {
    const registry = new MetricsRegistry();
    registry.counter('dup', 'help');
    assert.throws(
      () => registry.counter('dup', 'help'),
      (err: unknown) => {
        assert.ok(err instanceof MetricConflictError);
        assert.ok((err as Error).message.includes('dup'));
        return true;
      },
    );
  });

  it('throws MetricConflictError when registering gauge with same name as counter', () => {
    const registry = new MetricsRegistry();
    registry.counter('shared_name', 'help');
    assert.throws(
      () => registry.gauge('shared_name', 'help'),
      (err: unknown) => {
        assert.ok(err instanceof MetricConflictError);
        return true;
      },
    );
  });

  it('throws MetricConflictError when registering duplicate histogram', () => {
    const registry = new MetricsRegistry();
    registry.histogram('hist', 'help');
    assert.throws(
      () => registry.histogram('hist', 'help'),
      (err: unknown) => {
        assert.ok(err instanceof MetricConflictError);
        return true;
      },
    );
  });
});

// ── 13.4 / 13.8 — prometheusMiddleware default metrics ───────────────────────

describe('prometheusMiddleware (13.4 / 13.8)', () => {
  it('registers http_requests_total, http_request_duration_seconds, process_heap_bytes', () => {
    const registry = new MetricsRegistry();
    prometheusMiddleware(registry);
    const output = registry.collect();
    assert.ok(output.includes('http_requests_total'), output);
    assert.ok(output.includes('http_request_duration_seconds'), output);
    assert.ok(output.includes('process_heap_bytes'), output);
  });

  it('records request metrics after middleware is invoked', async () => {
    const registry = new MetricsRegistry();
    const mw = prometheusMiddleware(registry);
    const ctx = makeCtx({ method: 'GET', path: '/api/users', statusCode: 200 });

    await mw(ctx, async () => { /* no-op */ });

    const output = registry.collect();
    assert.ok(output.includes('http_requests_total'), output);
    // Should have a non-zero count
    assert.ok(output.includes('"GET"'), output);
  });

  it('records heap bytes metric', async () => {
    const registry = new MetricsRegistry();
    const mw = prometheusMiddleware(registry);
    const ctx = makeCtx();

    await mw(ctx, async () => { /* no-op */ });

    const output = registry.collect();
    assert.ok(output.includes('process_heap_bytes'), output);
    // Heap should be a non-zero number
    const match = /process_heap_bytes (\d+)/.exec(output);
    assert.ok(match !== null, 'should have a numeric heap value');
    assert.ok(parseInt(match[1]!, 10) > 0, 'heap should be greater than 0');
  });

  it('registers db_pool_connections gauge when pool is provided', () => {
    const registry = new MetricsRegistry();
    const pool = { idleCount: 3, activeCount: 2, waitingCount: 0 };
    prometheusMiddleware(registry, pool);
    const output = registry.collect();
    assert.ok(output.includes('db_pool_connections'), output);
  });

  it('throws MetricConflictError if called twice on same registry', () => {
    const registry = new MetricsRegistry();
    prometheusMiddleware(registry);
    assert.throws(
      () => prometheusMiddleware(registry),
      (err: unknown) => {
        assert.ok(err instanceof MetricConflictError);
        return true;
      },
    );
  });
});

// ── 13.6 — metricsHandler ────────────────────────────────────────────────────

describe('metricsHandler (13.6)', () => {
  it('responds with Prometheus text containing registered metrics', async () => {
    const registry = new MetricsRegistry();
    registry.counter('my_counter', 'A test counter');
    const handler = metricsHandler(registry);
    const ctx = makeCtx();

    await handler(ctx, async () => { /* no-op */ });

    const body = (ctx as unknown as { _body: () => string })._body();
    assert.ok(body.includes('# HELP my_counter'), body);
    assert.ok(body.includes('# TYPE my_counter counter'), body);
  });

  it('sets Content-Type to the Prometheus exposition format 0.0.4', async () => {
    const registry = new MetricsRegistry();
    const handler = metricsHandler(registry);
    const ctx = makeCtx();

    await handler(ctx, async () => { /* no-op */ });

    const headers = (ctx as unknown as { _headers: () => Record<string, string> })._headers();
    assert.equal(headers['Content-Type'], PROMETHEUS_CONTENT_TYPE);
    assert.equal(headers['Content-Type'], 'text/plain; version=0.0.4; charset=utf-8');
  });

  it('writes a 200 status with the collected body', async () => {
    const registry = new MetricsRegistry();
    registry.gauge('g', 'a gauge').set(7);
    const handler = metricsHandler(registry);
    const ctx = makeCtx();

    await handler(ctx, async () => { /* no-op */ });

    const status = (ctx as unknown as { _status: () => number })._status();
    const body = (ctx as unknown as { _body: () => string })._body();
    assert.equal(status, 200);
    assert.ok(body.includes('g 7'), body);
  });
});

// ── 13.6 — registerMetricsRoute integration (real StreetApp) ──────────────────

describe('registerMetricsRoute (13.6)', () => {
  it('GET /metrics serves the exposition with the Prometheus Content-Type', async () => {
    const port = nextPort();
    const registry = new MetricsRegistry();
    const app = streetApp({ port });
    registerMetricsRoute(app, registry);

    await app.listen(port);
    try {
      const res = await httpGet(port, '/metrics');
      assert.equal(res.status, 200);
      assert.equal(res.contentType, 'text/plain; version=0.0.4; charset=utf-8');
      // Default metrics registered by prometheusMiddleware should be present.
      assert.ok(res.body.includes('http_requests_total'), res.body);
      assert.ok(res.body.includes('process_heap_bytes'), res.body);
    } finally {
      await app.close();
    }
  });

  it('records request metrics and exposes db_pool_connections when a pool is given', async () => {
    const port = nextPort();
    const registry = new MetricsRegistry();
    const app = streetApp({ port });
    registerMetricsRoute(app, registry, { idleCount: 3, activeCount: 2, waitingCount: 0 });

    await app.listen(port);
    try {
      // First scrape records its own request via the prometheus middleware.
      await httpGet(port, '/metrics');
      const res = await httpGet(port, '/metrics');
      assert.equal(res.status, 200);
      assert.equal(res.contentType, 'text/plain; version=0.0.4; charset=utf-8');
      assert.ok(res.body.includes('db_pool_connections'), res.body);
      assert.ok(res.body.includes('http_requests_total{'), res.body);
    } finally {
      await app.close();
    }
  });

  it('non-metrics routes fall through to the not-found handler', async () => {
    const port = nextPort();
    const registry = new MetricsRegistry();
    const app = streetApp({ port });
    registerMetricsRoute(app, registry);

    await app.listen(port);
    try {
      const res = await httpGet(port, '/not-metrics');
      assert.equal(res.status, 404);
    } finally {
      await app.close();
    }
  });
});
