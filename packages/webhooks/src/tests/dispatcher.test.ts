import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WebhookDispatcher, buildEnvelope, HEADER_SIGNATURE, HEADER_ID } from '../dispatcher.js';
import { verifySignature } from '../signature.js';
import { WEBHOOK_DISPATCHER } from '../index.js';
import type { DeliveryRequest, WebhookTransport } from '../types.js';

function recordingTransport(statuses: Array<number | Error>): {
  transport: WebhookTransport;
  requests: DeliveryRequest[];
} {
  const requests: DeliveryRequest[] = [];
  let i = 0;
  const transport: WebhookTransport = {
    async send(request) {
      requests.push(request);
      const next = statuses[Math.min(i, statuses.length - 1)];
      i++;
      if (next instanceof Error) {
        throw next;
      }
      return { status: next };
    },
  };
  return { transport, requests };
}

const noSleep = async (): Promise<void> => {};
const endpoint = { url: 'https://consumer.test/hooks', secret: 'whsec_1' };

test('a 2xx delivery succeeds on the first attempt', async () => {
  const { transport, requests } = recordingTransport([200]);
  const d = new WebhookDispatcher({ transport, sleep: noSleep, clock: () => 1_000_000 });
  const result = await d.dispatch(endpoint, { id: 'evt_1', type: 'user.created', data: { id: 7 } });
  assert.equal(result.delivered, true);
  assert.equal(result.attempts, 1);
  assert.equal(result.status, 200);
  assert.equal(result.id, 'evt_1');
  assert.equal(requests.length, 1);
});

test('the delivered request carries signature/id/event headers and a signed body', async () => {
  const { transport, requests } = recordingTransport([200]);
  const d = new WebhookDispatcher({ transport, sleep: noSleep, clock: () => 1_000_000 });
  await d.dispatch(endpoint, { id: 'evt_2', type: 'order.paid', data: { total: 10 }, created: 1000 });
  const req = requests[0];
  assert.equal(req.headers[HEADER_ID], 'evt_2');
  assert.equal(req.headers['webhook-event'], 'order.paid');
  assert.equal(req.headers['content-type'], 'application/json');

  // The signature on the delivered body verifies with the endpoint secret.
  const verify = verifySignature(req.body, req.headers[HEADER_SIGNATURE], endpoint.secret, { now: 1000 });
  assert.equal(verify.valid, true);
  assert.deepEqual(JSON.parse(req.body), { id: 'evt_2', type: 'order.paid', created: 1000, data: { total: 10 } });
});

test('endpoint headers are merged', async () => {
  const { transport, requests } = recordingTransport([200]);
  const d = new WebhookDispatcher({ transport, sleep: noSleep });
  await d.dispatch({ ...endpoint, headers: { 'x-tenant': 'acme' } }, { type: 't', data: {} });
  assert.equal(requests[0].headers['x-tenant'], 'acme');
});

test('a missing event id is generated (uuid)', async () => {
  const { transport } = recordingTransport([200]);
  const d = new WebhookDispatcher({ transport, sleep: noSleep });
  const result = await d.dispatch(endpoint, { type: 't', data: {} });
  assert.match(result.id, /^[0-9a-f-]{36}$/);
});

test('retries a 5xx then succeeds', async () => {
  const { transport, requests } = recordingTransport([500, 503, 200]);
  const d = new WebhookDispatcher({ transport, sleep: noSleep, retries: 3 });
  const result = await d.dispatch(endpoint, { type: 't', data: {} });
  assert.equal(result.delivered, true);
  assert.equal(result.attempts, 3);
  assert.equal(requests.length, 3);
});

test('gives up after exhausting retries on persistent failure', async () => {
  const { transport, requests } = recordingTransport([500]);
  const d = new WebhookDispatcher({ transport, sleep: noSleep, retries: 2 });
  const result = await d.dispatch(endpoint, { type: 't', data: {} });
  assert.equal(result.delivered, false);
  assert.equal(result.attempts, 3);
  assert.equal(result.status, 500);
  assert.equal(requests.length, 3);
});

test('retries transport errors then reports the error', async () => {
  const { transport } = recordingTransport([new Error('ECONNREFUSED')]);
  const d = new WebhookDispatcher({ transport, sleep: noSleep, retries: 1 });
  const result = await d.dispatch(endpoint, { type: 't', data: {} });
  assert.equal(result.delivered, false);
  assert.equal(result.attempts, 2);
  assert.equal(result.error, 'ECONNREFUSED');
});

test('uses the default real timer when no sleep is injected', async () => {
  // No `sleep` injected → exercises the built-in unref'd timer with a 0ms backoff.
  const { transport } = recordingTransport([500, 200]);
  const d = new WebhookDispatcher({ transport, retries: 1, baseDelayMs: 0 });
  const result = await d.dispatch(endpoint, { type: 't', data: {} });
  assert.equal(result.delivered, true);
  assert.equal(result.attempts, 2);
});

test('buildEnvelope produces a stable, ordered JSON envelope', () => {
  const body = buildEnvelope({ type: 'a', data: { x: 1 } }, 'id1', 42);
  assert.equal(body, '{"id":"id1","type":"a","created":42,"data":{"x":1}}');
});

test('DI token is a stable global symbol', () => {
  assert.equal(WEBHOOK_DISPATCHER, Symbol.for('@streetjs/webhooks:Dispatcher'));
});
