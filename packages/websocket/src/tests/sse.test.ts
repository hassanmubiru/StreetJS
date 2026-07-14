import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { SseConnection, createSse } from '../sse.js';

/** Minimal fake ServerResponse capturing writes. */
class FakeRes extends EventEmitter {
  head?: { status: number; headers: Record<string, string> };
  chunks: string[] = [];
  writableEnded = false;
  ended = false;
  throwOnWrite = false;
  socket = new EventEmitter();

  writeHead(status: number, headers: Record<string, string>): this {
    this.head = { status, headers };
    return this;
  }
  write(chunk: string): boolean {
    if (this.throwOnWrite) {
      throw new Error('socket gone');
    }
    this.chunks.push(chunk);
    return true;
  }
  end(): void {
    this.ended = true;
    this.writableEnded = true;
  }
  once(event: string, cb: (...args: unknown[]) => void): this {
    super.once(event, cb);
    return this;
  }
}

function res(): FakeRes {
  return new FakeRes();
}

test('constructor writes SSE headers', () => {
  const r = res();
  createSse(r as unknown as import('node:http').ServerResponse);
  assert.equal(r.head?.status, 200);
  assert.equal(r.head?.headers['Content-Type'], 'text/event-stream');
  assert.equal(r.head?.headers['X-Accel-Buffering'], 'no');
});

test('send emits an auto-incrementing id and JSON data', () => {
  const r = res();
  const sse = new SseConnection(r as unknown as import('node:http').ServerResponse);
  sse.send({ data: { hello: 'world' } });
  const frame = r.chunks.join('');
  assert.match(frame, /id: 1\n/);
  assert.match(frame, /data: \{"hello":"world"\}\n/);
});

test('send honors event, explicit id, and retry, and multi-line data', () => {
  const r = res();
  const sse = new SseConnection(r as unknown as import('node:http').ServerResponse);
  sse.send({ event: 'update', id: 'evt-1', retry: 5000, data: 'line1\nline2' });
  const frame = r.chunks.at(-1)!;
  assert.match(frame, /id: evt-1\n/);
  assert.match(frame, /event: update\n/);
  assert.match(frame, /retry: 5000\n/);
  assert.match(frame, /data: line1\ndata: line2\n/);
});

test('CR/LF are stripped from event and id (frame-injection guard)', () => {
  const r = res();
  const sse = new SseConnection(r as unknown as import('node:http').ServerResponse);
  sse.send({ event: 'a\nevil: x', id: 'i\r\nj', data: 'ok' });
  const frame = r.chunks.at(-1)!;
  assert.match(frame, /event: aevil: x\n/);
  assert.match(frame, /id: ij\n/);
});

test('undefined data serializes as an empty data line', () => {
  const r = res();
  const sse = new SseConnection(r as unknown as import('node:http').ServerResponse);
  sse.send({ data: undefined });
  assert.match(r.chunks.at(-1)!, /data: \n/);
});

test('comment writes a keep-alive line', () => {
  const r = res();
  const sse = new SseConnection(r as unknown as import('node:http').ServerResponse);
  assert.equal(sse.comment('ping'), true);
  assert.match(r.chunks.at(-1)!, /^: ping\n\n$/);
});

test('close ends the response and blocks further sends', () => {
  const r = res();
  const sse = new SseConnection(r as unknown as import('node:http').ServerResponse);
  sse.close();
  assert.equal(sse.closed, true);
  assert.equal(r.ended, true);
  assert.equal(sse.send({ data: 'x' }), false);
  assert.equal(sse.comment('x'), false);
});

test('a write failure cleans up the connection', () => {
  const r = res();
  const sse = new SseConnection(r as unknown as import('node:http').ServerResponse);
  r.throwOnWrite = true;
  assert.equal(sse.send({ data: 'x' }), false);
  assert.equal(sse.closed, true);
});

test('the response close event triggers cleanup', () => {
  const r = res();
  const sse = new SseConnection(r as unknown as import('node:http').ServerResponse);
  r.emit('close');
  assert.equal(sse.closed, true);
});
