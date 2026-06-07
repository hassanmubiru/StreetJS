// packages/edge/src/cloud-adapters.test.ts
// Verifies the Azure Functions and Google Cloud Functions adapters against
// synthetic request shapes. No cloud runtime required.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { streetApp } from '@streetjs/core';
import { createAzureHandler, type AzureHttpRequest } from './azure.js';
import { createGcfHandler, type GcfRequest, type GcfResponse } from './gcf.js';

function appWithRoutes() {
  const app = streetApp();
  app.use(async (ctx, next) => {
    if (ctx.path === '/ping') { ctx.json({ pong: true, method: ctx.method, q: ctx.query }); return; }
    if (ctx.path === '/echo') { ctx.json({ received: ctx.body }); return; }
    await next();
  });
  return app;
}

describe('Azure Functions adapter', () => {
  it('routes a GET request and returns an HttpResponseInit', async () => {
    const handler = createAzureHandler(appWithRoutes());
    const req: AzureHttpRequest = {
      method: 'GET',
      url: 'https://func.azurewebsites.net/ping?a=1',
      headers: { host: 'func.azurewebsites.net' },
    };
    const res = await handler(req);
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body) as { pong: boolean; method: string; q: Record<string, string> };
    assert.equal(body.pong, true);
    assert.equal(body.q['a'], '1');
  });

  it('forwards a POST body', async () => {
    const handler = createAzureHandler(appWithRoutes());
    const req: AzureHttpRequest = {
      method: 'POST',
      url: 'https://func.azurewebsites.net/echo',
      headers: { 'content-type': 'application/json' },
      text: async () => JSON.stringify({ hello: 'azure' }),
    };
    const res = await handler(req);
    const body = JSON.parse(res.body) as { received: { hello: string } };
    assert.equal(body.received.hello, 'azure');
  });

  it('returns 404 for unknown routes', async () => {
    const handler = createAzureHandler(appWithRoutes());
    const res = await handler({ method: 'GET', url: 'https://x/none', headers: {} });
    assert.equal(res.status, 404);
  });
});

describe('Google Cloud Functions adapter', () => {
  function fakeRes() {
    const captured = { status: 0, headers: {} as Record<string, string>, body: '' };
    const res: GcfResponse = {
      status(c) { captured.status = c; return res; },
      set(n, v) { captured.headers[n] = v; return res; },
      send(b) { captured.body = b; },
    };
    return { res, captured };
  }

  it('routes a GET request and writes the response', async () => {
    const handler = createGcfHandler(appWithRoutes());
    const { res, captured } = fakeRes();
    const req: GcfRequest = { method: 'GET', url: '/ping?a=2', headers: { host: 'gcf.example' } };
    await handler(req, res);
    assert.equal(captured.status, 200);
    const body = JSON.parse(captured.body) as { pong: boolean; q: Record<string, string> };
    assert.equal(body.pong, true);
    assert.equal(body.q['a'], '2');
    assert.match(captured.headers['content-type'] ?? '', /application\/json/);
  });

  it('forwards a JSON body (object form)', async () => {
    const handler = createGcfHandler(appWithRoutes());
    const { res, captured } = fakeRes();
    const req: GcfRequest = { method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, body: { hello: 'gcf' } };
    await handler(req, res);
    const body = JSON.parse(captured.body) as { received: { hello: string } };
    assert.equal(body.received.hello, 'gcf');
  });

  it('returns 404 for unknown routes', async () => {
    const handler = createGcfHandler(appWithRoutes());
    const { res, captured } = fakeRes();
    await handler({ method: 'GET', url: '/none', headers: {} }, res);
    assert.equal(captured.status, 404);
  });
});
