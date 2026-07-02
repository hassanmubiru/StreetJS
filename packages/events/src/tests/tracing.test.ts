// src/tests/tracing.test.ts
// Unit tests for the events tracing wiring (tracing.ts): a span per published
// event, W3C context propagation (inbound traceparent + nested child spans),
// error status on a middleware veto, and delivered/failed span attributes via
// the telemetry sink. Plus a smoke test against the real core OtelTracer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { OtelTracer } from 'streetjs';

import { createEvents } from '../facade.js';
import { createEventsTracing, type SpanContextLike, type SpanLike, type TracerLike } from '../tracing.js';

interface AppEvents {
  'user.created': { id: string };
  'user.verified': { id: string };
}

// ── Fake tracer that records spans (mirrors OtelTracer's context rules) ────────

class FakeSpan implements SpanLike {
  attributes: Record<string, string | number | boolean> = {};
  ended = false;
  statusCode?: number;
  constructor(
    readonly name: string,
    readonly context: SpanContextLike,
    readonly parentSpanId?: string,
  ) {}
  end(statusCode?: number): void {
    if (this.ended) return;
    this.ended = true;
    this.statusCode = statusCode;
  }
}

class FakeTracer implements TracerLike {
  readonly spans: FakeSpan[] = [];
  startSpan(name: string, parent?: SpanContextLike, parentSpanId?: string): SpanLike {
    const span = new FakeSpan(
      name,
      {
        traceId: parent?.traceId ?? randomBytes(16).toString('hex'),
        spanId: randomBytes(8).toString('hex'),
        traceFlags: parent?.traceFlags ?? 1,
      },
      parentSpanId,
    );
    this.spans.push(span);
    return span;
  }
}

// ── Span per event ─────────────────────────────────────────────────────────────

test('a published event produces one ended span with event attributes', async () => {
  const tracer = new FakeTracer();
  const tracing = createEventsTracing(tracer);
  const events = createEvents<AppEvents>({ telemetry: tracing.telemetry });
  events.use(tracing.middleware);

  await events.publish('user.created', { id: 'u1' }, { tenantId: 't1' });

  assert.equal(tracer.spans.length, 1);
  const span = tracer.spans[0]!;
  assert.equal(span.name, 'event user.created');
  assert.equal(span.attributes['event.name'], 'user.created');
  assert.equal(typeof span.attributes['event.id'], 'string');
  assert.equal(span.attributes['event.tenant_id'], 't1');
  assert.equal(span.ended, true);
  assert.equal(span.statusCode, undefined, 'ok status (no listener failures = not an error)');
  await events.close();
});

// ── Inbound traceparent → parent context ────────────────────────────────────────

test('an inbound W3C traceparent becomes the span parent', async () => {
  const tracer = new FakeTracer();
  const tracing = createEventsTracing(tracer);
  const events = createEvents<AppEvents>();
  events.use(tracing.middleware);

  const traceId = randomBytes(16).toString('hex');
  const parentSpanId = randomBytes(8).toString('hex');
  await events.publish('user.created', { id: 'u1' }, {
    metadata: { traceparent: `00-${traceId}-${parentSpanId}-01` },
  });

  const span = tracer.spans[0]!;
  assert.equal(span.context.traceId, traceId, 'span joined the inbound trace');
  assert.equal(span.parentSpanId, parentSpanId, 'span parented to the inbound span id');
  await events.close();
});

// ── Nested publish → child span in the same trace ───────────────────────────────

test('a publish from inside a listener becomes a child span in the same trace', async () => {
  const tracer = new FakeTracer();
  const tracing = createEventsTracing(tracer);
  const events = createEvents<AppEvents>();
  events.use(tracing.middleware);

  events.on('user.created', async (u) => {
    await events.publish('user.verified', { id: u.id });
  });

  await events.publish('user.created', { id: 'u1' });

  assert.equal(tracer.spans.length, 2);
  const outer = tracer.spans.find((s) => s.name === 'event user.created')!;
  const inner = tracer.spans.find((s) => s.name === 'event user.verified')!;
  assert.equal(inner.context.traceId, outer.context.traceId, 'child shares the trace id');
  assert.equal(inner.parentSpanId, outer.context.spanId, 'child parented to the outer span');
  await events.close();
});

// ── Veto → error status ─────────────────────────────────────────────────────────

test('a middleware veto marks the span as error (status 500)', async () => {
  const tracer = new FakeTracer();
  const tracing = createEventsTracing(tracer);
  const events = createEvents<AppEvents>();
  events.use(tracing.middleware); // outer
  events.use(async () => {
    throw new Error('forbidden'); // inner veto
  });

  await assert.rejects(() => events.publish('user.created', { id: 'u1' }), /forbidden/);
  const span = tracer.spans[0]!;
  assert.equal(span.ended, true);
  assert.equal(span.statusCode, 500);
  assert.equal(span.attributes['error'], true);
  assert.equal(span.attributes['error.message'], 'forbidden');
  await events.close();
});

// ── Telemetry annotates delivered/failed counts ─────────────────────────────────

test('the telemetry sink annotates the span with delivered/failed counts', async () => {
  const tracer = new FakeTracer();
  const tracing = createEventsTracing(tracer);
  const events = createEvents<AppEvents>({ telemetry: tracing.telemetry });
  events.use(tracing.middleware);

  events.on('user.created', () => {}); // ok
  events.on('user.created', () => {
    throw new Error('listener boom'); // isolated failure
  });

  await events.publish('user.created', { id: 'u1' });

  const span = tracer.spans[0]!;
  assert.equal(span.attributes['event.delivered'], 1);
  assert.equal(span.attributes['event.failed'], 1);
  // A listener failure is isolated — the span itself is not an error.
  assert.equal(span.statusCode, undefined);
  await events.close();
});

// ── Smoke test against the real core OtelTracer ──────────────────────────────────

test('works with the real core OtelTracer (offline; no export)', async () => {
  const tracer = new OtelTracer({ serviceName: 'events-test' });
  const tracing = createEventsTracing(tracer);
  const events = createEvents<AppEvents>({ telemetry: tracing.telemetry });
  events.use(tracing.middleware);

  let sawTenant: string | undefined;
  events.on('user.created', (_p, ctx) => {
    // The child traceparent is propagated on ctx.metadata for downstream use.
    sawTenant = typeof ctx.metadata['traceparent'] === 'string' ? 'set' : undefined;
  });

  await assert.doesNotReject(() => events.publish('user.created', { id: 'u1' }));
  assert.equal(sawTenant, 'set', 'a traceparent is propagated on the context');

  await events.close();
  tracer.shutdown(); // stop the background flush timer (no network export attempted)
});
