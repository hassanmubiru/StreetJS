import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeString, sanitizeDeep, escapeHtml } from '../xss.js';

test('sanitizeString strips angle brackets', () => {
  assert.equal(sanitizeString('<script>alert(1)</script>'), 'scriptalert(1)/script');
});

test('sanitizeString removes dangerous protocols', () => {
  assert.equal(sanitizeString('javascript:alert(1)'), 'alert(1)');
  assert.equal(sanitizeString('data:text/html,x'), 'text/html,x');
  assert.equal(sanitizeString('vbscript:msgbox'), 'msgbox');
});

test('sanitizeString removes event-handler attributes and null bytes', () => {
  assert.equal(sanitizeString('onclick=steal()'), 'steal()');
  assert.equal(sanitizeString('a\x00b'), 'ab');
});

test('sanitizeString reaches a fixed point (nested reconstitution)', () => {
  // "<scr<script>ipt>" would reconstitute to "<script>" after one pass;
  // the fixed-point loop keeps deleting until nothing dangerous remains.
  const nested = '<scr<script>ipt>';
  const out = sanitizeString(nested);
  assert.equal(out.includes('<'), false);
  assert.equal(out.includes('>'), false);
  // javascript: hidden behind a bracket that only appears after a pass
  assert.equal(sanitizeString('java<>script:x'), 'x');
});

test('sanitizeString caps very long input', () => {
  const long = 'a'.repeat(1_000_050);
  assert.equal(sanitizeString(long).length, 1_000_000);
});

test('sanitizeDeep sanitizes nested strings, keys, arrays', () => {
  const out = sanitizeDeep({
    'on<x>': '<b>hi</b>',
    list: ['<i>a', 'javascript:b'],
    n: 5,
    ok: true,
    nothing: null,
  }) as Record<string, unknown>;
  assert.ok('onx' in out); // key sanitized
  assert.equal(out.n, 5);
  assert.equal(out.ok, true);
  assert.equal(out.nothing, null);
  assert.deepEqual(out.list, ['ia', 'b']);
});

test('sanitizeDeep returns null past the max depth', () => {
  let obj: Record<string, unknown> = { leaf: 'x' };
  for (let i = 0; i < 40; i++) obj = { child: obj };
  const out = JSON.stringify(sanitizeDeep(obj));
  assert.match(out, /null/);
});

test('sanitizeDeep bounds array length', () => {
  const big = new Array(10_050).fill('x');
  const out = sanitizeDeep(big) as unknown[];
  assert.equal(out.length, 10_000);
});

test('sanitizeDeep bounds object key count', () => {
  const obj: Record<string, string> = {};
  for (let i = 0; i < 600; i++) obj[`k${i}`] = 'v';
  const out = sanitizeDeep(obj) as Record<string, unknown>;
  assert.ok(Object.keys(out).length <= 501);
});

test('sanitizeDeep passes primitives and nullish through', () => {
  assert.equal(sanitizeDeep(42), 42);
  assert.equal(sanitizeDeep(true), true);
  assert.equal(sanitizeDeep(null), null);
  assert.equal(sanitizeDeep(undefined), undefined);
  // functions/symbols → null (unhandled types)
  assert.equal(sanitizeDeep(() => {}), null);
});

test('escapeHtml escapes all entities', () => {
  assert.equal(escapeHtml(`<a href="/x">'&`), '&lt;a href=&quot;&#x2F;x&quot;&gt;&#x27;&amp;');
});
