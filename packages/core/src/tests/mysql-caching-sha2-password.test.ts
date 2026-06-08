// src/tests/mysql-caching-sha2-password.test.ts
// Focused unit tests for the caching_sha2_password fast-auth scramble (task 6.3).
//
// Formula: response = SHA256(password) XOR SHA256( SHA256(SHA256(password)) || seed )
// Empty password yields an empty (zero-length) response.
//
// These tests run without a live server:
//   node --test dist/tests/mysql-caching-sha2-password.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { sha2PasswordHash } from '../database/mysql/wire.js';

// A fixed 20-byte auth-plugin-data seed (the size the server sends for
// caching_sha2_password, after the trailing NUL is stripped).
const SEED = Buffer.from('0102030405060708090a0b0c0d0e0f1011121314', 'hex');

// Independent reference implementation of the documented formula. Kept
// deliberately separate from the production code so the assertions below
// cross-check structure rather than re-use the same helper.
function referenceScramble(password: string, seed: Buffer): Buffer {
  if (password.length === 0) return Buffer.alloc(0);
  // codeql[js/insufficient-password-hash] -- protocol-mandated MySQL wire-protocol challenge-response (caching_sha2_password), not at-rest storage
  const sha256 = (d: Buffer): Buffer => createHash('sha256').update(d).digest();
  const a = sha256(Buffer.from(password, 'utf8'));
  const b = sha256(a);
  const c = sha256(Buffer.concat([b, seed]));
  const out = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) out[i] = a[i]! ^ c[i]!;
  return out;
}

describe('caching_sha2_password — fast-auth scramble', () => {
  it('produces a 32-byte token (SHA-256 digest width)', () => {
    const token = sha2PasswordHash('password', SEED);
    assert.equal(token.length, 32);
  });

  it('matches a precomputed known vector for "password"', () => {
    const token = sha2PasswordHash('password', SEED);
    assert.equal(
      token.toString('hex'),
      'f7ab1c623a6e98dceab35e926290e5746a3141116115f4dd8ccca994393eccdd',
    );
  });

  it('matches a precomputed known vector for "secret"', () => {
    const token = sha2PasswordHash('secret', SEED);
    assert.equal(
      token.toString('hex'),
      '746ebe205d56a0707acb3e796e834e0dd7b1d61743b26bd5202c7a623230c7c9',
    );
  });

  it('matches an independent reference implementation', () => {
    for (const pw of ['password', 'secret', 'hunter2', 'p@ss w0rd!', 'unicodé-π']) {
      assert.deepEqual(sha2PasswordHash(pw, SEED), referenceScramble(pw, SEED));
    }
  });

  it('returns an empty response for an empty password', () => {
    const token = sha2PasswordHash('', SEED);
    assert.equal(token.length, 0);
    assert.deepEqual(token, Buffer.alloc(0));
  });

  it('satisfies the XOR identity: token XOR SHA256(pw) === SHA256(SHA256(SHA256(pw)) || seed)', () => {
    const pw = 'password';
    const token = sha2PasswordHash(pw, SEED);
    // codeql[js/insufficient-password-hash] -- protocol-mandated MySQL wire-protocol challenge-response (caching_sha2_password), not at-rest storage
    const sha256 = (d: Buffer): Buffer => createHash('sha256').update(d).digest();
    const a = sha256(Buffer.from(pw, 'utf8'));
    const c = sha256(Buffer.concat([sha256(a), SEED]));

    const recovered = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) recovered[i] = token[i]! ^ a[i]!;
    assert.deepEqual(recovered, c);
  });

  it('is deterministic for identical inputs', () => {
    assert.deepEqual(
      sha2PasswordHash('password', SEED),
      sha2PasswordHash('password', SEED),
    );
  });

  it('produces a different token for a different seed', () => {
    const otherSeed = Buffer.from('1413121110100f0e0d0c0b0a0908070605040302', 'hex');
    assert.notDeepEqual(
      sha2PasswordHash('password', SEED),
      sha2PasswordHash('password', otherSeed),
    );
  });
});
