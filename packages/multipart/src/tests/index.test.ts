import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MultipartParser, BoundedTransform } from '../index.js';

test('the public API is exported from the barrel', () => {
  assert.equal(typeof MultipartParser, 'function');
  assert.equal(typeof BoundedTransform, 'function');
  const parser = new MultipartParser('b', '/tmp/x', 100);
  assert.ok(parser instanceof MultipartParser);
});
