// src/tests/otel.test.ts
// Unit tests for OtelTracer and otelMiddleware.
//   - Parent-child span relationship
//   - traceparent round-trip (extract → inject)
//   - Buffer capped at 1,000 spans
//   - flush() drains spans to a mock OTLP endpoint
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { OtelTracer, otelMiddleware } from '../observability/otel.js';
function createMockOtlpServer() {
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => {
            let parsed = null;
            try {
                parsed = JSON.parse(body);
            }
            catch { /* ignore */ }
            requests.push({ body, parsed });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{}');
        });
    });
    const start = () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const stop = () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    const url = () => {
        const addr = server.address();
        return `http://127.0.0.1:${addr.port}`;
    };
    return { server, requests, url, start, stop };
}
// ── Helpers ───────────────────────────────────────────────────────────────────
/** Build a minimal StreetContext-like object sufficient for otelMiddleware. */
function makeCtx(overrides) {
    const statusCode = overrides.statusCode ?? 200;
    return {
        req: {},
        res: { statusCode },
        path: overrides.path ?? '/test',
        method: overrides.method ?? 'GET',
        params: {},
        query: {},
        headers: overrides.headers ?? {},
        body: null,
        files: [],
        state: {},
        user: null,
        startTime: process.hrtime.bigint(),
        sent: false,
        json: () => undefined,
        text: () => undefined,
        html: () => undefined,
        send: () => undefined,
        setHeader: () => undefined,
        cookie: () => undefined,
        setCookie: () => undefined,
    };
}
// ── Tests ─────────────────────────────────────────────────────────────────────
describe('OtelTracer — span creation', () => {
    it('creates a root span with 32-char traceId and 16-char spanId', () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        const span = tracer.startSpan('my-op');
        assert.equal(span.context.traceId.length, 32);
        assert.equal(span.context.spanId.length, 16);
        assert.ok(/^[0-9a-f]+$/.test(span.context.traceId));
        assert.ok(/^[0-9a-f]+$/.test(span.context.spanId));
        assert.equal(span.parentSpanId, undefined);
        tracer.shutdown();
    });
    it('creates a child span that inherits traceId from parent context', () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        const parent = tracer.startSpan('parent');
        const child = tracer.startSpan('child', parent.context, parent.context.spanId);
        assert.equal(child.context.traceId, parent.context.traceId);
        assert.notEqual(child.context.spanId, parent.context.spanId);
        assert.equal(child.parentSpanId, parent.context.spanId);
        tracer.shutdown();
    });
    it('records startNs as a bigint from process.hrtime.bigint()', () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        const before = process.hrtime.bigint();
        const span = tracer.startSpan('timing');
        const after = process.hrtime.bigint();
        assert.ok(span.startNs >= before);
        assert.ok(span.startNs <= after);
        tracer.shutdown();
    });
    it('end() populates endNs and is idempotent', () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        const span = tracer.startSpan('op');
        span.end(200);
        const endNs1 = span.endNs;
        span.end(500); // second call ignored
        assert.equal(span.endNs, endNs1);
        assert.equal(span.statusCode, 200);
        tracer.shutdown();
    });
});
describe('OtelTracer — traceparent round-trip', () => {
    it('extractContext returns null for missing header', () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        assert.equal(tracer.extractContext({}), null);
        tracer.shutdown();
    });
    it('extractContext parses a valid W3C traceparent header', () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        const headers = {
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        };
        const ctx = tracer.extractContext(headers);
        assert.ok(ctx !== null);
        assert.equal(ctx.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
        assert.equal(ctx.spanId, '00f067aa0ba902b7');
        assert.equal(ctx.traceFlags, 1);
        tracer.shutdown();
    });
    it('extractContext returns null for a malformed traceparent', () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        assert.equal(tracer.extractContext({ traceparent: 'not-valid' }), null);
        assert.equal(tracer.extractContext({ traceparent: '01-abc-def-00' }), null); // wrong version
        tracer.shutdown();
    });
    it('injectContext writes correct traceparent header', () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        const spanCtx = {
            traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
            spanId: '00f067aa0ba902b7',
            traceFlags: 1,
        };
        const outHeaders = {};
        tracer.injectContext(spanCtx, outHeaders);
        assert.equal(outHeaders['traceparent'], '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
        tracer.shutdown();
    });
    it('round-trip: inject → extract returns same context', () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        const span = tracer.startSpan('root');
        const outHeaders = {};
        tracer.injectContext(span.context, outHeaders);
        const extracted = tracer.extractContext(outHeaders);
        assert.ok(extracted !== null);
        assert.equal(extracted.traceId, span.context.traceId);
        assert.equal(extracted.spanId, span.context.spanId);
        assert.equal(extracted.traceFlags, span.context.traceFlags);
        tracer.shutdown();
    });
});
describe('OtelTracer — buffer cap at 1,000', () => {
    it('drops oldest span when buffer exceeds maxBuffer', async () => {
        const tracer = new OtelTracer({ serviceName: 'test', maxBuffer: 5 });
        // Create and end 6 spans — 6th should evict the 1st
        const spans = [];
        for (let i = 0; i < 6; i++) {
            const s = tracer.startSpan(`op-${i}`);
            s.end();
            spans.push(s);
        }
        // Access private buffer via type assertion for test introspection
        const buf = tracer.buffer;
        assert.equal(buf.length, 5, 'buffer should hold exactly 5 spans after overflow');
        // The oldest span (op-0) should have been dropped; op-1..op-5 remain
        const names = buf.map((s) => s.name);
        assert.ok(!names.includes('op-0'), 'oldest span should be dropped');
        assert.ok(names.includes('op-5'), 'newest span should be kept');
        tracer.shutdown();
    });
    it('caps at exactly 1,000 spans with default maxBuffer', async () => {
        const tracer = new OtelTracer({ serviceName: 'test' });
        // End 1,100 spans
        for (let i = 0; i < 1100; i++) {
            const s = tracer.startSpan(`op-${i}`);
            s.end();
        }
        const buf = tracer.buffer;
        assert.ok(buf.length <= 1000, `buffer length ${buf.length} exceeds 1000`);
        tracer.shutdown();
    });
});
describe('OtelTracer — flush() sends spans to OTLP endpoint', () => {
    const mock = createMockOtlpServer();
    let tracer;
    before(async () => { await mock.start(); });
    after(async () => {
        tracer?.shutdown();
        await mock.stop();
    });
    beforeEach(() => { mock.requests.length = 0; });
    it('flush() posts OTLP JSON with completed spans', async () => {
        tracer = new OtelTracer({ serviceName: 'svc', endpoint: mock.url() });
        const span = tracer.startSpan('test-op');
        span.attributes['test'] = true;
        span.end(200);
        await tracer.flush();
        assert.equal(mock.requests.length, 1);
        const body = mock.requests[0].parsed;
        const resSpan = body.resourceSpans[0];
        const serviceAttr = resSpan.resource.attributes.find((a) => a.key === 'service.name');
        assert.equal(serviceAttr?.value.stringValue, 'svc');
        const otlpSpan = resSpan.scopeSpans[0].spans[0];
        assert.equal(otlpSpan.name, 'test-op');
        assert.equal(otlpSpan.traceId, span.context.traceId);
        assert.equal(otlpSpan.spanId, span.context.spanId);
    });
    it('flush() clears the buffer after export', async () => {
        tracer = new OtelTracer({ serviceName: 'svc', endpoint: mock.url() });
        const s = tracer.startSpan('op');
        s.end();
        await tracer.flush();
        await tracer.flush(); // second flush should be a no-op (no request sent)
        assert.equal(mock.requests.length, 1, 'second flush should send nothing');
    });
    it('flush() is a no-op when buffer is empty', async () => {
        tracer = new OtelTracer({ serviceName: 'svc', endpoint: mock.url() });
        await tracer.flush(); // buffer is empty
        assert.equal(mock.requests.length, 0);
    });
    it('flush() called during shutdown drains remaining spans', async () => {
        tracer = new OtelTracer({ serviceName: 'svc', endpoint: mock.url() });
        const s = tracer.startSpan('shutdown-op');
        s.end();
        // Simulate graceful shutdown: flush then shutdown
        await tracer.flush();
        tracer.shutdown();
        assert.equal(mock.requests.length, 1);
    });
});
describe('otelMiddleware', () => {
    const mock = createMockOtlpServer();
    let tracer;
    before(async () => { await mock.start(); });
    after(async () => {
        tracer?.shutdown();
        await mock.stop();
    });
    beforeEach(() => { mock.requests.length = 0; });
    it('stores span in ctx.state[otelSpan]', async () => {
        tracer = new OtelTracer({ serviceName: 'svc', endpoint: mock.url() });
        const middleware = otelMiddleware(tracer);
        const ctx = makeCtx({ method: 'GET', path: '/hello' });
        await middleware(ctx, async () => undefined);
        assert.ok(ctx.state['otelSpan'] !== undefined);
    });
    it('creates a root span when no traceparent header is present', async () => {
        tracer = new OtelTracer({ serviceName: 'svc', endpoint: mock.url() });
        const middleware = otelMiddleware(tracer);
        const ctx = makeCtx({ headers: {} });
        await middleware(ctx, async () => undefined);
        const span = ctx.state['otelSpan'];
        assert.ok(span !== undefined);
        assert.equal(span.parentSpanId, undefined);
    });
    it('creates a child span when traceparent header is present', async () => {
        tracer = new OtelTracer({ serviceName: 'svc', endpoint: mock.url() });
        const middleware = otelMiddleware(tracer);
        const parentHeaders = {
            traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        };
        const ctx = makeCtx({ headers: parentHeaders });
        await middleware(ctx, async () => undefined);
        const span = ctx.state['otelSpan'];
        assert.equal(span.context.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
        assert.equal(span.parentSpanId, '00f067aa0ba902b7');
    });
    it('ends span with response status code', async () => {
        tracer = new OtelTracer({ serviceName: 'svc', endpoint: mock.url() });
        const middleware = otelMiddleware(tracer);
        const ctx = makeCtx({ statusCode: 201 });
        await middleware(ctx, async () => undefined);
        const span = ctx.state['otelSpan'];
        assert.equal(span.statusCode, 201);
        assert.ok(span.endNs !== undefined, 'span should be ended');
    });
    it('ends span even if next() throws', async () => {
        tracer = new OtelTracer({ serviceName: 'svc', endpoint: mock.url() });
        const middleware = otelMiddleware(tracer);
        const ctx = makeCtx({});
        await assert.rejects(() => middleware(ctx, async () => { throw new Error('boom'); }), /boom/);
        const span = ctx.state['otelSpan'];
        assert.ok(span.endNs !== undefined, 'span should be ended even on error');
    });
});
//# sourceMappingURL=otel.test.js.map