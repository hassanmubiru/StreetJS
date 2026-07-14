import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatValue,
  escapeHelp,
  escapeLabelValue,
  renderSample,
  renderSnapshot,
} from '../render.js';

test('formatValue handles finite and non-finite numbers', () => {
  assert.equal(formatValue(5), '5');
  assert.equal(formatValue(0.005), '0.005');
  assert.equal(formatValue(Infinity), '+Inf');
  assert.equal(formatValue(-Infinity), '-Inf');
  assert.equal(formatValue(NaN), 'NaN');
});

test('escapeHelp escapes backslash and newline', () => {
  assert.equal(escapeHelp('a\\b\nc'), 'a\\\\b\\nc');
});

test('escapeLabelValue escapes backslash, quote, and newline', () => {
  assert.equal(escapeLabelValue('a"b\\c\nd'), 'a\\"b\\\\c\\nd');
});

test('renderSample omits braces when there are no labels', () => {
  assert.equal(renderSample({ name: 'm', labels: {}, value: 3 }), 'm 3');
});

test('renderSample renders labels and escapes values', () => {
  const line = renderSample({ name: 'm', labels: { path: '/a"b' }, value: 1 });
  assert.equal(line, 'm{path="/a\\"b"} 1');
});

test('renderSnapshot emits HELP and TYPE headers followed by samples', () => {
  const out = renderSnapshot({
    name: 'm_total',
    help: 'a metric',
    type: 'counter',
    samples: [
      { name: 'm_total', labels: { a: '1' }, value: 2 },
      { name: 'm_total', labels: { a: '2' }, value: 3 },
    ],
  });
  const lines = out.split('\n');
  assert.equal(lines[0], '# HELP m_total a metric');
  assert.equal(lines[1], '# TYPE m_total counter');
  assert.equal(lines[2], 'm_total{a="1"} 2');
  assert.equal(lines[3], 'm_total{a="2"} 3');
});
