import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { StreetSocket, StreetWebSocketServer } from '../server.js';
import { ChannelHub } from '../channels.js';

class BufferedSocket extends EventEmitter {
  readyState = WebSocket.OPEN as number;
  bufferedAmount = 0;
  sent: string[] = [];
  terminated = 0;
  failSend = false;
  send(frame: string): void {
    if (this.failSend) throw new Error('write failed');
    this.sent.push(frame);
    this.bufferedAmount += Buffer.byteLength(frame);
  }
  terminate(): void {
    this.terminated += 1;
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
  asWebSocket(): WebSocket { return this as unknown as WebSocket; }
}

test('UTF-8 envelopes fit at the limit; the next write terminates and cleans up once', (t) => {
  t.mock.method(Date, 'now', () => 1);
  const frame = JSON.stringify({ type: 'chat', payload: '👋🏾', ts: 1 });
  const bytes = Buffer.byteLength(frame);
  assert.ok(bytes > frame.length);
  const raw = new BufferedSocket();
  const socket = new StreetSocket(raw.asWebSocket(), { maxBufferedBytes: bytes * 2 });
  let closed = 0;
  socket.onClose(() => { closed += 1; });
  socket.emit('chat', '👋🏾');
  socket.emit('chat', '👋🏾');
  assert.equal(raw.bufferedAmount, bytes * 2);
  socket.emit('chat', '👋🏾');
  socket.emit('chat', '👋🏾');
  assert.equal(raw.sent.length, 2);
  assert.equal(raw.terminated, 1);
  assert.equal(closed, 1);
  assert.equal(socket.closed, true);
});

test('draining the transport buffer permits subsequent writes', () => {
  const raw = new BufferedSocket();
  const socket = new StreetSocket(raw.asWebSocket(), { maxBufferedBytes: 128 });
  for (let i = 0; i < 20; i++) {
    socket.emit('chat', 'hello');
    raw.bufferedAmount = 0;
  }
  assert.equal(raw.sent.length, 20);
  assert.equal(socket.closed, false);
});

test('room delivery evicts a slow member while healthy members keep receiving', () => {
  const hub = new ChannelHub();
  const slow = new BufferedSocket();
  const healthy = new BufferedSocket();
  const a = new StreetSocket(slow.asWebSocket(), { maxBufferedBytes: 256 });
  const b = new StreetSocket(healthy.asWebSocket(), { maxBufferedBytes: 4096 });
  hub.bind(a);
  hub.bind(b);
  hub.join('chat', 'slow', a);
  hub.join('chat', 'healthy', b);
  slow.bufferedAmount = 256;
  hub.publish('chat', 'message', { text: 'hello' });
  hub.publish('chat', 'message', { text: 'again' });
  assert.equal(slow.terminated, 1);
  assert.deepEqual(hub.presence('chat'), ['healthy']);
  assert.deepEqual(healthy.sent.map((s) => JSON.parse(s)).filter((m) => m.type === 'message')
    .map((m) => m.payload.text), ['hello', 'again']);
});

test('broadcast isolates slow and throwing transports, including custom-protocol clients', async () => {
  const server = new StreetWebSocketServer({ maxBufferedBytes: 256 });
  const slow = new BufferedSocket();
  slow.bufferedAmount = 256;
  const broken = new BufferedSocket();
  broken.failSend = true;
  const healthy = new BufferedSocket();
  // Model the same raw transport set used by both attachment paths.
  const clients = (server as unknown as { clients: Set<WebSocket> }).clients;
  for (const socket of [slow, broken, healthy]) clients.add(socket.asWebSocket());
  try {
    assert.doesNotThrow(() => server.broadcast('chat', 'hello'));
    assert.equal(slow.terminated, 1);
    assert.equal(broken.terminated, 1);
    assert.equal(healthy.sent.length, 1);
  } finally {
    await server.close();
  }
});

test('buffer limits are validated and Infinity explicitly opts out', async () => {
  for (const value of [0, -1, 1.5, NaN, -Infinity]) {
    assert.throws(() => new StreetWebSocketServer({ maxBufferedBytes: value }), /maxBufferedBytes/);
    assert.throws(() => new StreetSocket(new BufferedSocket().asWebSocket(), { maxBufferedBytes: value }), /maxBufferedBytes/);
  }
  const raw = new BufferedSocket();
  raw.bufferedAmount = 2 ** 30;
  new StreetSocket(raw.asWebSocket(), { maxBufferedBytes: Infinity }).emit('chat', 'hello');
  assert.equal(raw.sent.length, 1);
  const server = new StreetWebSocketServer({ maxBufferedBytes: Infinity });
  await server.close();
});

test('standalone sockets default to a 1 MiB limit', () => {
  const raw = new BufferedSocket();
  new StreetSocket(raw.asWebSocket()).emit('chat', 'x'.repeat(1024 * 1024));
  assert.equal(raw.sent.length, 0);
  assert.equal(raw.terminated, 1);
});

for (const mode of ['emit', 'broadcast', 'raw-broadcast']) {
  test(`real WebSocket ${mode} applies the configured limit`, { timeout: 5000 }, async () => {
    const http = createServer();
    const server = new StreetWebSocketServer({ maxBufferedBytes: 128 });
    if (mode === 'raw-broadcast') {
      server.attachProtocol(http, 'chat', (socket) => {
        socket.on('message', () => server.broadcast('chat', 'x'.repeat(128)));
      });
    } else {
      server.attach(http, (socket) => {
        socket.on('large', () => {
          if (mode === 'emit') socket.emit('chat', 'x'.repeat(128));
          else server.broadcast('chat', 'x'.repeat(128));
        });
      });
    }
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    assert.ok(address && typeof address === 'object');
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`, mode === 'raw-broadcast' ? 'chat' : undefined);
    let received = 0;
    client.on('message', () => { received += 1; });
    const closed = new Promise<number>((resolve) => client.once('close', resolve));
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('open', resolve);
        client.once('error', reject);
      });
      client.send(JSON.stringify({ type: 'large', payload: null }));
      assert.equal(await closed, 1006);
      assert.equal(received, 0);
    } finally {
      client.terminate();
      await server.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  });
}
