import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fakeClock } from '../clock.js';
import { deferred, delay, waitFor } from '../async.js';
import { mockFetch, jsonResponse, sequential } from '../fetch-mock.js';
import { deepEqual } from '../equal.js';

test('fakeClock starts, ticks, and sets', () => {
  const clock = fakeClock(1000);
  assert.equal(clock.now(), 1000);
  assert.equal(clock.fn(), 1000);
  clock.tick(50);
  assert.equal(clock.now(), 1050);
  clock.set(9999);
  assert.equal(clock.now(), 9999);
});

test('fakeClock rejects moving backwards', () => {
  const clock = fakeClock();
  assert.throws(() => clock.tick(-1), /backwards/);
});

test('deferred resolves and rejects externally', async () => {
  const d = deferred<number>();
  queueMicrotask(() => d.resolve(5));
  assert.equal(await d.promise, 5);

  const d2 = deferred();
  queueMicrotask(() => d2.reject(new Error('x')));
  await assert.rejects(d2.promise, /x/);
});

test('delay resolves after the interval', async () => {
  const start = Date.now();
  await delay(15);
  assert.ok(Date.now() - start >= 10);
});

test('waitFor resolves when the predicate becomes truthy', async () => {
  let ready = false;
  setTimeout(() => {
    ready = true;
  }, 20);
  const result = await waitFor(() => (ready ? 'ok' : false), { timeoutMs: 500, intervalMs: 5 });
  assert.equal(result, 'ok');
});

test('waitFor rejects on timeout with a custom message', async () => {
  await assert.rejects(
    waitFor(() => false, { timeoutMs: 20, intervalMs: 5, message: 'never ready' }),
    /never ready/,
  );
});

test('waitFor supports async predicates', async () => {
  let n = 0;
  const result = await waitFor(async () => {
    n++;
    return n >= 3 ? n : 0;
  }, { intervalMs: 1 });
  assert.equal(result, 3);
});

test('mockFetch records calls and serves a single response', async () => {
  const fetch = mockFetch(jsonResponse({ ok: true }, 201));
  const res1 = await fetch('https://x/a', { method: 'POST' });
  const res2 = await fetch('https://x/b');
  assert.equal(res1.status, 201);
  assert.deepEqual(await res1.json(), { ok: true });
  assert.equal(res2.status, 201); // single response is cloned/reused
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[0].url, 'https://x/a');
  assert.equal(fetch.calls[0].init.method, 'POST');
  fetch.reset();
  assert.equal(fetch.calls.length, 0);
});

test('mockFetch accepts a handler function', async () => {
  const fetch = mockFetch((call) => new Response(call.url, { status: 200 }));
  const res = await fetch('https://x/echo');
  assert.equal(await res.text(), 'https://x/echo');
});

test('mockFetch serves an array of responses in sequence', async () => {
  const fetch = mockFetch([jsonResponse({}, 500), jsonResponse({}, 200)]);
  assert.equal((await fetch('https://x')).status, 500);
  assert.equal((await fetch('https://x')).status, 200);
  assert.equal((await fetch('https://x')).status, 200); // repeats last
});

test('sequential supports per-call handlers', async () => {
  const handler = sequential([(call) => new Response(call.url, { status: 200 })]);
  const res = await handler({ url: 'u', init: {} });
  assert.equal(await res.text(), 'u');
});

test('deepEqual compares primitives, arrays, objects, dates, and regexps', () => {
  assert.equal(deepEqual(1, 1), true);
  assert.equal(deepEqual('a', 'b'), false);
  assert.equal(deepEqual([1, [2, 3]], [1, [2, 3]]), true);
  assert.equal(deepEqual({ a: 1 }, { a: 1 }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(deepEqual([1], [1, 2]), false);
  assert.equal(deepEqual(new Date(5), new Date(5)), true);
  assert.equal(deepEqual(new Date(5), new Date(6)), false);
  assert.equal(deepEqual(/a/g, /a/g), true);
  assert.equal(deepEqual(/a/g, /a/i), false);
  assert.equal(deepEqual({ a: 1 }, [1]), false);
  assert.equal(deepEqual(null, {}), false);
});
