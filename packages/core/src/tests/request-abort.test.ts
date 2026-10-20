import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { request } from 'node:http';

import { streetApp } from '../http/server.js';
import { createContainer } from '@streetjs/container';

function listen(app: ReturnType<typeof streetApp>): Promise<void> {
  return app.listen(0, '127.0.0.1');
}

test('HTTP/1 normal completion keeps signal active and cleans listeners', async () => {
  const app = streetApp();
  let observed: { signal: AbortSignal; req: import('node:http').IncomingMessage } | undefined;
  app.use(async (ctx) => {
    observed = { signal: ctx.signal, req: ctx.req };
    ctx.text('ok');
  });
  await listen(app);
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: address.port, path: '/' }, (res) => {
      res.resume();
      res.once('end', resolve);
    });
    req.once('error', reject);
    req.end();
  });
  assert.ok(observed);
  assert.equal(observed.signal.aborted, false);
  assert.equal(observed.req.listenerCount('aborted'), 0);
  assert.equal(observed.req.listenerCount('close'), 0);
  await app.close();
});

test('HTTP/1 client abort notifies cooperative handlers and disposes request scope', async () => {
  const app = streetApp({ container: createContainer(), containerOwnership: 'app', requestScope: true });
  const resourceToken = Symbol('request-resource');
  let disposed = 0;
  app.container.registerFactory(resourceToken, () => ({ dispose: () => { disposed++; } }), 'scoped');

  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  let aborted!: () => void;
  const requestAborted = new Promise<void>((resolve) => { aborted = resolve; });
  app.use(async (ctx) => {
    ctx.container?.resolve(resourceToken);
    started();
    if (ctx.signal.aborted) {
      aborted();
      return;
    }
    await new Promise<void>((resolve) => {
      ctx.signal.addEventListener('abort', () => { aborted(); resolve(); }, { once: true });
    });
  });

  await listen(app);
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const socket = connect(address.port, '127.0.0.1');
  socket.on('error', () => {});
  socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  await requestStarted;
  socket.destroy();
  await requestAborted;

  for (let i = 0; i < 20 && disposed === 0; i++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(disposed, 1);
  await app.close();
});
