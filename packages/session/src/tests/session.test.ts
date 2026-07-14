import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { SessionManager } from '../session.js';
import { SESSION_MANAGER } from '../index.js';

const KEY = randomBytes(32).toString('hex'); // 64-char hex, high entropy

test('constructor rejects a key of the wrong length', () => {
  assert.throws(() => new SessionManager('too-short'), /64-char hex/);
  assert.throws(() => new SessionManager('a'.repeat(63)), /64-char hex/);
});

test('constructor rejects a low-entropy key', () => {
  assert.throws(() => new SessionManager('00'.repeat(32)), /insufficient entropy/);
});

test('constructor accepts a key on the entropy boundary (8 unique bytes)', () => {
  // 0123456789abcdef repeated → exactly 8 distinct byte values.
  assert.doesNotThrow(() => new SessionManager('0123456789abcdef'.repeat(4)));
});

test('encrypt then decrypt round-trips the data', () => {
  const sm = new SessionManager(KEY);
  const data = { userId: '7', email: 'a@b.c', roles: ['admin', 'user'], csrf: 'x', extra: { n: 1 } };
  const token = sm.encrypt(data);
  assert.deepEqual(sm.decrypt(token), data);
});

test('encryption is non-deterministic (random IV per call)', () => {
  const sm = new SessionManager(KEY);
  const a = sm.encrypt({ userId: '1' });
  const b = sm.encrypt({ userId: '1' });
  assert.notEqual(a, b);
  assert.deepEqual(sm.decrypt(a), sm.decrypt(b));
});

test('a tampered token fails authentication and returns null', () => {
  const sm = new SessionManager(KEY);
  const token = sm.encrypt({ userId: '7' });
  const buf = Buffer.from(token, 'base64');
  buf[buf.length - 1] ^= 0xff; // flip a ciphertext byte
  assert.equal(sm.decrypt(buf.toString('base64')), null);
});

test('a token from a different key returns null', () => {
  const a = new SessionManager(KEY);
  const b = new SessionManager(randomBytes(32).toString('hex'));
  assert.equal(b.decrypt(a.encrypt({ userId: '7' })), null);
});

test('malformed or too-short blobs return null', () => {
  const sm = new SessionManager(KEY);
  assert.equal(sm.decrypt('not-base64-!!!'), null);
  assert.equal(sm.decrypt(''), null);
  assert.equal(sm.decrypt(Buffer.from('short').toString('base64')), null);
});

test('generateCsrf and generateSessionId return distinct random tokens', () => {
  assert.notEqual(SessionManager.generateCsrf(), SessionManager.generateCsrf());
  assert.notEqual(SessionManager.generateSessionId(), SessionManager.generateSessionId());
  assert.match(SessionManager.generateCsrf(), /^[A-Za-z0-9_-]+$/); // base64url
  assert.match(SessionManager.generateSessionId(), /^[A-Za-z0-9_-]+$/);
});

test('DI token is a stable global symbol', () => {
  assert.equal(SESSION_MANAGER, Symbol.for('@streetjs/session:SessionManager'));
});
