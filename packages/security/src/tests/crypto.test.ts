import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import {
  KeyRing,
  FieldCipher,
  EncryptionError,
  generateEncryptionKey,
  timingSafeStringEqual,
} from '../index.js';

const KEY_A = generateEncryptionKey(); // 64-char hex
const KEY_B = generateEncryptionKey();

test('generateEncryptionKey produces distinct 32-byte hex keys', () => {
  assert.match(KEY_A, /^[0-9a-f]{64}$/);
  assert.notEqual(KEY_A, KEY_B);
});

test('FieldCipher round-trips a value', () => {
  const cipher = new FieldCipher(KEY_A);
  const token = cipher.encrypt('sensitive@example.com');
  assert.notMatch(token, /sensitive/); // ciphertext, not plaintext
  assert.equal(cipher.decrypt(token), 'sensitive@example.com');
});

test('encryption is non-deterministic (random IV per call) but both decrypt', () => {
  const cipher = new FieldCipher(KEY_A);
  const a = cipher.encrypt('x');
  const b = cipher.encrypt('x');
  assert.notEqual(a, b);
  assert.equal(cipher.decrypt(a), 'x');
  assert.equal(cipher.decrypt(b), 'x');
});

test('accepts Buffer, hex, and base64 keys of 32 bytes; rejects wrong lengths', () => {
  const raw = randomBytes(32);
  assert.equal(new FieldCipher(raw).decrypt(new FieldCipher(raw).encrypt('v')), 'v');
  assert.equal(new FieldCipher(raw.toString('base64')).tryDecrypt(new FieldCipher(raw.toString('base64')).encrypt('v')), 'v');
  assert.throws(() => new FieldCipher('deadbeef'), EncryptionError); // too short
  assert.throws(() => new FieldCipher(randomBytes(16)), /must be 32 bytes/);
});

test('AAD binds a ciphertext to its context', () => {
  const cipher = new FieldCipher(KEY_A);
  const token = cipher.encrypt('42', 'user:7:ssn');
  assert.equal(cipher.decrypt(token, 'user:7:ssn'), '42');
  // Wrong AAD → authentication failure.
  assert.throws(() => cipher.decrypt(token, 'user:8:ssn'), EncryptionError);
  assert.equal(cipher.tryDecrypt(token, 'user:8:ssn'), null);
  // Missing AAD when it was required also fails.
  assert.throws(() => cipher.decrypt(token), EncryptionError);
});

test('tampering with the ciphertext or tag is detected', () => {
  const cipher = new FieldCipher(KEY_A);
  const token = cipher.encrypt('hello');
  const parts = token.split('.');
  // Flip a byte in the ciphertext segment.
  const ctBuf = Buffer.from(parts[3]!, 'base64url');
  ctBuf[0] ^= 0xff;
  parts[3] = ctBuf.toString('base64url');
  assert.throws(() => cipher.decrypt(parts.join('.')), EncryptionError);
});

test('malformed tokens are rejected with EncryptionError', () => {
  const cipher = new FieldCipher(KEY_A);
  assert.throws(() => cipher.decrypt('not-a-token'), /malformed ciphertext token/);
  assert.throws(() => cipher.decrypt('sjc1.0.aaa'), /malformed ciphertext token/); // wrong part count
  assert.throws(() => cipher.decrypt('xxxx.0.a.b.c'), /malformed ciphertext token/); // bad prefix
  // Valid shape but bad IV length.
  assert.throws(() => cipher.decrypt(['sjc1', '0', Buffer.from('short').toString('base64url'), 'AAAA', Buffer.alloc(16).toString('base64url')].join('.')), /malformed ciphertext parameters/);
});

test('KeyRing rotation: new writes use the new key; old ciphertexts still decrypt', () => {
  const ring = new KeyRing([{ id: 'k1', key: KEY_A }]);
  assert.equal(ring.primaryId, 'k1');
  const old = ring.encrypt('legacy');
  assert.equal(KeyRing.keyIdOf(old), 'k1');

  // Rotate to a new primary key.
  ring.addKey('k2', KEY_B); // makePrimary defaults to true
  assert.equal(ring.primaryId, 'k2');
  const fresh = ring.encrypt('current');
  assert.equal(KeyRing.keyIdOf(fresh), 'k2');

  // Both decrypt after rotation.
  assert.equal(ring.decrypt(old), 'legacy');
  assert.equal(ring.decrypt(fresh), 'current');
  assert.deepEqual(ring.keyIds().sort(), ['k1', 'k2']);
});

test('KeyRing addKey with makePrimary:false keeps the current primary; rotateTo switches', () => {
  const ring = new KeyRing([{ id: 'k1', key: KEY_A }]);
  ring.addKey('k2', KEY_B, { makePrimary: false });
  assert.equal(ring.primaryId, 'k1');
  ring.rotateTo('k2');
  assert.equal(ring.primaryId, 'k2');
  assert.throws(() => ring.rotateTo('nope'), /unknown key id/);
});

test('KeyRing decrypt fails for a token under an unknown key id', () => {
  const ringA = new KeyRing([{ id: 'k1', key: KEY_A }]);
  const ringB = new KeyRing([{ id: 'k9', key: KEY_B }]);
  const token = ringA.encrypt('secret');
  assert.throws(() => ringB.decrypt(token), /unknown key id "k1"/);
  assert.equal(ringB.tryDecrypt(token), null);
});

test('KeyRing validates construction and key ids', () => {
  assert.throws(() => new KeyRing([]), /at least one key/);
  assert.throws(() => new KeyRing([{ id: 'bad id', key: KEY_A }]), /invalid key id/);
  assert.throws(() => new KeyRing([{ id: 'k1', key: KEY_A }], 'missing'), /not in the ring/);
});

test('KeyRing.keyIdOf returns null for malformed tokens', () => {
  assert.equal(KeyRing.keyIdOf('nope'), null);
  assert.equal(KeyRing.keyIdOf('sjc1.k1.a.b.c'), 'k1');
});

test('timingSafeStringEqual compares without length leak', () => {
  assert.equal(timingSafeStringEqual('abc', 'abc'), true);
  assert.equal(timingSafeStringEqual('abc', 'abd'), false);
  assert.equal(timingSafeStringEqual('abc', 'abcd'), false); // differing lengths
});
