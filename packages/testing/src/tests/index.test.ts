import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  spy,
  fakeClock,
  deferred,
  delay,
  waitFor,
  mockFetch,
  jsonResponse,
  sequential,
  deepEqual,
} from '../index.js';

test('public API surface is exported and usable', async () => {
  assert.equal(typeof spy, 'function');
  assert.equal(typeof fakeClock, 'function');
  assert.equal(typeof deferred, 'function');
  assert.equal(typeof delay, 'function');
  assert.equal(typeof waitFor, 'function');
  assert.equal(typeof mockFetch, 'function');
  assert.equal(typeof jsonResponse, 'function');
  assert.equal(typeof sequential, 'function');
  assert.equal(typeof deepEqual, 'function');

  // A quick end-to-end smoke through the barrel exports.
  const clock = fakeClock(10);
  assert.equal(clock.fn(), 10);
  const s = spy().mockReturnValue(1);
  assert.equal(s(), 1);
  const fetch = mockFetch(jsonResponse({ ok: true }));
  assert.equal((await fetch('https://x')).status, 200);
});

test('waitFor uses a default timeout message when none is given', async () => {
  await assert.rejects(
    waitFor(() => false, { timeoutMs: 15, intervalMs: 5 }),
    /waitFor timed out after 15ms/,
  );
});
