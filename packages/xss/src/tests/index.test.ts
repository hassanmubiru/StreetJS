import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeString, sanitizeDeep, escapeHtml } from '../index.js';

test('the public API is exported from the barrel', () => {
  assert.equal(typeof sanitizeString, 'function');
  assert.equal(typeof sanitizeDeep, 'function');
  assert.equal(typeof escapeHtml, 'function');
  assert.equal(sanitizeString('<x>'), 'x');
  assert.deepEqual(sanitizeDeep(['<i>']), ['i']);
  assert.equal(escapeHtml('<'), '&lt;');
});
