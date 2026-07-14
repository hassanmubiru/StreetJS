import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DefaultRedactor, createRedactor, DEFAULT_REDACT_KEYS } from '../redaction.js';
import type { Redactor } from '../types.js';

test('default key set is applied at any depth, case-insensitively', () => {
  const r = new DefaultRedactor();
  const out = r.redact({
    user: 'alice',
    password: 'hunter2',
    nested: { Authorization: 'Bearer x', apiKey: 'k' },
  });
  assert.equal(out.user, 'alice');
  assert.equal(out.password, '[Redacted]');
  const nested = out.nested as Record<string, unknown>;
  assert.equal(nested.Authorization, '[Redacted]');
  assert.equal(nested.apiKey, '[Redacted]');
});

test('DEFAULT_REDACT_KEYS is a non-empty frozen list', () => {
  assert.ok(DEFAULT_REDACT_KEYS.length > 0);
  assert.ok(Object.isFrozen(DEFAULT_REDACT_KEYS));
});

test('custom keys extend defaults', () => {
  const r = new DefaultRedactor({ keys: ['ssn'] });
  const out = r.redact({ ssn: '123-45-6789', token: 't' });
  assert.equal(out.ssn, '[Redacted]');
  assert.equal(out.token, '[Redacted]');
});

test('useDefaults false disables the built-in set', () => {
  const r = new DefaultRedactor({ useDefaults: false, keys: ['ssn'] });
  const out = r.redact({ ssn: 'x', password: 'still visible' });
  assert.equal(out.ssn, '[Redacted]');
  assert.equal(out.password, 'still visible');
});

test('path patterns censor an exact location with wildcards', () => {
  const r = new DefaultRedactor({
    useDefaults: false,
    paths: ['req.headers.authorization', 'users.*.card'],
  });
  const out = r.redact({
    req: { headers: { authorization: 'Bearer x', accept: 'json' } },
    users: [{ card: '4111', name: 'a' }, { card: '4222', name: 'b' }],
  });
  const req = out.req as Record<string, Record<string, unknown>>;
  assert.equal(req.headers.authorization, '[Redacted]');
  assert.equal(req.headers.accept, 'json');
  const users = out.users as Array<Record<string, unknown>>;
  assert.equal(users[0].card, '[Redacted]');
  assert.equal(users[0].name, 'a');
  assert.equal(users[1].card, '[Redacted]');
});

test('custom censor string is used', () => {
  const r = new DefaultRedactor({ keys: ['x'], useDefaults: false, censor: '***' });
  assert.equal(r.redact({ x: 1 }).x, '***');
});

test('circular references are replaced with a marker', () => {
  const r = new DefaultRedactor({ useDefaults: false });
  const obj: Record<string, unknown> = { a: 1 };
  obj.self = obj;
  const out = r.redact(obj);
  assert.equal(out.a, 1);
  assert.equal(out.self, '[Circular]');
});

test('Map and Set are walked and redacted', () => {
  const r = new DefaultRedactor();
  const out = r.redact({
    m: new Map<string, unknown>([
      ['password', 'p'],
      ['ok', 1],
    ]),
    s: new Set(['a', 'b']),
  });
  const m = out.m as Record<string, unknown>;
  assert.equal(m.password, '[Redacted]');
  assert.equal(m.ok, 1);
  assert.deepEqual(out.s, ['a', 'b']);
});

test('deeply nested structures beyond max depth are truncated', () => {
  const r = new DefaultRedactor({ useDefaults: false });
  let node: Record<string, unknown> = { leaf: true };
  for (let i = 0; i < 40; i++) {
    node = { child: node };
  }
  const out = r.redact(node);
  const serialized = JSON.stringify(out);
  assert.match(serialized, /\[Truncated: max depth\]/);
});

test('input object is not mutated', () => {
  const r = new DefaultRedactor();
  const input = { password: 'secret', keep: 1 };
  r.redact(input);
  assert.equal(input.password, 'secret');
});

test('createRedactor passes through an existing redactor', () => {
  const custom: Redactor = {
    redact() {
      return { marked: true };
    },
  };
  const r = createRedactor(custom);
  assert.equal(r, custom);
  assert.deepEqual(r.redact({ anything: 1 }), { marked: true });
});

test('createRedactor builds a DefaultRedactor from options', () => {
  const r = createRedactor({ keys: ['zzz'], useDefaults: false });
  assert.ok(r instanceof DefaultRedactor);
  assert.equal(r.redact({ zzz: 1 }).zzz, '[Redacted]');
});

test('createRedactor with no argument uses defaults', () => {
  const r = createRedactor();
  assert.equal(r.redact({ token: 't' }).token, '[Redacted]');
});
