import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import {
  ConsoleTransport,
  StreamTransport,
  MemoryTransport,
  MultiTransport,
  formatJsonLine,
  formatPrettyLine,
  toWireObject,
} from '../transport.js';
import type { LogRecord } from '../types.js';

function record(overrides: Partial<LogRecord> = {}): LogRecord {
  return {
    level: 30,
    levelName: 'info',
    time: 0,
    name: 'app',
    msg: 'hello',
    fields: { a: 1 },
    ...overrides,
  };
}

test('toWireObject merges reserved members and fields', () => {
  const wire = toWireObject(record());
  assert.deepEqual(wire, { level: 30, levelName: 'info', time: 0, name: 'app', msg: 'hello', a: 1 });
});

test('toWireObject lets reserved members win over colliding field keys', () => {
  const wire = toWireObject(record({ fields: { level: 999, custom: true } }));
  assert.equal(wire.level, 30);
  assert.equal(wire.custom, true);
});

test('toWireObject omits absent optional members', () => {
  const wire = toWireObject(record({ name: undefined, msg: undefined, fields: {} }));
  assert.equal('name' in wire, false);
  assert.equal('msg' in wire, false);
});

test('formatJsonLine produces a newline-terminated JSON line', () => {
  const line = formatJsonLine(record());
  assert.ok(line.endsWith('\n'));
  const parsed = JSON.parse(line);
  assert.equal(parsed.msg, 'hello');
});

test('formatPrettyLine includes iso time, level, name, message and extras', () => {
  const line = formatPrettyLine(record(), false);
  assert.match(line, /1970-01-01T00:00:00.000Z/);
  assert.match(line, /INFO/);
  assert.match(line, /\(app\)/);
  assert.match(line, /hello/);
  assert.match(line, /\{"a":1\}/);
});

test('formatPrettyLine adds ANSI colors when enabled', () => {
  const line = formatPrettyLine(record({ levelName: 'error', level: 50 }), true);
  assert.match(line, /\x1b\[31m/);
});

test('MemoryTransport captures, filters, and clears', () => {
  const t = new MemoryTransport();
  t.write(record({ levelName: 'info' }));
  t.write(record({ levelName: 'error', level: 50 }));
  assert.equal(t.records.length, 2);
  assert.equal(t.recordsAt('error').length, 1);
  assert.equal(t.last()?.levelName, 'error');
  t.clear();
  assert.equal(t.records.length, 0);
  assert.equal(t.last(), undefined);
});

test('ConsoleTransport writes JSON to stdout by default', () => {
  const out: string[] = [];
  const t = new ConsoleTransport({ stdout: (c) => out.push(c) });
  t.write(record());
  assert.equal(out.length, 1);
  assert.match(out[0], /"msg":"hello"/);
});

test('ConsoleTransport routes at/above stderrLevel to stderr', () => {
  const out: string[] = [];
  const err: string[] = [];
  const t = new ConsoleTransport({
    stderrLevel: 'error',
    stdout: (c) => out.push(c),
    stderr: (c) => err.push(c),
  });
  t.write(record({ levelName: 'info', level: 30 }));
  t.write(record({ levelName: 'error', level: 50 }));
  assert.equal(out.length, 1);
  assert.equal(err.length, 1);
});

test('ConsoleTransport pretty mode emits readable lines', () => {
  const out: string[] = [];
  const t = new ConsoleTransport({ format: 'pretty', stdout: (c) => out.push(c) });
  t.write(record());
  assert.match(out[0], /INFO \(app\) hello/);
});

test('StreamTransport writes JSON lines to a stream', () => {
  const stream = new PassThrough();
  const chunks: string[] = [];
  stream.on('data', (c: Buffer) => chunks.push(c.toString()));
  const t = new StreamTransport(stream, 'file');
  assert.equal(t.name, 'file');
  t.write(record());
  stream.end();
  const parsed = JSON.parse(chunks.join(''));
  assert.equal(parsed.msg, 'hello');
});

test('MultiTransport fans out and aggregates flush/close', async () => {
  const a = new MemoryTransport();
  let flushed = 0;
  let closed = 0;
  const b = {
    name: 'b',
    write() {
      /* noop */
    },
    flush() {
      flushed++;
    },
    close() {
      closed++;
    },
  };
  const multi = new MultiTransport([a, b]);
  multi.write(record());
  assert.equal(a.records.length, 1);
  await multi.flush();
  await multi.close();
  assert.equal(flushed, 1);
  assert.equal(closed, 1);
});
