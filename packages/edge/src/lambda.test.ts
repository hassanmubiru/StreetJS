// packages/edge/src/lambda.test.ts
// Verifies the AWS Lambda adapter against synthetic API Gateway events
// (both HTTP API v2 and REST API v1 payload formats). No AWS required.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { streetApp } from '@streetjs/core';
import { createLambdaHandler, eventToRequest, type ApiGatewayProxyEvent } from './lambda.js';

function appWithRoutes() {
  const app = streetApp();
  app.use(async (ctx, next) => {
    if (ctx.path === '/ping') { ctx.json({ pong: true, method: ctx.method, q: ctx.query }); return; }
    if (ctx.path === '/echo') { ctx.json({ received: ctx.body }); return; }
    await next();
  });
  return app;
}

describe('Lambda adapter — HTTP API v2', () => {
  it('routes a GET event and returns a proxy result', async () => {
    const handler = createLambdaHandler(appWithRoutes());
    const event: ApiGatewayProxyEvent = {
      version: '2.0',
      rawPath: '/ping',
      rawQueryString: 'a=1',
      requestContext: { http: { method: 'GET', path: '/ping' } },
      headers: { host: 'api.example.com' },
    };
    const result = await handler(event);
    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body) as { pong: boolean; method: string; q: Record<string, string> };
    assert.equal(body.pong, true);
    assert.equal(body.method, 'GET');
    assert.equal(body.q['a'], '1');
    assert.match(result.headers['content-type'] ?? '', /application\/json/);
  });

  it('decodes a base64 POST body', async () => {
    const handler = createLambdaHandler(appWithRoutes());
    const event: ApiGatewayProxyEvent = {
      version: '2.0',
      rawPath: '/echo',
      requestContext: { http: { method: 'POST', path: '/echo' } },
      headers: { host: 'api.example.com', 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8').toString('base64'),
      isBase64Encoded: true,
    };
    const result = await handler(event);
    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body) as { received: { hello: string } };
    assert.equal(body.received.hello, 'world');
  });
});

describe('Lambda adapter — REST API v1', () => {
  it('routes a v1 event (httpMethod + path + queryStringParameters)', async () => {
    const handler = createLambdaHandler(appWithRoutes());
    const event: ApiGatewayProxyEvent = {
      httpMethod: 'GET',
      path: '/ping',
      queryStringParameters: { a: '2' },
      headers: { Host: 'rest.example.com' },
    };
    const result = await handler(event);
    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body) as { pong: boolean; q: Record<string, string> };
    assert.equal(body.pong, true);
    assert.equal(body.q['a'], '2');
  });

  it('returns 404 for an unknown route', async () => {
    const handler = createLambdaHandler(appWithRoutes());
    const result = await handler({ httpMethod: 'GET', path: '/nope', headers: {} });
    assert.equal(result.statusCode, 404);
  });
});

describe('eventToRequest', () => {
  it('builds an absolute URL from host + path + query', () => {
    const req = eventToRequest({ rawPath: '/x', rawQueryString: 'k=v', headers: { host: 'h.example' }, requestContext: { http: { method: 'GET' } } });
    assert.equal(new URL(req.url).pathname, '/x');
    assert.equal(new URL(req.url).searchParams.get('k'), 'v');
    assert.equal(req.method, 'GET');
  });
});
