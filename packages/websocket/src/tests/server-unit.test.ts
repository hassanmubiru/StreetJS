import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';

import {
  StreetSocket,
  normalizeOrigin,
  deriveSelfOrigin,
  isOriginAllowed,
} from '../server.js';

/** Fake `ws` WebSocket: EventEmitter with send/close/readyState. */
class FakeWs extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  sent: string[] = [];
  send(s: string): void {
    this.sent.push(s);
  }
  close(): void {
    this.emit('close');
  }
  message(obj: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(obj), 'utf8'));
  }
}

function req(headers: Record<string, string>, encrypted = false): IncomingMessage {
  return { headers, socket: { encrypted } } as unknown as IncomingMessage;
}

test('normalizeOrigin normalizes valid origins and rejects invalid ones', () => {
  assert.equal(normalizeOrigin('http://a.com:80/path'), 'http://a.com');
  assert.equal(normalizeOrigin('https://a.com'), 'https://a.com');
  assert.equal(normalizeOrigin('not a url'), null);
});

test('deriveSelfOrigin uses Host and TLS state', () => {
  assert.equal(deriveSelfOrigin(req({ host: 'a.com' })), 'http://a.com');
  assert.equal(deriveSelfOrigin(req({ host: 'a.com' }, true)), 'https://a.com');
  assert.equal(deriveSelfOrigin(req({})), null);
});

test('isOriginAllowed: no Origin header is allowed (non-browser client)', () => {
  assert.equal(isOriginAllowed(req({ host: 'a.com' }), undefined), true);
});

test('isOriginAllowed: malformed Origin is rejected', () => {
  assert.equal(isOriginAllowed(req({ origin: 'garbage', host: 'a.com' }), undefined), false);
});

test('isOriginAllowed: allowlist membership', () => {
  assert.equal(isOriginAllowed(req({ origin: 'https://ok.com' }), ['https://ok.com']), true);
  assert.equal(isOriginAllowed(req({ origin: 'https://evil.com' }), ['https://ok.com']), false);
});

test('isOriginAllowed: same-origin default when no allowlist', () => {
  assert.equal(isOriginAllowed(req({ origin: 'http://a.com', host: 'a.com' }), undefined), true);
  assert.equal(isOriginAllowed(req({ origin: 'http://b.com', host: 'a.com' }), undefined), false);
});

test('StreetSocket routes typed events to handlers', () => {
  const ws = new FakeWs();
  const socket = new StreetSocket(ws as never);
  const received: unknown[] = [];
  socket.on('chat', (p) => received.push(p));
  ws.message({ type: 'chat', payload: { text: 'hi' }, ts: 1 });
  assert.deepEqual(received, [{ text: 'hi' }]);
});

test('StreetSocket delivers wildcard events the full envelope', () => {
  const ws = new FakeWs();
  const socket = new StreetSocket(ws as never);
  const seen: unknown[] = [];
  socket.on('*', (m) => seen.push(m));
  ws.message({ type: 'x', payload: 1, ts: 2 });
  assert.deepEqual(seen, [{ type: 'x', payload: 1, ts: 2 }]);
});

test('StreetSocket ignores malformed frames', () => {
  const ws = new FakeWs();
  new StreetSocket(ws as never);
  assert.doesNotThrow(() => ws.emit('message', Buffer.from('not-json')));
});

test('StreetSocket.emit sends framed JSON while open, and not once closed', () => {
  const ws = new FakeWs();
  const socket = new StreetSocket(ws as never);
  socket.emit('greet', { hi: true });
  assert.equal(ws.sent.length, 1);
  assert.match(ws.sent[0], /"type":"greet"/);
  ws.readyState = 3; // CLOSED
  socket.emit('again', {});
  assert.equal(ws.sent.length, 1);
});

test('StreetSocket.off removes a handler', () => {
  const ws = new FakeWs();
  const socket = new StreetSocket(ws as never);
  const calls: unknown[] = [];
  const h = (p: unknown): void => void calls.push(p);
  socket.on('e', h);
  socket.off('e', h);
  ws.message({ type: 'e', payload: 1, ts: 0 });
  assert.equal(calls.length, 0);
});

test('StreetSocket enforces a max listener count per event', () => {
  const ws = new FakeWs();
  const socket = new StreetSocket(ws as never);
  assert.throws(() => {
    for (let i = 0; i < 100; i++) socket.on('e', () => {});
  }, /Too many listeners/);
});

test('StreetSocket.onClose fires on close and immediately if already closed', () => {
  const ws = new FakeWs();
  const socket = new StreetSocket(ws as never);
  let closed = 0;
  socket.onClose(() => closed++);
  ws.close();
  assert.equal(closed, 1);
  assert.equal(socket.closed, true);
  // Registering after close fires immediately.
  let late = 0;
  socket.onClose(() => late++);
  assert.equal(late, 1);
});

test('StreetSocket exposes id and readyState', () => {
  const ws = new FakeWs();
  const socket = new StreetSocket(ws as never);
  assert.match(socket.id, /[0-9a-f-]{36}/);
  assert.equal(socket.readyState, 1);
});
