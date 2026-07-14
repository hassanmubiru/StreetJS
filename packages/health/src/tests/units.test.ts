import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aggregate, worst, httpStatusFor } from '../status.js';
import { buildReport, toEndpointResponse, CONTENT_TYPE } from '../report.js';
import { withTimeout, TimeoutError } from '../timeout.js';
import { normalizeCheck } from '../check.js';
import type { CheckOutcome } from '../types.js';

function outcome(name: string, status: CheckOutcome['status'], critical = true): CheckOutcome {
  return { name, kind: 'readiness', critical, status, time: 't', durationMs: 1 };
}

test('worst returns the more severe status', () => {
  assert.equal(worst('pass', 'warn'), 'warn');
  assert.equal(worst('fail', 'warn'), 'fail');
  assert.equal(worst('pass', 'pass'), 'pass');
});

test('aggregate: empty is pass', () => {
  assert.equal(aggregate([]), 'pass');
});

test('aggregate: critical fail dominates; non-critical fail is warn', () => {
  assert.equal(aggregate([outcome('a', 'pass'), outcome('b', 'fail', true)]), 'fail');
  assert.equal(aggregate([outcome('a', 'pass'), outcome('b', 'fail', false)]), 'warn');
  assert.equal(aggregate([outcome('a', 'warn'), outcome('b', 'pass')]), 'warn');
});

test('httpStatusFor maps fail to 503, otherwise 200', () => {
  assert.equal(httpStatusFor('pass'), 200);
  assert.equal(httpStatusFor('warn'), 200);
  assert.equal(httpStatusFor('fail'), 503);
});

test('buildReport groups outcomes by name', () => {
  const report = buildReport([outcome('a', 'pass'), outcome('a', 'warn'), outcome('b', 'pass')], 'now');
  assert.equal(report.time, 'now');
  assert.equal(report.checks.a.length, 2);
  assert.equal(report.checks.b.length, 1);
  assert.equal(report.status, 'warn');
});

test('toEndpointResponse serializes the report', () => {
  const report = buildReport([outcome('a', 'fail', true)], 'now');
  const res = toEndpointResponse(report);
  assert.equal(res.statusCode, 503);
  assert.equal(res.contentType, CONTENT_TYPE);
  assert.equal(JSON.parse(res.body).status, 'fail');
});

test('withTimeout resolves fast promises', async () => {
  assert.equal(await withTimeout(Promise.resolve(42), 1000), 42);
});

test('withTimeout propagates rejections', async () => {
  await assert.rejects(withTimeout(Promise.reject(new Error('nope')), 1000), /nope/);
});

test('withTimeout rejects with TimeoutError when slow', async () => {
  await assert.rejects(
    withTimeout(new Promise<void>(() => {}), 10),
    (err: unknown) => err instanceof TimeoutError && /timed out after 10ms/.test((err as Error).message),
  );
});

test('normalizeCheck applies defaults', () => {
  const n = normalizeCheck({ name: 'x', check: () => {} });
  assert.equal(n.kind, 'readiness');
  assert.equal(n.critical, true);
  assert.equal(n.timeoutMs, 5000);
});
