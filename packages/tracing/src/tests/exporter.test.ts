import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  InMemorySpanExporter,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  noopSpanProcessor,
} from '../exporter.js';
import type { SpanData } from '../types.js';

function spanData(name: string): SpanData {
  return {
    name,
    context: { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1 },
    kind: 'internal',
    startTime: 0,
    endTime: 5,
    durationMs: 5,
    attributes: {},
    events: [],
    status: { code: 'unset' },
  };
}

test('InMemorySpanExporter captures and resets', () => {
  const e = new InMemorySpanExporter();
  e.export([spanData('a'), spanData('b')]);
  assert.equal(e.getFinishedSpans().length, 2);
  e.reset();
  assert.equal(e.getFinishedSpans().length, 0);
});

test('ConsoleSpanExporter writes one JSON line per span', () => {
  const lines: string[] = [];
  const e = new ConsoleSpanExporter((c) => lines.push(c));
  e.export([spanData('x')]);
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).name, 'x');
});

test('SimpleSpanProcessor forwards to the exporter and supports lifecycle', async () => {
  let shutdownCalls = 0;
  const exporter = new InMemorySpanExporter();
  const withShutdown = Object.assign(exporter, {
    shutdown: () => {
      shutdownCalls++;
    },
  });
  const p = new SimpleSpanProcessor(withShutdown);
  p.onEnd(spanData('y'));
  assert.equal(exporter.getFinishedSpans().length, 1);
  await p.forceFlush();
  await p.shutdown();
  assert.equal(shutdownCalls, 1);
});

test('noopSpanProcessor discards spans', () => {
  assert.doesNotThrow(() => noopSpanProcessor.onEnd(spanData('z')));
});
