import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  HttpConnector,
  IntegrationError,
  IntegrationRequestError,
  hmacHex,
  timingSafeCompare,
  verifyHmacSignature,
  type FetchLike,
  type HttpResponseLike,
} from '../index.js';

function res(status: number, body: string): HttpResponseLike {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

/** Records requests and replays scripted responses (or a per-call handler). */
function stub(handler: (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => HttpResponseLike) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
  const fetch: FetchLike = async (url, init) => { calls.push({ url, init }); return handler(url, init); };
  return { fetch, calls };
}

const noSleep = async () => {};

// ── HttpConnector ────────────────────────────────────────────────────────────

test('request builds URL + query, applies bearer auth, and parses JSON', async () => {
  const s = stub(() => res(200, JSON.stringify({ ok: true, items: [1, 2] })));
  const client = new HttpConnector({ baseUrl: 'https://api.x.com/', auth: { type: 'bearer', token: 't0ken' }, fetch: s.fetch });
  const out = await client.request<{ ok: boolean; items: number[] }>('/things', { query: { limit: 2, active: true, skip: undefined } });
  assert.deepEqual(out, { ok: true, items: [1, 2] });
  assert.equal(s.calls[0]!.url, 'https://api.x.com/things?limit=2&active=true', 'undefined query dropped, no double slash');
  assert.equal(s.calls[0]!.init.headers['authorization'], 'Bearer t0ken');
  assert.equal(s.calls[0]!.init.headers['accept'], 'application/json');
});

test('request serializes a JSON body and sets content-type; header auth works', async () => {
  const s = stub(() => res(201, '{"id":"1"}'));
  const client = new HttpConnector({ baseUrl: 'https://api.x.com', auth: { type: 'header', name: 'X-Api-Key', value: 'k' }, fetch: s.fetch });
  await client.request('/create', { method: 'POST', body: { name: 'a' } });
  const init = s.calls[0]!.init;
  assert.equal(init.method, 'POST');
  assert.equal(init.body, '{"name":"a"}');
  assert.equal(init.headers['content-type'], 'application/json');
  assert.equal(init.headers['x-api-key'], 'k');
});

test('request passes a raw string body through without a content-type', async () => {
  const s = stub(() => res(200, ''));
  const client = new HttpConnector({ baseUrl: 'https://api.x.com', fetch: s.fetch });
  await client.request('/raw', { method: 'POST', body: 'plain' });
  assert.equal(s.calls[0]!.init.body, 'plain');
  assert.equal(s.calls[0]!.init.headers['content-type'], undefined);
});

test('a non-2xx response throws IntegrationRequestError with status + body', async () => {
  const s = stub(() => res(404, 'not found'));
  const client = new HttpConnector({ baseUrl: 'https://api.x.com', fetch: s.fetch, retries: 0 });
  await assert.rejects(() => client.request('/missing'), (err: unknown) => {
    assert.ok(err instanceof IntegrationRequestError);
    assert.equal((err as IntegrationRequestError).status, 404);
    assert.match((err as IntegrationRequestError).body, /not found/);
    return true;
  });
});

test('GET retries on 5xx then succeeds; retries are bounded', async () => {
  let n = 0;
  const s = stub(() => { n++; return n < 3 ? res(503, 'down') : res(200, '{"ok":true}'); });
  const client = new HttpConnector({ baseUrl: 'https://api.x.com', fetch: s.fetch, retries: 3, sleep: noSleep });
  const out = await client.request<{ ok: boolean }>('/thing');
  assert.deepEqual(out, { ok: true });
  assert.equal(n, 3, 'two failures + one success');
});

test('non-idempotent POST does not retry on 5xx', async () => {
  let n = 0;
  const s = stub(() => { n++; return res(500, 'boom'); });
  const client = new HttpConnector({ baseUrl: 'https://api.x.com', fetch: s.fetch, retries: 5, sleep: noSleep });
  await assert.rejects(() => client.request('/create', { method: 'POST' }), IntegrationRequestError);
  assert.equal(n, 1, 'POST attempted once');
});

test('a network error on GET retries then surfaces an IntegrationError', async () => {
  let n = 0;
  const fetch: FetchLike = async () => { n++; throw new Error('ECONNRESET'); };
  const client = new HttpConnector({ baseUrl: 'https://api.x.com', fetch, retries: 2, sleep: noSleep });
  await assert.rejects(() => client.request('/x'), (err: unknown) => {
    assert.ok(err instanceof IntegrationError);
    assert.match((err as Error).message, /ECONNRESET/);
    return true;
  });
  assert.equal(n, 3, 'initial + 2 retries');
});

test('an empty success body yields undefined; non-JSON success returns the raw text', async () => {
  const empty = new HttpConnector({ baseUrl: 'https://api.x.com', fetch: stub(() => res(204, '')).fetch });
  assert.equal(await empty.request('/no-content'), undefined);
  const raw = new HttpConnector({ baseUrl: 'https://api.x.com', fetch: stub(() => res(200, 'pong')).fetch });
  assert.equal(await raw.request('/ping'), 'pong');
});

test('constructing without a baseUrl throws', () => {
  assert.throws(() => new HttpConnector({ baseUrl: '' }), IntegrationError);
});

// ── Webhook verification ────────────────────────────────────────────────────

test('hmacHex + timingSafeCompare + verifyHmacSignature (GitHub-style prefix)', () => {
  const secret = 's3cr3t';
  const payload = '{"action":"opened"}';
  const digest = createHmac('sha256', secret).update(payload).digest('hex');

  assert.equal(hmacHex('sha256', secret, payload), digest);
  assert.equal(timingSafeCompare('abc', 'abc'), true);
  assert.equal(timingSafeCompare('abc', 'abd'), false);
  assert.equal(timingSafeCompare('abc', 'abcd'), false, 'length mismatch → false');

  assert.equal(verifyHmacSignature({ algorithm: 'sha256', secret, payload, signature: `sha256=${digest}`, prefix: 'sha256=' }), true);
  assert.equal(verifyHmacSignature({ algorithm: 'sha256', secret, payload, signature: digest }), true, 'no prefix needed');
  assert.equal(verifyHmacSignature({ algorithm: 'sha256', secret: 'wrong', payload, signature: digest }), false);
});
