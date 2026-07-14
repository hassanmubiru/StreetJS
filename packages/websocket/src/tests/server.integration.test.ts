import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';

import { StreetWebSocketServer } from '../server.js';

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

function once<T = unknown>(emitter: { once(e: string, cb: (arg: T) => void): unknown }, event: string): Promise<T> {
  return new Promise((resolve) => emitter.once(event, resolve));
}

test('attach: echo round-trip over a real client', async () => {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws' });
  wss.attach(server, (socket) => {
    socket.on('ping', (p) => socket.emit('pong', p));
  });
  const port = await listen(server);

  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await once(client, 'open');
  const message = once<Buffer>(client, 'message');
  client.send(JSON.stringify({ type: 'ping', payload: { n: 1 }, ts: 0 }));
  const msg = JSON.parse((await message).toString());
  assert.equal(msg.type, 'pong');
  assert.deepEqual(msg.payload, { n: 1 });

  client.close();
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('broadcast reaches all clients and connectionCount tracks them', async () => {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws' });
  wss.attach(server, () => {});
  const port = await listen(server);

  const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await Promise.all([once(a, 'open'), once(b, 'open')]);
  await new Promise((r) => setTimeout(r, 20)); // let 'connection' handlers register
  assert.equal(wss.connectionCount, 2);

  const ma = once<Buffer>(a, 'message');
  const mb = once<Buffer>(b, 'message');
  wss.broadcast('news', { headline: 'hi' });
  const [da, db] = await Promise.all([ma, mb]);
  assert.equal(JSON.parse(da.toString()).type, 'news');
  assert.equal(JSON.parse(db.toString()).type, 'news');

  a.close();
  b.close();
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('server socket onClose fires when the client disconnects', async () => {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws' });
  let closed = false;
  const gotClose = new Promise<void>((resolve) => {
    wss.attach(server, (socket) => {
      socket.onClose(() => {
        closed = true;
        resolve();
      });
    });
  });
  const port = await listen(server);
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await once(client, 'open');
  client.close();
  await gotClose;
  assert.equal(closed, true);
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('a disallowed Origin is rejected with 403 before upgrade', async () => {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws' });
  wss.attach(server, () => {});
  const port = await listen(server);

  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: 'http://evil.example' });
  const status = await new Promise<number>((resolve) => {
    client.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    client.on('error', () => {});
  });
  assert.equal(status, 403);
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('a failing authFn rejects the upgrade with 401', async () => {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws', authFn: () => false });
  wss.attach(server, () => {});
  const port = await listen(server);

  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const status = await new Promise<number>((resolve) => {
    client.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    client.on('error', () => {});
  });
  assert.equal(status, 401);
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('capacity limit closes an over-limit connection with 1013', async () => {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws', maxConnections: 1 });
  wss.attach(server, () => {});
  const port = await listen(server);

  const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await once(a, 'open');
  const b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const code = await new Promise<number>((resolve) => {
    b.on('close', (c) => resolve(c));
    b.on('error', () => {});
  });
  assert.equal(code, 1013);

  a.close();
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('heartbeat pings keep a live client connected', async () => {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws', heartbeatIntervalMs: 25 });
  wss.attach(server, () => {});
  const port = await listen(server);
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await once(client, 'open');
  await new Promise((r) => setTimeout(r, 90)); // ~3 heartbeat cycles; ws auto-pongs
  assert.equal(wss.connectionCount, 1);
  client.close();
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('attachProtocol rejects a disallowed origin with 403', async () => {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws' });
  wss.attachProtocol(server, 'p', () => {});
  const port = await listen(server);
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, 'p', { origin: 'http://evil.example' });
  const status = await new Promise<number>((resolve) => {
    client.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    client.on('error', () => {});
  });
  assert.equal(status, 403);
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('attachProtocol rejects a failing authFn with 401', async () => {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws', authFn: () => false });
  wss.attachProtocol(server, 'p', () => {});
  const port = await listen(server);
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, 'p');
  const status = await new Promise<number>((resolve) => {
    client.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
    client.on('error', () => {});
  });
  assert.equal(status, 401);
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('attachProtocol enforces the capacity limit with 1013', async () => {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws', maxConnections: 1 });
  wss.attachProtocol(server, 'p', () => {});
  const port = await listen(server);
  const a = new WebSocket(`ws://127.0.0.1:${port}/ws`, 'p');
  await once(a, 'open');
  const b = new WebSocket(`ws://127.0.0.1:${port}/ws`, 'p');
  const code = await new Promise<number>((resolve) => {
    b.on('close', (c) => resolve(c));
    b.on('error', () => {});
  });
  assert.equal(code, 1013);
  a.close();
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});

test('attachProtocol negotiates a subprotocol and hands over the raw socket', async () => {
  const server = createServer();
  const wss = new StreetWebSocketServer({ path: '/ws' });
  wss.attachProtocol(server, 'street-proto', (ws) => {
    ws.send('welcome');
  });
  const port = await listen(server);

  const client = new WebSocket(`ws://127.0.0.1:${port}/ws`, 'street-proto');
  // Attach the message listener before `open` — the server sends on connection,
  // so the frame can arrive as soon as the handshake completes.
  const first = once<Buffer>(client, 'message');
  await once(client, 'open');
  assert.equal(client.protocol, 'street-proto');
  assert.equal((await first).toString(), 'welcome');

  client.close();
  await wss.close();
  await new Promise<void>((r) => server.close(() => r()));
});
