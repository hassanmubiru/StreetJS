import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serializeError, normalizeLeaf, isPlainContainer } from '../serialize.js';

test('serializeError captures type, message, and stack', () => {
  const out = serializeError(new TypeError('bad type')) as Record<string, unknown>;
  assert.equal(out.type, 'TypeError');
  assert.equal(out.message, 'bad type');
  assert.equal(typeof out.stack, 'string');
});

test('serializeError includes own enumerable extras', () => {
  const err = Object.assign(new Error('http'), { statusCode: 503, code: 'EUNAVAIL' });
  const out = serializeError(err) as Record<string, unknown>;
  assert.equal(out.statusCode, 503);
  assert.equal(out.code, 'EUNAVAIL');
});

test('serializeError follows the cause chain', () => {
  const root = new Error('root');
  const wrapper = new Error('wrapper', { cause: root });
  const out = serializeError(wrapper) as Record<string, unknown>;
  const cause = out.cause as Record<string, unknown>;
  assert.equal(cause.message, 'root');
});

test('serializeError wraps non-error values', () => {
  const out = serializeError('just a string') as Record<string, unknown>;
  assert.equal(out.type, 'NonError');
  assert.equal(out.value, 'just a string');
});

test('normalizeLeaf handles primitives and specials', () => {
  assert.equal(normalizeLeaf('s'), 's');
  assert.equal(normalizeLeaf(true), true);
  assert.equal(normalizeLeaf(3.14), 3.14);
  assert.equal(normalizeLeaf(Infinity), 'Infinity');
  assert.equal(normalizeLeaf(10n), '10');
  assert.equal(normalizeLeaf(undefined), null);
  assert.equal(normalizeLeaf(null), null);
  assert.equal(normalizeLeaf(Symbol('x')), 'Symbol(x)');
});

test('normalizeLeaf renders functions and regexps descriptively', () => {
  assert.match(String(normalizeLeaf(function foo() {})), /\[Function: foo\]/);
  assert.equal(normalizeLeaf(/ab+c/i), '/ab+c/i');
});

test('normalizeLeaf converts Date to ISO and flags invalid dates', () => {
  assert.equal(normalizeLeaf(new Date('2020-01-01T00:00:00.000Z')), '2020-01-01T00:00:00.000Z');
  assert.equal(normalizeLeaf(new Date('nonsense')), 'Invalid Date');
});

test('normalizeLeaf uses toJSON when available', () => {
  const obj = { toJSON: () => ({ serialized: 1 }) };
  assert.deepEqual(normalizeLeaf(obj), { serialized: 1 });
});

test('normalizeLeaf survives a throwing toJSON', () => {
  const obj = {
    toJSON() {
      throw new Error('nope');
    },
  };
  assert.equal(normalizeLeaf(obj), '[unserializable]');
});

test('normalizeLeaf reports typed arrays by kind and size', () => {
  const buf = new Uint8Array([1, 2, 3, 4]);
  assert.match(String(normalizeLeaf(buf)), /Uint8Array: 4 bytes/);
});

test('isPlainContainer distinguishes containers from leaves', () => {
  assert.equal(isPlainContainer({ a: 1 }), true);
  assert.equal(isPlainContainer([1, 2]), true);
  assert.equal(isPlainContainer(new Map()), true);
  assert.equal(isPlainContainer(new Set()), true);
  assert.equal(isPlainContainer(new Error('x')), false);
  assert.equal(isPlainContainer(new Date()), false);
  assert.equal(isPlainContainer(/re/), false);
  assert.equal(isPlainContainer(new Uint8Array(1)), false);
  assert.equal(isPlainContainer(null), false);
  assert.equal(isPlainContainer('s'), false);
  assert.equal(isPlainContainer({ toJSON: () => 1 }), false);
});
