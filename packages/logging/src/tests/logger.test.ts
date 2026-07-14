import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLogger } from '../logger.js';
import { MemoryTransport } from '../transport.js';
import type { LogRecord, Transport } from '../types.js';

function setup(level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent' = 'trace') {
  const memory = new MemoryTransport();
  let now = 1_000;
  const log = createLogger({
    level,
    name: 'test',
    transport: memory,
    clock: () => now,
  });
  return { memory, log, tick: (ms: number) => (now += ms), setNow: (v: number) => (now = v) };
}

test('emits a record with reserved members and message', () => {
  const { memory, log } = setup();
  log.info('hello');
  const rec = memory.last() as LogRecord;
  assert.equal(rec.levelName, 'info');
  assert.equal(rec.level, 30);
  assert.equal(rec.name, 'test');
  assert.equal(rec.msg, 'hello');
  assert.equal(rec.time, 1_000);
  assert.deepEqual(rec.fields, {});
});

test('object-first form attaches fields and optional message', () => {
  const { memory, log } = setup();
  log.info({ port: 3000, ok: true }, 'listening');
  const rec = memory.last() as LogRecord;
  assert.equal(rec.msg, 'listening');
  assert.deepEqual(rec.fields, { port: 3000, ok: true });
});

test('object-only form has no message', () => {
  const { memory, log } = setup();
  log.debug({ a: 1 });
  const rec = memory.last() as LogRecord;
  assert.equal(rec.msg, undefined);
  assert.deepEqual(rec.fields, { a: 1 });
});

test('error-first form serializes error and uses its message by default', () => {
  const { memory, log } = setup();
  const err = new Error('boom');
  log.error(err);
  const rec = memory.last() as LogRecord;
  assert.equal(rec.msg, 'boom');
  const errField = rec.fields.err as Record<string, unknown>;
  assert.equal(errField.type, 'Error');
  assert.equal(errField.message, 'boom');
  assert.equal(typeof errField.stack, 'string');
});

test('error-first form accepts an explicit message', () => {
  const { memory, log } = setup();
  log.error(new Error('inner'), 'request failed');
  const rec = memory.last() as LogRecord;
  assert.equal(rec.msg, 'request failed');
});

test('level filtering suppresses records below the threshold', () => {
  const { memory, log } = setup('warn');
  log.info('nope');
  log.debug('nope');
  log.warn('yes');
  log.error('yes');
  assert.equal(memory.records.length, 2);
  assert.deepEqual(
    memory.records.map((r) => r.levelName),
    ['warn', 'error'],
  );
});

test('silent level suppresses everything including fatal', () => {
  const { memory, log } = setup('silent');
  log.fatal('should not appear');
  log.error('nor this');
  assert.equal(memory.records.length, 0);
});

test('setLevel changes the threshold at runtime', () => {
  const { memory, log } = setup('error');
  log.info('suppressed');
  assert.equal(memory.records.length, 0);
  log.setLevel('debug');
  assert.equal(log.level, 'debug');
  log.info('now visible');
  assert.equal(memory.records.length, 1);
});

test('isLevelEnabled reflects the threshold and silent boundary', () => {
  const { log } = setup('warn');
  assert.equal(log.isLevelEnabled('warn'), true);
  assert.equal(log.isLevelEnabled('error'), true);
  assert.equal(log.isLevelEnabled('info'), false);
  assert.equal(log.isLevelEnabled('silent'), false);
});

test('log() emits at an explicit level and ignores silent', () => {
  const { memory, log } = setup();
  log.log('warn', { code: 1 }, 'warned');
  log.log('info', 'plain');
  log.log('silent', 'ignored');
  assert.equal(memory.records.length, 2);
  assert.equal(memory.records[0].levelName, 'warn');
  assert.equal(memory.records[1].msg, 'plain');
});

test('child merges bindings and inherits everything', () => {
  const { memory, log } = setup();
  const child = log.child({ requestId: 'r1' });
  child.info({ step: 'a' }, 'working');
  const rec = memory.last() as LogRecord;
  assert.deepEqual(rec.fields, { requestId: 'r1', step: 'a' });
  assert.equal(rec.name, 'test');
  assert.deepEqual(child.bindings, { requestId: 'r1' });
});

test('child bindings do not leak back to the parent', () => {
  const { memory, log } = setup();
  const child = log.child({ scope: 'child' });
  child.info('c');
  log.info('p');
  assert.deepEqual(memory.records[0].fields, { scope: 'child' });
  assert.deepEqual(memory.records[1].fields, {});
});

