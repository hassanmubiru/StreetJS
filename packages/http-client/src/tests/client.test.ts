import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HttpClient } from '../client.js';
import { HttpError } from '../errors.js';
import type { FetchLike, HttpRequest } from '../types.js';

interface Recorded {
  url: string;
  init: RequestInit;
}

/** A fake fetch that returns queued responses and records requests. No network. */
function fakeFetch(responses: Array<Response | (() => Response) | Error>): {
  fetch: FetchLike;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    if (next instanceof Error) {
      throw next;
    }
    return typeof next === 'function' ? next() : next;
  };
  return { fetch, calls };
}

const noSleep = async (): Promise<void> => {};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

test('GET resolves base URL + query and parses JSON', async () => {
  const { fetch, calls } = fakeFetch([jsonResponse({ ok: true })]);
  const client = new HttpClient({ baseUrl: 'https://api.test/v1', fetch, sleep: noSleep });
  const res = await client.get('/users', { query: { page: 2, tags: ['a', 'b'] } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json(), { ok: true });
  assert.equal(calls[0].url, 'https://api.test/v1/users?page=2&tags=a&tags=b');
  assert.equal(calls[0].init.method, 'GET');
});

test('POST JSON-encodes an object body and sets content-type', async () => {
  const { fetch, calls } = fakeFetch([jsonResponse({ id: 1 }, 201)]);
  const client = new HttpClient({ baseUrl: 'https://api.test', fetch, sleep: noSleep });
  const res = await client.post('/users', { name: 'Ada' });
  assert.equal(res.status, 201);
  assert.equal(calls[0].init.body, JSON.stringify({ name: 'Ada' }));
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers['content-type'], 'application/json');
});

test('string bodies pass through without forcing content-type', async () => {
  const { fetch, calls } = fakeFetch([new Response('ok')]);
  const client = new HttpClient({ fetch, sleep: noSleep });
  await client.post('https://api.test/raw', 'plain-text');
  assert.equal(calls[0].init.body, 'plain-text');
  const headers = (calls[0].init.headers as Record<string, string>) ?? {};
  assert.equal(headers['content-type'], undefined);
});

test('explicit json option is honored', async () => {
  const { fetch, calls } = fakeFetch([new Response('{}')]);
  const client = new HttpClient({ fetch, sleep: noSleep });
  await client.request('PUT', 'https://api.test/x', { json: { a: 1 } });
  assert.equal(calls[0].init.body, '{"a":1}');
});

test('non-2xx throws HttpError by default with the response attached', async () => {
  const { fetch } = fakeFetch([jsonResponse({ error: 'nope' }, 404)]);
  const client = new HttpClient({ fetch, sleep: noSleep, retry: { retries: 0 } });
  await assert.rejects(
    client.get('https://api.test/missing'),
    (err: unknown) =>
      err instanceof HttpError && err.kind === 'status' && err.status === 404 &&
      (err.response?.json() as { error: string }).error === 'nope',
  );
});

test('throwOnError:false returns the error response instead of throwing', async () => {
  const { fetch } = fakeFetch([jsonResponse({ error: 'nope' }, 500)]);
  const client = new HttpClient({ fetch, sleep: noSleep, retry: { retries: 0 }, throwOnError: false });
  const res = await client.get('https://api.test/x');
  assert.equal(res.status, 500);
  assert.equal(res.ok, false);
});

test('retries retriable statuses for idempotent methods and then succeeds', async () => {
  const { fetch, calls } = fakeFetch([
    jsonResponse({}, 503),
    jsonResponse({}, 503),
    jsonResponse({ ok: 1 }, 200),
  ]);
  const client = new HttpClient({ fetch, sleep: noSleep, retry: { retries: 3, jitter: false } });
  const res = await client.get('https://api.test/x');
  assert.equal(res.status, 200);
  assert.equal(calls.length, 3);
});

test('does not retry non-idempotent POST by default', async () => {
  const { fetch, calls } = fakeFetch([jsonResponse({}, 503), jsonResponse({}, 200)]);
  const client = new HttpClient({ fetch, sleep: noSleep, retry: { retries: 3 }, throwOnError: false });
  const res = await client.post('https://api.test/x', { a: 1 });
  assert.equal(res.status, 503);
  assert.equal(calls.length, 1);
});

