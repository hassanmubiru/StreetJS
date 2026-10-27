import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { StreetWebSocketServer, type WsServerOptions } from '../server.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function harness(options: WsServerOptions) {
  const http = createServer();
  const server = new StreetWebSocketServer({ path: '/ws', ...options });
  let handled = 0;
  server.attach(http, () => { handled += 1; });
  server.attachProtocol(http, 'raw', () => { handled += 1; });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  assert.ok(address && typeof address === 'object');
  const clients: WebSocket[] = [];
  return {
    server,
    get handled() { return handled; },
    connect(protocol?: string) {
      const client = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, protocol);
      clients.push(client);
      const outcome = new Promise<number>((resolve) => {
        client.once('open', () => resolve(101));
        client.once('error', () => resolve(0));
        client.once('unexpected-response', (req, res) => {
          resolve(res.statusCode ?? 0);
          res.resume();
          req.destroy();
        });
      });
      return { client, outcome };
    },
    async close() {
      for (const client of clients) client.terminate();
      await server.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

for (const protocol of [undefined, 'raw']) {
  test(`admission reserves active capacity before auth (${protocol ?? 'default'})`, { timeout: 5000 }, async () => {
    const entered = deferred<void>();
    const auth = deferred<boolean>();
    let authCalls = 0;
    const h = await harness({
      maxConnections: 1,
      maxPendingUpgrades: 4,
      authFn: () => { authCalls += 1; entered.resolve(); return auth.promise; },
    });
    try {
      const first = h.connect(protocol);
      await entered.promise;
      // Reservations are shared across default and custom subprotocol traffic.
      assert.equal(await h.connect(protocol ? undefined : 'raw').outcome, 503);
      assert.equal(authCalls, 1);
      auth.resolve(true);
      assert.equal(await first.outcome, 101);
      assert.equal(await h.connect(protocol).outcome, 503);
      assert.equal(h.server.connectionCount, 1);
      assert.equal(h.handled, 1);
      assert.equal(authCalls, 1);
    } finally {
      auth.resolve(false);
      await h.close();
    }
  });

  test(`admission releases failed auth reservations (${protocol ?? 'default'})`, { timeout: 5000 }, async () => {
    const entered = deferred<void>();
    const auth = deferred<boolean>();
    let authCalls = 0;
    const h = await harness({
      maxConnections: 10,
      maxPendingUpgrades: 1,
      authFn: () => {
        authCalls += 1;
        if (authCalls === 1) { entered.resolve(); return auth.promise; }
        return true;
      },
    });
    try {
      const first = h.connect(protocol);
      await entered.promise;
      assert.equal(await h.connect(protocol).outcome, 503);
      auth.resolve(false);
      assert.equal(await first.outcome, 401);
      assert.equal(await h.connect(protocol).outcome, 101);
      assert.equal(authCalls, 2);
      assert.equal(h.handled, 1);
    } finally {
      auth.resolve(false);
      await h.close();
    }
  });

  test(`admission times out slow auth and ignores late acceptance (${protocol ?? 'default'})`, { timeout: 5000 }, async () => {
    const auth = deferred<boolean>();
    const h = await harness({ maxPendingUpgrades: 1, upgradeTimeoutMs: 30, authFn: () => auth.promise });
    try {
      assert.equal(await h.connect(protocol).outcome, 0);
      // The still-running auth call retains its budget even after socket expiry.
      assert.equal(await h.connect(protocol).outcome, 503);
      auth.resolve(true);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(h.handled, 0);
      assert.equal(await h.connect(protocol).outcome, 101);
      assert.equal(h.handled, 1);
    } finally {
      auth.resolve(false);
      await h.close();
    }
  });

  test(`shutdown cancels pending upgrade sockets (${protocol ?? 'default'})`, { timeout: 5000 }, async () => {
    const entered = deferred<void>();
    const auth = deferred<boolean>();
    const h = await harness({
      maxPendingUpgrades: 1,
      authFn: () => { entered.resolve(); return auth.promise; },
    });
    try {
      const first = h.connect(protocol);
      await entered.promise;
      await h.server.close();
      assert.equal(await first.outcome, 0);
      auth.resolve(true);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(h.handled, 0);
      assert.equal(h.server.connectionCount, 0);
    } finally {
      auth.resolve(false);
      await h.close();
    }
  });
}
