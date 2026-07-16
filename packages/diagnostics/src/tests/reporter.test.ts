import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { DiagnosticsReporter, diagnosticsReporter, type DiagnosticEvent } from '../index.js';

// Silence and capture stderr writes so tests don't pollute the runner output.
let writes: string[] = [];
beforeEach(() => {
  writes = [];
  mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
});
afterEach(() => mock.restoreAll());

/** Run `report` and return the emitted event plus what was written to stderr. */
function capture(reporter: DiagnosticsReporter, err: unknown, correlationId?: string) {
  let emitted: DiagnosticEvent | undefined;
  const onEvent = (e: DiagnosticEvent) => { emitted = e; };
  reporter.on('diagnostic', onEvent);
  try {
    reporter.report(err, correlationId);
  } finally {
    reporter.off('diagnostic', onEvent);
  }
  return { emitted: emitted!, written: writes.join('') };
}

test('report serializes an Error with its class, message, and level', () => {
  const r = new DiagnosticsReporter();
  const { emitted } = capture(r, new TypeError('boom'));
  assert.equal(emitted.level, 'error');
  assert.equal(emitted.errorClass, 'TypeError');
  assert.equal(emitted.message, 'boom');
  assert.match(emitted.ts, /^\d{4}-\d{2}-\d{2}T.*Z$/, 'ISO 8601 timestamp');
});

test('report emits the event and writes a JSON line to stderr', () => {
  const r = new DiagnosticsReporter();
  const { emitted, written } = capture(r, new Error('to-stderr'));
  assert.ok(written.endsWith('\n'), 'trailing newline');
  assert.deepEqual(JSON.parse(written.trim()), JSON.parse(JSON.stringify(emitted)));
});

test('report includes correlationId only when provided', () => {
  const r = new DiagnosticsReporter();
  assert.equal(capture(r, new Error('x'), 'corr-123').emitted.correlationId, 'corr-123');
  assert.equal('correlationId' in capture(r, new Error('x')).emitted, false);
});

test('report classifies a string error', () => {
  const { emitted } = capture(new DiagnosticsReporter(), 'just a string');
  assert.equal(emitted.errorClass, 'StringError');
  assert.equal(emitted.message, 'just a string');
  assert.deepEqual(emitted.stack, [], 'no stack for a string');
});

test('report classifies a non-error, non-string value as UnknownError', () => {
  const { emitted } = capture(new DiagnosticsReporter(), { code: 42 });
  assert.equal(emitted.errorClass, 'UnknownError');
  assert.equal(emitted.message, String({ code: 42 }));
});

test('report cleans the stack: keeps "at" frames, drops internal frames and noise', () => {
  const r = new DiagnosticsReporter();
  const err = new Error('with stack');
  err.stack = [
    'Error: with stack',
    '    at userCode (/app/src/index.js:10:5)',
    '    at Object.<anonymous> (node:internal/modules/cjs/loader:1000:1)',
    '    at run (/app/node_modules/node/thing.js:1:1)',
    '    some non-frame noise line',
  ].join('\n');
  const { emitted } = capture(r, err);
  assert.deepEqual(emitted.stack, ['at userCode (/app/src/index.js:10:5)']);
});

test('report tolerates an Error with no stack', () => {
  const r = new DiagnosticsReporter();
  const err = new Error('no stack');
  err.stack = undefined;
  assert.deepEqual(capture(r, err).emitted.stack, []);
});

test('a custom Error subclass keeps its constructor name', () => {
  class MyDomainError extends Error {}
  const { emitted } = capture(new DiagnosticsReporter(), new MyDomainError('nope'));
  assert.equal(emitted.errorClass, 'MyDomainError');
});

test('the exported diagnosticsReporter is a shared DiagnosticsReporter instance', () => {
  assert.ok(diagnosticsReporter instanceof DiagnosticsReporter);
  const { emitted } = capture(diagnosticsReporter, new Error('shared'));
  assert.equal(emitted.message, 'shared');
});