test('retries network errors then gives up with a network HttpError', async () => {
  const { fetch, calls } = fakeFetch([new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET')]);
  const client = new HttpClient({ fetch, sleep: noSleep, retry: { retries: 2, jitter: false } });
  await assert.rejects(
    client.get('https://api.test/x'),
    (err: unknown) => err instanceof HttpError && err.kind === 'network',
  );
  assert.equal(calls.length, 3);
});

test('respects Retry-After header (seconds) when computing delay', async () => {
  const delays: number[] = [];
  const { fetch } = fakeFetch([jsonResponse({}, 429, { 'retry-after': '1' }), jsonResponse({ ok: 1 }, 200)]);
  const client = new HttpClient({
    fetch,
    sleep: async (ms) => {
      delays.push(ms);
    },
    retry: { retries: 2 },
  });
  await client.get('https://api.test/x');
  assert.equal(delays[0], 1000);
});

test('request interceptors can add headers', async () => {
  const { fetch, calls } = fakeFetch([new Response('{}')]);
  const client = new HttpClient({
    fetch,
    sleep: noSleep,
    onRequest: [
      (req: HttpRequest) => {
        req.headers['authorization'] = 'Bearer t';
        return req;
      },
    ],
  });
  await client.get('https://api.test/x');
  assert.equal((calls[0].init.headers as Record<string, string>)['authorization'], 'Bearer t');
});

test('response interceptors can observe responses', async () => {
  const seen: number[] = [];
  const { fetch } = fakeFetch([jsonResponse({}, 200)]);
  const client = new HttpClient({
    fetch,
    sleep: noSleep,
    onResponse: [
      (res) => {
        seen.push(res.status);
      },
    ],
  });
  await client.get('https://api.test/x');
  assert.deepEqual(seen, [200]);
});

test('a caller abort signal produces an aborted error and is not retried', async () => {
  const controller = new AbortController();
  const fetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      if (signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  const client = new HttpClient({ fetch, sleep: noSleep, retry: { retries: 3 } });
  const promise = client.get('https://api.test/x', { signal: controller.signal });
  controller.abort();
  await assert.rejects(promise, (err: unknown) => err instanceof HttpError && err.kind === 'aborted');
});

test('an already-aborted signal fails immediately', async () => {
  const fetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      if ((init.signal as AbortSignal).aborted) {
        reject(new Error('aborted'));
      }
    });
  const client = new HttpClient({ fetch, sleep: noSleep });
  await assert.rejects(
    client.get('https://api.test/x', { signal: AbortSignal.abort() }),
    (err: unknown) => err instanceof HttpError && err.kind === 'aborted',
  );
});

test('convenience methods issue the right verbs', async () => {
  const { fetch, calls } = fakeFetch([new Response('{}'), () => new Response('{}')]);
  const client = new HttpClient({ baseUrl: 'https://api.test', fetch, sleep: noSleep });
  await client.delete('/a');
  await client.head('/b');
  await client.options('/c');
  await client.put('/d', { x: 1 });
  await client.patch('/e', { y: 2 });
  assert.deepEqual(
    calls.map((c) => c.init.method),
    ['DELETE', 'HEAD', 'OPTIONS', 'PUT', 'PATCH'],
  );
  assert.equal(calls[3].init.body, '{"x":1}');
});

test('an explicit content-type is not overwritten for json bodies', async () => {
  const { fetch, calls } = fakeFetch([new Response('{}')]);
  const client = new HttpClient({ fetch, sleep: noSleep });
  await client.post('https://api.test/x', { a: 1 }, { headers: { 'content-type': 'application/vnd.api+json' } });
  assert.equal((calls[0].init.headers as Record<string, string>)['content-type'], 'application/vnd.api+json');
});

test('a request that exceeds its timeout fails with a timeout error', async () => {
  const fetch: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      (init.signal as AbortSignal).addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  const client = new HttpClient({ fetch, sleep: noSleep, timeoutMs: 10, retry: { retries: 0 } });
  await assert.rejects(
    client.get('https://api.test/slow'),
    (err: unknown) => err instanceof HttpError && err.kind === 'timeout',
  );
});

test('throws when no fetch is available', () => {
  const original = globalThis.fetch;
  // @ts-expect-error force-remove for the test
  delete globalThis.fetch;
  try {
    assert.throws(() => new HttpClient(), /No fetch implementation/);
  } finally {
    globalThis.fetch = original;
  }
});
