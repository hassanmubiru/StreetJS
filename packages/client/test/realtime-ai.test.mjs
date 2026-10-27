// Realtime (fake WebSocket) + AI SSE parsing tests. Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeClient, toWsUrl, parseSseChunk } from '../dist/index.js';

// Minimal fake WebSocket capturing sent frames and allowing injected messages.
class FakeWebSocket {
  constructor(url) { this.url = url; this.sent = []; this._listeners = {}; FakeWebSocket.last = this; }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; }
  addEventListener(type, cb) { (this._listeners[type] ??= []).push(cb); }
  emit(type, ev) { for (const cb of this._listeners[type] ?? []) cb(ev); }
}

describe('toWsUrl', () => {
  it('maps http(s) base to ws(s)', () => {
    assert.equal(toWsUrl('https://h.co/api', '/realtime'), 'wss://h.co/api/realtime');
    assert.equal(toWsUrl('http://h.co', 'rt'), 'ws://h.co/rt');
  });
});

describe('RealtimeClient', () => {
  it('subscribes, routes channel messages, and unsubscribes', () => {
    const rt = new RealtimeClient('ws://x/rt', FakeWebSocket);
    rt.connect();
    const got = [];
    const off = rt.subscribe('room:1', (m) => got.push(m.data));

    // The subscribe envelope was sent.
    assert.deepEqual(JSON.parse(FakeWebSocket.last.sent[0]), { type: 'subscribe', channel: 'room:1' });

    // Inbound message on the channel is routed.
    FakeWebSocket.last.emit('message', { data: JSON.stringify({ type: 'event', channel: 'room:1', data: 'hi' }) });
    assert.deepEqual(got, ['hi']);

    // A message on another channel is not routed here.
    FakeWebSocket.last.emit('message', { data: JSON.stringify({ channel: 'room:2', data: 'no' }) });
    assert.deepEqual(got, ['hi']);

    off();
    assert.deepEqual(JSON.parse(FakeWebSocket.last.sent.at(-1)), { type: 'unsubscribe', channel: 'room:1' });
  });

  it('restores subscriptions after an unexpected disconnect', async () => {
    const rt = new RealtimeClient('ws://x/rt', FakeWebSocket, { reconnectDelayMs: 0 });
    const got = [];
    rt.subscribe('match:1', (m) => got.push(m.data));
    rt.connect();
    const first = FakeWebSocket.last;
    assert.deepEqual(JSON.parse(first.sent[0]), { type: 'subscribe', channel: 'match:1' });

    first.emit('close', {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = FakeWebSocket.last;
    assert.notEqual(second, first);
    assert.deepEqual(JSON.parse(second.sent[0]), { type: 'subscribe', channel: 'match:1' });
    second.emit('message', { data: JSON.stringify({ type: 'state', channel: 'match:1', data: { turn: 2 } }) });
    assert.deepEqual(got, [{ turn: 2 }]);
    rt.close();
  });

  it('publish sends a publish envelope; ignores non-JSON frames', () => {
    const rt = new RealtimeClient('ws://x/rt', FakeWebSocket);
    rt.connect();
    rt.publish('room:1', { x: 1 });
    assert.deepEqual(JSON.parse(FakeWebSocket.last.sent[0]), { type: 'publish', channel: 'room:1', data: { x: 1 } });
    // Non-JSON inbound must not throw.
    assert.doesNotThrow(() => FakeWebSocket.last.emit('message', { data: 'not-json' }));
    rt.close();
    assert.equal(FakeWebSocket.last.closed, true);
  });

  it('normalizes the StreetJS channel-aware server envelope', () => {
    const rt = new RealtimeClient('ws://x/rt', FakeWebSocket);
    rt.connect();
    const got = [];
    rt.subscribe('match:1', (message) => got.push(message.data));
    FakeWebSocket.last.emit('message', {
      data: JSON.stringify({
        type: 'realtime',
        payload: { channel: 'match:1', type: 'state', data: { turn: 1 } },
      }),
    });
    assert.deepEqual(got, [{ turn: 1 }]);
    rt.close();
  });

  it('supports an optional event name when publishing', () => {
    const rt = new RealtimeClient('ws://x/rt', FakeWebSocket);
    rt.connect();
    rt.publish('match:1', { to: 'e4' }, 'move');
    assert.deepEqual(JSON.parse(FakeWebSocket.last.sent.at(-1)), {
      type: 'publish', channel: 'match:1', data: { to: 'e4' }, event: 'move',
    });
    rt.close();
  });
});

describe('parseSseChunk', () => {
  it('extracts complete data events and keeps the remainder', () => {
    const { events, rest } = parseSseChunk('data: hello\n\ndata: wor');
    assert.deepEqual(events, ['hello']);
    assert.equal(rest, 'data: wor');
  });

  it('joins multi-line data and detects the [DONE] sentinel value', () => {
    const { events } = parseSseChunk('data: a\ndata: b\n\ndata: [DONE]\n\n');
    assert.deepEqual(events, ['a\nb', '[DONE]']);
  });
});
