import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FetchWebhookTransport } from '../transport.js';

test('FetchWebhookTransport POSTs the request and returns the status', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport = new FetchWebhookTransport({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response('', { status: 202 });
    },
  });
  const res = await transport.send({
    url: 'https://c.test/h',
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
  });
  assert.equal(res.status, 202);
  assert.equal(calls[0].url, 'https://c.test/h');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{"a":1}');
});

test('FetchWebhookTransport aborts on timeout', async () => {
  const transport = new FetchWebhookTransport({
    timeoutMs: 10,
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        if (signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
  });
  await assert.rejects(
    transport.send({ url: 'https://c.test/slow', headers: {}, body: '' }),
    /aborted/,
  );
});

test('throws when no fetch is available', () => {
  const original = globalThis.fetch;
  // @ts-expect-error force-remove for the test
  delete globalThis.fetch;
  try {
    assert.throws(() => new FetchWebhookTransport(), /No fetch implementation/);
  } finally {
    globalThis.fetch = original;
  }
});
