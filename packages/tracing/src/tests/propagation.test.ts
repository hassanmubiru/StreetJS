import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTraceParent,
  formatTraceParent,
  isSampled,
  withSampled,
} from '../traceparent.js';
import {
  isValidTraceId,
  isValidSpanId,
  randomIdGenerator,
  INVALID_TRACE_ID,
  INVALID_SPAN_ID,
} from '../ids.js';
import {
  alwaysOnSampler,
  alwaysOffSampler,
  parentBasedSampler,
  traceIdRatioSampler,
} from '../sampler.js';
import { extractContext, injectContext, TRACER } from '../index.js';
import type { SpanContext } from '../types.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN = '00f067aa0ba902b7';

test('parseTraceParent parses a valid header', () => {
  const ctx = parseTraceParent(`00-${TRACE}-${SPAN}-01`);
  assert.ok(ctx);
  assert.equal(ctx?.traceId, TRACE);
  assert.equal(ctx?.spanId, SPAN);
  assert.equal(ctx?.traceFlags, 1);
  assert.equal(ctx?.remote, true);
});

test('parseTraceParent rejects malformed input', () => {
  assert.equal(parseTraceParent(undefined), null);
  assert.equal(parseTraceParent(''), null);
  assert.equal(parseTraceParent('garbage'), null);
  assert.equal(parseTraceParent(`00-${INVALID_TRACE_ID}-${SPAN}-01`), null);
  assert.equal(parseTraceParent(`00-${TRACE}-${INVALID_SPAN_ID}-01`), null);
  assert.equal(parseTraceParent(`ff-${TRACE}-${SPAN}-01`), null);
  assert.equal(parseTraceParent(`00-${TRACE}-${SPAN}-zz`), null);
});

test('parseTraceParent tolerates future versions with extra fields', () => {
  const ctx = parseTraceParent(`01-${TRACE}-${SPAN}-01-extra`);
  assert.equal(ctx?.traceId, TRACE);
});

test('formatTraceParent round-trips', () => {
  const ctx: SpanContext = { traceId: TRACE, spanId: SPAN, traceFlags: 1 };
  const header = formatTraceParent(ctx);
  assert.equal(header, `00-${TRACE}-${SPAN}-01`);
  assert.equal(parseTraceParent(header)?.traceId, TRACE);
});

test('formatTraceParent pads unsampled flags', () => {
  assert.equal(formatTraceParent({ traceId: TRACE, spanId: SPAN, traceFlags: 0 }), `00-${TRACE}-${SPAN}-00`);
});

test('isSampled and withSampled manipulate the flag bit', () => {
  assert.equal(isSampled(1), true);
  assert.equal(isSampled(0), false);
  assert.equal(withSampled(0, true), 1);
  assert.equal(withSampled(1, false), 0);
});

test('id validation and generation', () => {
  assert.equal(isValidTraceId(TRACE), true);
  assert.equal(isValidTraceId(INVALID_TRACE_ID), false);
  assert.equal(isValidTraceId('xyz'), false);
  assert.equal(isValidSpanId(SPAN), true);
  assert.equal(isValidSpanId(INVALID_SPAN_ID), false);
  assert.equal(isValidTraceId(randomIdGenerator.traceId()), true);
  assert.equal(isValidSpanId(randomIdGenerator.spanId()), true);
});

test('samplers behave as documented', () => {
  assert.equal(alwaysOnSampler(TRACE, null), true);
  assert.equal(alwaysOffSampler(TRACE, null), false);

  const parentBased = parentBasedSampler(alwaysOffSampler);
  assert.equal(parentBased(TRACE, { traceId: TRACE, spanId: SPAN, traceFlags: 1 }), true);
  assert.equal(parentBased(TRACE, { traceId: TRACE, spanId: SPAN, traceFlags: 0 }), false);
  assert.equal(parentBased(TRACE, null), false); // defers to root (alwaysOff)

  assert.equal(traceIdRatioSampler(1)(TRACE, null), true);
  assert.equal(traceIdRatioSampler(0)(TRACE, null), false);
  const half = traceIdRatioSampler(0.5);
  assert.equal(half('00000000000000000000000000000001', null), true); // low id → sampled
  assert.equal(half('ffffffff000000000000000000000000', null), false); // high id → not
});

test('extractContext and injectContext use traceparent', () => {
  const carrier: Record<string, string | string[] | undefined> = {
    traceparent: `00-${TRACE}-${SPAN}-01`,
  };
  const ctx = extractContext(carrier);
  assert.equal(ctx?.traceId, TRACE);

  const arrayCarrier = { traceparent: [`00-${TRACE}-${SPAN}-01`] };
  assert.equal(extractContext(arrayCarrier)?.spanId, SPAN);

  assert.equal(extractContext({}), null);

  const out: Record<string, string | string[] | undefined> = {};
  injectContext({ traceId: TRACE, spanId: SPAN, traceFlags: 1 }, out);
  assert.equal(out.traceparent, `00-${TRACE}-${SPAN}-01`);
});

test('DI token is a stable global symbol', () => {
  assert.equal(TRACER, Symbol.for('@streetjs/tracing:Tracer'));
});
