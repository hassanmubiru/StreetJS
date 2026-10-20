import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';

import { streetApp } from '../http/server.js';
import { streetHttp2App } from '../microservices/http2.js';

test('HTTP/1 application has deterministic lifecycle transitions and idempotent close', async () => {
  const app = streetApp();
  assert.equal(app.lifecycleState, 'CREATED');

  const firstClose = app.close();
  const secondClose = app.close();
  assert.equal(firstClose, secondClose);
  await firstClose;
  assert.equal(app.lifecycleState, 'CLOSED');
  await app.close();
  await assert.rejects(app.listen(0, '127.0.0.1'), /Cannot listen while application is CLOSED/);
});

test('HTTP/1 concurrent listen calls share startup and close drains an active request', async () => {
  const app = streetApp();
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    release = resolve;
  });
  let handlerEntered!: () => void;
  const handlerStarted = new Promise<void>((resolve) => { handlerEntered = resolve; });
  app.use(async (_ctx, next) => {
    handlerEntered();
    await entered;
    await next();
  });

  const listenA = app.listen(0, '127.0.0.1');
  const listenB = app.listen(0, '127.0.0.1');
  assert.equal(listenA, listenB);
  await listenA;
  assert.equal(app.lifecycleState, 'RUNNING');
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const response = new Promise<void>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: address.port, path: '/', headers: { connection: 'close' } }, (res) => {
      res.resume();
      res.once('end', resolve);
    });
    req.once('error', reject);
    req.end();
  });
  await handlerStarted;
  const close = app.close();
  assert.equal(app.lifecycleState, 'DRAINING');
  release();
  await response;
  await close;
  assert.equal(app.lifecycleState, 'CLOSED');
});

test('HTTP/2 application follows the same pre-listen and concurrent-close contract', async () => {
  const app = streetHttp2App();
  assert.equal(app.lifecycleState, 'CREATED');
  const firstClose = app.close();
  const secondClose = app.close();
  assert.equal(firstClose, secondClose);
  await firstClose;
  assert.equal(app.lifecycleState, 'CLOSED');
  await assert.rejects(app.listen(0, '127.0.0.1'), /Cannot listen while application is CLOSED/);
});

test('application shutdown preserves cleanup failure and remains in DRAINING', async () => {
  class BrokenResource {
    close(): void { throw new Error('resource close failed'); }
  }
  const app = streetApp({ containerOwnership: 'app' });
  app.container.register(BrokenResource, new BrokenResource());
  const firstClose = app.close();
  const secondClose = app.close();
  assert.equal(firstClose, secondClose);
  await assert.rejects(firstClose, /resource close failed/);
  assert.equal(app.lifecycleState, 'DRAINING');
});

test('close during failed startup preserves the startup error', async () => {
  const app = streetApp();
  const occupied = streetApp();
  await occupied.listen(0, '127.0.0.1');
  const address = occupied.server.address();
  assert.ok(address && typeof address !== 'string');
  const starting = app.listen(address.port, '127.0.0.1');
  const isAddressInUse = (error: unknown): boolean =>
    error instanceof Error && (error as Error & { code?: string }).code === 'EADDRINUSE';
  await assert.rejects(app.close(), isAddressInUse);
  await assert.rejects(starting, isAddressInUse);
  assert.equal(app.lifecycleState, 'CLOSED');
  await occupied.close();
});