test('child level is independent after creation', () => {
  const { memory, log } = setup('info');
  const child = log.child({ a: 1 });
  child.setLevel('error');
  child.info('suppressed on child');
  log.info('still visible on parent');
  assert.equal(memory.records.length, 1);
  assert.equal(memory.records[0].msg, 'still visible on parent');
});

test('base fields are applied to every record', () => {
  const memory = new MemoryTransport();
  const log = createLogger({ transport: memory, base: { service: 'svc' }, clock: () => 5 });
  log.info('x');
  assert.deepEqual((memory.last() as LogRecord).fields, { service: 'svc' });
});

test('startTimer logs elapsed duration at info', () => {
  const { memory, log, tick } = setup();
  const timer = log.startTimer();
  tick(42);
  assert.equal(timer.elapsed(), 42);
  timer.done({ job: 'sync' }, 'completed');
  const rec = memory.last() as LogRecord;
  assert.equal(rec.levelName, 'info');
  assert.equal(rec.msg, 'completed');
  assert.equal(rec.fields.durationMs, 42);
  assert.equal(rec.fields.job, 'sync');
});

test('startTimer done() supports message-only and no-arg forms', () => {
  const { memory, log, tick } = setup();
  const t1 = log.startTimer();
  tick(10);
  t1.done('just a message');
  const t2 = log.startTimer();
  tick(5);
  t2.done();
  assert.equal(memory.records[0].msg, 'just a message');
  assert.equal(memory.records[0].fields.durationMs, 10);
  assert.equal(memory.records[1].msg, undefined);
  assert.equal(memory.records[1].fields.durationMs, 5);
});

test('transport failures are isolated and routed to onError', () => {
  const failing: Transport = {
    name: 'failing',
    write() {
      throw new Error('sink down');
    },
  };
  const errors: unknown[] = [];
  const log = createLogger({
    transport: failing,
    onError: (err) => errors.push(err),
    clock: () => 1,
  });
  assert.doesNotThrow(() => log.info('still fine'));
  assert.equal(errors.length, 1);
  assert.ok(errors[0] instanceof Error);
});

test('flush and close delegate to the transport', async () => {
  let flushed = 0;
  let closed = 0;
  const transport: Transport = {
    name: 't',
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
  const log = createLogger({ transport });
  await log.flush();
  await log.close();
  assert.equal(flushed, 1);
  assert.equal(closed, 1);
});

test('default error handler writes a notice to stderr without throwing', () => {
  const failing: Transport = {
    name: 'failing',
    write() {
      throw new Error('sink down');
    },
  };
  const captured: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (c: string) => boolean }).write = (chunk: string) => {
    captured.push(chunk);
    return true;
  };
  try {
    const log = createLogger({ transport: failing, clock: () => 1 });
    assert.doesNotThrow(() => log.warn('x'));
  } finally {
    (process.stderr as unknown as { write: typeof original }).write = original;
  }
  assert.equal(captured.length, 1);
  assert.match(captured[0], /transport error: sink down/);
  assert.match(captured[0], /dropped warn record/);
});

test('default error handler tolerates non-Error throwables', () => {
  const failing: Transport = {
    name: 'failing',
    write() {
      throw 'string failure';
    },
  };
  const captured: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (c: string) => boolean }).write = (chunk: string) => {
    captured.push(chunk);
    return true;
  };
  try {
    const log = createLogger({ transport: failing, clock: () => 1 });
    assert.doesNotThrow(() => log.info('y'));
  } finally {
    (process.stderr as unknown as { write: typeof original }).write = original;
  }
  assert.match(captured[0], /transport error: string failure/);
});

test('bindings getter exposes the bound fields', () => {
  const memory = new MemoryTransport();
  const log = createLogger({ transport: memory, base: { app: 'x' } });
  assert.deepEqual(log.bindings, { app: 'x' });
});

test('flush and close are safe when the transport omits them', async () => {
  const log = createLogger({ transport: new MemoryTransport() });
  await assert.doesNotReject(log.flush());
  await assert.doesNotReject(log.close());
});

test('non-string, non-object first argument is coerced to a message', () => {
  const { memory, log } = setup();
  (log.info as (arg: unknown) => void)(42);
  assert.equal((memory.last() as LogRecord).msg, '42');
});

test('default logger uses info level and stdout console transport', () => {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (c: string) => boolean }).write = (chunk: string) => {
    lines.push(chunk);
    return true;
  };
  try {
    const log = createLogger();
    assert.equal(log.level, 'info');
    log.debug('hidden');
    log.info('shown');
  } finally {
    (process.stdout as unknown as { write: typeof original }).write = original;
  }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /"msg":"shown"/);
});
