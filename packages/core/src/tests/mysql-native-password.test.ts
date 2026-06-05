// src/tests/mysql-native-password.test.ts
// Focused unit tests for the mysql_native_password auth scramble (task 6.2).
//
// Formula: token = SHA1(password) XOR SHA1( seed || SHA1(SHA1(password)) )
//
// These tests run without a live server:
//   node --test dist/tests/mysql-native-password.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { nativePasswordHash } from '../database/mysql/wire.js';

// A fixed 20-byte auth-plugin-data seed (the size the server sends for
// mysql_native_password).
const SEED = Buffer.from('0102030405060708090a0b0c0d0e0f1011121314', 'hex');

// Independent reference implementation of the documented formula. Kept
// deliberately separate from the production code so the assertions below
// cross-check structure rather than re-use the same helper.
function referenceScramble(password: string, seed: Buffer): Buffer {
  const sha1 = (d: Buffer): Buffer => createHash('sha1').update(d).digest();
  const pw = Buffer.from(password, 'utf8');
  const h1 = sha1(pw);
  const h3 = sha1(Buffer.concat([seed, sha1(h1)]));
  const out = Buffer.alloc(20);
  for (let i = 0; i < 20; i++) out[i] = h1[i]! ^ h3[i]!;
  return out;
}

describe('mysql_native_password — scramble', () => {
  it('produces a 20-byte token (SHA1 digest width)', () => {
    const token = nativePasswordHash('password', SEED);
    assert.equal(token.length, 20);
  });

  it('matches a precomputed known vector for "password"', () => {
    const token = nativePasswordHash('password', SEED);
    assert.equal(token.toString('hex'), 'c17d6009a5cb47e59f7483fcf05553bbbf7dd0d6');
  });

  it('matches a precomputed known vector for "secret"', () => {
    const token = nativePasswordHash('secret', SEED);
    assert.equal(token.toString('hex'), 'b32bb3a583e1340c0a1108d58b1be49781ad8c2f');
  });

  it('matches an independent reference implementation', () => {
    for (const pw of ['password', 'secret', 'hunter2', 'p@ss w0rd!', 'unicodé-π']) {
      assert.deepEqual(nativePasswordHash(pw, SEED), referenceScramble(pw, SEED));
    }
  });

  it('satisfies the XOR identity: token XOR SHA1(pw) === SHA1(seed || SHA1(SHA1(pw)))', () => {
    const pw = 'password';
    const token = nativePasswordHash(pw, SEED);
    const sha1 = (d: Buffer): Buffer => createHash('sha1').update(d).digest();
    const h1 = sha1(Buffer.from(pw, 'utf8'));
    const h3 = sha1(Buffer.concat([SEED, sha1(h1)]));

    const recovered = Buffer.alloc(20);
    for (let i = 0; i < 20; i++) recovered[i] = token[i]! ^ h1[i]!;
    assert.deepEqual(recovered, h3);
  });

  it('is deterministic for identical inputs', () => {
    assert.deepEqual(
      nativePasswordHash('password', SEED),
      nativePasswordHash('password', SEED),
    );
  });

  it('produces a different token for a different seed', () => {
    const otherSeed = Buffer.from('1413121110100f0e0d0c0b0a0908070605040302', 'hex');
    assert.notDeepEqual(
      nativePasswordHash('password', SEED),
      nativePasswordHash('password', otherSeed),
    );
  });
});
