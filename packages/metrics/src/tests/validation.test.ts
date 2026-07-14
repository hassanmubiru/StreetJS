import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertValidMetricName,
  assertValidLabelName,
  normalizeLabels,
  coerceLabelValue,
  seriesKey,
} from '../validation.js';

test('valid metric names are accepted, invalid rejected', () => {
  assert.doesNotThrow(() => assertValidMetricName('http_requests_total'));
  assert.doesNotThrow(() => assertValidMetricName('my:metric'));
  assert.throws(() => assertValidMetricName('1bad'), /Invalid metric name/);
  assert.throws(() => assertValidMetricName('has space'), /Invalid metric name/);
});

test('valid label names are accepted; reserved and invalid rejected', () => {
  assert.doesNotThrow(() => assertValidLabelName('method'));
  assert.throws(() => assertValidLabelName('__reserved'), /reserved/);
  assert.throws(() => assertValidLabelName('has-dash'), /Invalid label name/);
  assert.throws(() => assertValidLabelName('9x'), /Invalid label name/);
});

test('coerceLabelValue stringifies non-strings', () => {
  assert.equal(coerceLabelValue('x'), 'x');
  assert.equal(coerceLabelValue(3), '3');
  assert.equal(coerceLabelValue(false), 'false');
});

test('normalizeLabels enforces exact label sets', () => {
  assert.deepEqual(normalizeLabels(['a', 'b'], { a: 1, b: 'y' }), { a: '1', b: 'y' });
  assert.throws(() => normalizeLabels(['a'], {}), /Expected labels/);
  assert.throws(() => normalizeLabels(['a'], { a: '1', b: '2' }), /Expected labels/);
});

test('normalizeLabels reports a missing named label', () => {
  // Same count, wrong name — exercises the per-name presence check.
  assert.throws(() => normalizeLabels(['a', 'b'], { a: '1', c: '2' }), /Missing value for label/);
});

test('seriesKey is order-independent and stable', () => {
  assert.equal(seriesKey({ a: '1', b: '2' }), seriesKey({ b: '2', a: '1' }));
  assert.equal(seriesKey({}), '');
});
