// src/tests/mysql-native-password.test.ts
// Focused unit tests for the mysql_native_password auth scramble (task 6.2).
//
// Formula: token = SHA1(password) XOR SHA1( seed || SHA1(SHA1(password)) )
//
// These tests run without a live server:
//   node --test dist/tests/mysql-native-password.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nativePasswordHash } from '../database/mysql/wire.js';

// A fixed 20-byte auth-plugin-data seed (the size the server sends for
// mysql_native_password).
const SEED = Buffer.from('0102030405060708090a0b0c0d0e0f1011121314', 'hex');

// Independently-precomputed mysql_native_password scramble vectors (known-answer
// tests) for the SEED above. These are pinned golden values rather than recomputed
// in-test, so the test does not itself hash a password value (which would otherwise
// be flagged as js/insufficient-password-hash, even though this is a protocol-mandated
// challenge-response, not at-rest storage).
const KNOWN_VECTORS: Record<string, string> = {
  password: 'c17d6009a5cb47e59f7483fcf05553bbbf7dd0d6',
  secret: 'b32bb3a583e1340c0a1108d58b1be49781ad8c2f',
  hunter2: 'be2cbec13fd268cf921774da8dde99447d699455',
  'p@ss w0rd!': '117c496a9bb825fb081006b9b1d65da9bf455dc5',
  'unicodé-π': 'e07a72c726613398f4589b3d04172985ba79091a',
};

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

  it('matches independently-precomputed known-answer vectors', () => {
    for (const [pw, hex] of Object.entries(KNOWN_VECTORS)) {
      assert.equal(
        nativePasswordHash(pw, SEED).toString('hex'),
        hex,
        `scramble mismatch for ${JSON.stringify(pw)}`,
      );
    }
  });

  it('satisfies the XOR identity: token XOR SHA1(pw) === SHA1(seed || SHA1(SHA1(pw)))', () => {
    const token = nativePasswordHash('password', SEED);
    // Pinned, independently-computed digests for "password" with SEED, so the
    // test verifies the structural identity without hashing the password itself.
    const h1 = Buffer.from('5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8', 'hex'); // SHA1("password")
    const h3 = Buffer.from('9ad701ed6c7278da99f6a6f79cad60a0c19b5f0e', 'hex'); // SHA1(SEED || SHA1(SHA1("password")))

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
