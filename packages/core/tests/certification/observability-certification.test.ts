// tests/certification/observability-certification.test.ts
// Certifies tracing, metrics, structured logging, correlation, and health probes
// against the real implementations (no mocks).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';

import { OtelTracer } from '../../src/observability/otel.js';
import { MetricsRegistry } from '../../src/observability/prometheus.js';
import { HealthCheckRegistry } from '../../src/observability/health.js';
import { Logger } from '../../src/observability/logger.js';

describe('OBSERVABILITY — OpenTelemetry tracing', () => {
  it('creates parent/child spans and round-trips W3C traceparent', () => {
    const tracer = new OtelTracer({ serviceName: 'cert' });
    const parent = tracer.startSpan('http.request');
    const child = tracer.startSpan('db.query', parent.context, parent.context.spanId);
    assert.equal(child.context.traceId, parent.context.traceId, 'child shares trace id');

    const headers: Record<string, string> = {};
    tracer.injectContext(parent.context, headers);
    assert.match(headers['traceparent'] ?? '', /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);

    const extracted = tracer.extractContext(headers);
    assert.equal(extracted?.traceId, parent.context.traceId);
  });
});

describe('OBSERVABILITY — Prometheus metrics', () => {
  it('renders valid exposition format with HELP/TYPE and counter/gauge/histogram', () => {
    const reg = new MetricsRegistry();
    const c = reg.counter('http_requests_total', 'total requests', ['method']);
    c.inc({ method: 'GET' });
    c.inc({ method: 'GET' });
    const g = reg.gauge('process_heap_bytes', 'heap');
    g.set(1234);
    const h = reg.histogram('req_seconds', 'latency', [0.1, 1]);
    h.observe(0.05);

    const out = reg.collect();
    assert.match(out, /# HELP http_requests_total/);
    assert.match(out, /# TYPE http_requests_total counter/);
    assert.match(out, /http_requests_total\{method="GET"\} 2/);
    assert.match(out, /# TYPE process_heap_bytes gauge/);
    assert.match(out, /# TYPE req_seconds histogram/);
  });

  it('throws on duplicate metric registration (no silent overwrite)', () => {
    const reg = new MetricsRegistry();
    reg.counter('dup_total', 'x');
    assert.throws(() => reg.counter('dup_total', 'x'));
  });
});

describe('OBSERVABILITY — Health / readiness / liveness', () => {
  it('reports ok when all checks pass and degraded (down) on failure', async () => {
    const reg = new HealthCheckRegistry();
    reg.addCheck('live', async () => ({ status: 'up' }), { type: 'liveness' });
    reg.addCheck('db', async () => ({ status: 'up' }), { type: 'readiness' });
    assert.equal((await reg.runLiveness()).status, 'ok');
    assert.equal((await reg.runReadiness()).status, 'ok');

    const reg2 = new HealthCheckRegistry();
    reg2.addCheck('db', async () => { throw new Error('down'); }, { type: 'readiness' });
    const res = await reg2.runReadiness();
    assert.equal(res.status, 'degraded');
    assert.equal(res.checks['db']?.status, 'down');
  });

  it('marks a check down on timeout', async () => {
    const reg = new HealthCheckRegistry();
    reg.addCheck('slow', () => new Promise((r) => setTimeout(() => r({ status: 'up' }), 200)), { type: 'liveness', timeoutMs: 20 });
    const res = await reg.runLiveness();
    assert.equal(res.checks['slow']?.status, 'down');
  });
});

describe('OBSERVABILITY — Structured logging + correlation', () => {
  function capture(): { stream: Writable; lines: () => string[] } {
    const chunks: string[] = [];
    return {
      stream: new Writable({ write(c: Buffer, _e, cb) { chunks.push(c.toString()); cb(); } }),
      lines: () => chunks.join('').trim().split('\n').filter(Boolean),
    };
  }

  it('emits JSON entries with level, message, service and propagates child bindings', () => {
    const { stream, lines } = capture();
    const base = new Logger({ service: 'cert', stream });
    const child = base.child({ correlationId: 'cid-123' });
    child.info('hello', { k: 1 });
    const entry = JSON.parse(lines()[0]!);
    assert.equal(entry.level, 'info');
    assert.equal(entry.service, 'cert');
    assert.equal(entry.correlationId, 'cid-123');
    assert.equal(entry.k, 1);
  });

  it('serializes Error meta into name/message/stack', () => {
    const { stream, lines } = capture();
    const log = new Logger({ service: 'cert', stream });
    log.error('boom', { err: new Error('kapow') });
    const entry = JSON.parse(lines()[0]!);
    assert.equal(entry.err.name, 'Error');
    assert.equal(entry.err.message, 'kapow');
    assert.ok(entry.err.stack);
  });
});
