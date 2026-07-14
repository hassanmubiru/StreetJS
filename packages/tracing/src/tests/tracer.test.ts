import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTracer } from '../tracer.js';
import { InMemorySpanExporter, SimpleSpanProcessor } from '../exporter.js';
import { alwaysOffSampler } from '../sampler.js';
import type { IdGenerator, Sampler } from '../types.js';

function sequentialIds(): IdGenerator {
  let t = 0;
  let s = 0;
  return {
    traceId: () => (++t).toString(16).padStart(32, '0'),
    spanId: () => (++s).toString(16).padStart(16, '0'),
  };
}

function setup(sampler?: Sampler) {
  const exporter = new InMemorySpanExporter();
  let now = 1000;
  const tracer = createTracer({
    processor: new SimpleSpanProcessor(exporter),
    idGenerator: sequentialIds(),
    clock: () => now,
    sampler,
  });
  return { exporter, tracer, tick: (ms: number) => (now += ms) };
}

test('a root span gets a fresh trace id and no parent', () => {
  const { exporter, tracer } = setup();
  const span = tracer.startSpan('root');
  const ctx = span.spanContext();
  assert.equal(ctx.traceId, '00000000000000000000000000000001');
  assert.equal(ctx.spanId, '0000000000000001');
  assert.equal(ctx.traceFlags, 1); // sampled
  span.end();
  const data = exporter.getFinishedSpans()[0];
  assert.equal(data.name, 'root');
  assert.equal(data.parentSpanId, undefined);
});

test('duration is computed from the clock', () => {
  const { exporter, tracer, tick } = setup();
  const span = tracer.startSpan('op');
  tick(25);
  span.end();
  assert.equal(exporter.getFinishedSpans()[0].durationMs, 25);
});

test('attributes, events, and status are captured', () => {
  const { exporter, tracer } = setup();
  const span = tracer.startSpan('op', { attributes: { a: 1 }, kind: 'server' });
  span.setAttribute('b', 'x').setAttributes({ c: true });
  span.addEvent('cache-miss', { key: 'k' });
  span.setStatus({ code: 'ok' });
  span.updateName('renamed');
  span.end();
  const data = exporter.getFinishedSpans()[0];
  assert.equal(data.name, 'renamed');
  assert.equal(data.kind, 'server');
  assert.deepEqual(data.attributes, { a: 1, b: 'x', c: true });
  assert.equal(data.events[0].name, 'cache-miss');
  assert.deepEqual(data.events[0].attributes, { key: 'k' });
  assert.equal(data.status.code, 'ok');
});

test('recordException adds an exception event', () => {
  const { exporter, tracer } = setup();
  const span = tracer.startSpan('op');
  span.recordException(new TypeError('bad'));
  span.recordException('plain');
  span.end();
  const events = exporter.getFinishedSpans()[0].events;
  assert.equal(events[0].name, 'exception');
  assert.equal(events[0].attributes?.['exception.type'], 'TypeError');
  assert.equal(events[0].attributes?.['exception.message'], 'bad');
  assert.equal(events[1].attributes?.['exception.type'], 'Error');
  assert.equal(events[1].attributes?.['exception.message'], 'plain');
});

test('end is idempotent', () => {
  const { exporter, tracer } = setup();
  const span = tracer.startSpan('op');
  span.end();
  span.end();
  assert.equal(exporter.getFinishedSpans().length, 1);
});

test('mutations after end are ignored and isRecording turns false', () => {
  const { exporter, tracer } = setup();
  const span = tracer.startSpan('op');
  span.setAttribute('a', 1);
  span.end();
  assert.equal(span.isRecording(), false);
  span.setAttribute('b', 2);
  assert.deepEqual(exporter.getFinishedSpans()[0].attributes, { a: 1 });
});

test('a child span inherits the trace id and links the parent', () => {
  const { exporter, tracer } = setup();
  const parent = tracer.startSpan('parent');
  const child = tracer.startSpan('child', { parent: parent.spanContext() });
  child.end();
  parent.end();
  const childData = exporter.getFinishedSpans()[0];
  assert.equal(childData.context.traceId, parent.spanContext().traceId);
  assert.equal(childData.parentSpanId, parent.spanContext().spanId);
});

test('startActiveSpan makes the span active and ends it automatically', () => {
  const { exporter, tracer } = setup();
  const result = tracer.startActiveSpan('active', (span) => {
    assert.equal(tracer.activeSpan(), span);
    const child = tracer.startSpan('nested'); // no explicit parent → uses active
    assert.equal(child.spanContext().traceId, span.spanContext().traceId);
    child.end();
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(tracer.activeSpan(), undefined);
  assert.equal(exporter.getFinishedSpans().length, 2);
});

test('startActiveSpan records thrown errors and sets error status', () => {
  const { exporter, tracer } = setup();
  assert.throws(() =>
    tracer.startActiveSpan('boom', () => {
      throw new Error('kaboom');
    }),
  );
  const data = exporter.getFinishedSpans()[0];
  assert.equal(data.status.code, 'error');
  assert.equal(data.status.message, 'kaboom');
  assert.equal(data.events[0].name, 'exception');
});

test('startActiveSpan handles async success and failure', async () => {
  const { exporter, tracer } = setup();
  const ok = await tracer.startActiveSpan('async-ok', async () => 'done');
  assert.equal(ok, 'done');
  await assert.rejects(
    tracer.startActiveSpan('async-fail', async () => {
      throw new Error('async boom');
    }),
  );
  const failed = exporter.getFinishedSpans().find((s) => s.name === 'async-fail');
  assert.equal(failed?.status.code, 'error');
});

test('parent:null forces a new root even inside an active span', () => {
  const { tracer } = setup();
  tracer.startActiveSpan('outer', (outer) => {
    const forcedRoot = tracer.startSpan('root', { parent: null });
    assert.notEqual(forcedRoot.spanContext().traceId, outer.spanContext().traceId);
    assert.equal(forcedRoot.spanContext().traceId.length, 32);
    forcedRoot.end();
  });
});

test('explicit startTime is honored', () => {
  const { exporter, tracer } = setup();
  const span = tracer.startSpan('op', { startTime: 500 });
  span.end(700);
  const data = exporter.getFinishedSpans()[0];
  assert.equal(data.startTime, 500);
  assert.equal(data.durationMs, 200);
});

test('a non-sampled span records nothing and is not exported', () => {
  const { exporter, tracer } = setup(alwaysOffSampler);
  const span = tracer.startSpan('unsampled');
  assert.equal(span.spanContext().traceFlags, 0);
  assert.equal(span.isRecording(), false);
  span.setAttribute('a', 1);
  span.end();
  assert.equal(exporter.getFinishedSpans().length, 0);
});
