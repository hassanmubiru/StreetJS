import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveUrl, appendQuery, buildQueryString, isAbsoluteUrl } from '../url.js';
import {
  DEFAULT_RETRY_POLICY,
  resolveRetryPolicy,
  isRetriableMethod,
  isRetriableStatus,
  computeBackoff,
  parseRetryAfter,
} from '../retry.js';
import { HttpResponse } from '../response.js';
import { HTTP_CLIENT } from '../index.js';

test('isAbsoluteUrl detects schemes', () => {
  assert.equal(isAbsoluteUrl('https://x/y'), true);
  assert.equal(isAbsoluteUrl('http://x'), true);
  assert.equal(isAbsoluteUrl('/relative'), false);
});

test('resolveUrl joins base and path, honoring absolute paths', () => {
  assert.equal(resolveUrl('https://x/v1/', '/users'), 'https://x/v1/users');
  assert.equal(resolveUrl('https://x/v1', 'users'), 'https://x/v1/users');
  assert.equal(resolveUrl('https://x/v1', ''), 'https://x/v1');
  assert.equal(resolveUrl('https://x', 'https://y/z'), 'https://y/z');
  assert.equal(resolveUrl(undefined, '/only-path'), '/only-path');
});

test('buildQueryString encodes and repeats arrays; skips nullish', () => {
  assert.equal(buildQueryString({ a: 1, b: 'x y', c: [1, 2], d: null, e: undefined }), 'a=1&b=x%20y&c=1&c=2');
  assert.equal(buildQueryString({}), '');
});

test('appendQuery preserves an existing query string', () => {
  assert.equal(appendQuery('https://x/y', { a: 1 }), 'https://x/y?a=1');
  assert.equal(appendQuery('https://x/y?z=1', { a: 1 }), 'https://x/y?z=1&a=1');
  assert.equal(appendQuery('https://x/y', undefined), 'https://x/y');
  assert.equal(appendQuery('https://x/y', {}), 'https://x/y');
});

test('retry policy defaults and merge', () => {
  assert.equal(DEFAULT_RETRY_POLICY.retries, 2);
  const p = resolveRetryPolicy({ retries: 5, jitter: false });
  assert.equal(p.retries, 5);
  assert.equal(p.jitter, false);
  assert.equal(p.baseDelayMs, 100);
});

test('retriable method/status checks', () => {
  const p = resolveRetryPolicy();
  assert.equal(isRetriableMethod('GET', p), true);
  assert.equal(isRetriableMethod('POST', p), false);
  assert.equal(isRetriableStatus(503, p), true);
  assert.equal(isRetriableStatus(400, p), false);
});

test('computeBackoff doubles and caps; jitter bounds the result', () => {
  const p = resolveRetryPolicy({ jitter: false, baseDelayMs: 100, maxDelayMs: 1000 });
  assert.equal(computeBackoff(0, p), 100);
  assert.equal(computeBackoff(1, p), 200);
  assert.equal(computeBackoff(2, p), 400);
  assert.equal(computeBackoff(10, p), 1000); // capped
  const jittered = resolveRetryPolicy({ jitter: true, baseDelayMs: 100, maxDelayMs: 1000 });
  const v = computeBackoff(2, jittered, () => 0.5);
  assert.equal(v, 200); // floor(400 * 0.5)
});

test('parseRetryAfter handles seconds, dates, and invalid input', () => {
  assert.equal(parseRetryAfter('2', 0), 2000);
  assert.equal(parseRetryAfter(undefined, 0), undefined);
  assert.equal(parseRetryAfter('not-a-date', 0), undefined);
  const now = Date.parse('2020-01-01T00:00:00Z');
  assert.equal(parseRetryAfter('Wed, 01 Jan 2020 00:00:05 GMT', now), 5000);
  assert.equal(parseRetryAfter('Wed, 01 Jan 2020 00:00:00 GMT', now + 10_000), undefined); // past
});

test('HttpResponse buffers body for repeat reads', async () => {
  const res = await HttpResponse.fromFetch(new Response('{"a":1}', { status: 200, headers: { 'x-test': '1' } }));
  assert.equal(res.ok, true);
  assert.equal(res.headers['x-test'], '1');
  assert.deepEqual(res.json(), { a: 1 });
  assert.equal(res.text(), '{"a":1}');
  assert.equal(res.bytes().length, 7);
});

test('HttpResponse.json returns undefined for an empty body', async () => {
  const res = await HttpResponse.fromFetch(new Response('', { status: 204 }));
  assert.equal(res.json(), undefined);
});

test('DI token is a stable global symbol', () => {
  assert.equal(HTTP_CLIENT, Symbol.for('@streetjs/http-client:Client'));
});
