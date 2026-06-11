// tests/encryption-roundtrip-pbt.test.ts
// Property-based test for field-level encryption (Phase 5, Requirement 6).
//
// Feature: consumer-platform-security, Property 12 — Field-encryption round-trip.
// Validates: Requirements 6.2, 6.3, 6.4, 6.5
//
// This file proves, across arbitrary supported plaintext values (the kinds of
// data an EncryptedField holds: message content, phone numbers, addresses,
// private notes, and structured profile metadata):
//   1. Round-trip (R6.3/R6.4): for all supported plaintext `x` and a given
//      keyring, `decrypt(encrypt(x))` returns a value deeply equal to `x`.
//   2. Ciphertext-at-rest (R6.2): the stored envelope holds AES-256-GCM
//      ciphertext, never the plaintext — the ciphertext bytes do not contain the
//      serialized plaintext.
//   3. Envelope encryption (R6.5): every produced envelope wraps a per-value DEK
//      under the keyring's current KEK version, and that wrapped DEK is required
//      to decrypt (the structure carries `v` + `wrappedDek`, not a bare key).
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// property is exercised across many generated inputs without disturbing the
// example/edge-case unit tests for the FieldCipher.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fc from 'fast-check';

import { FieldCipher, Keyring, isEncryptedField } from '../security/encrypted-field.js';

const NUM_RUNS = 100;

// ── Generators ────────────────────────────────────────────────────────────────

// Supported plaintext is any JSON-serializable value. We model the concrete
// shapes an EncryptedField is documented to hold (R6.1): free-text strings
// (message content / private notes), phone-number-like and address-like strings,
// numbers/booleans, and nested structured profile metadata.
const phoneArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...'0123456789'.split('')), { minLength: 7, maxLength: 15 })
  .map((d) => `+${d.join('')}`);

const scalarArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  phoneArb,
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null),
);

// JSON-serializable values up to a small depth (objects = profile metadata,
// arrays = repeated fields). letrec keeps nesting bounded and homogeneous-safe.
const plaintextArb: fc.Arbitrary<unknown> = fc.letrec<{ v: unknown }>((tie) => ({
  v: fc.oneof(
    { maxDepth: 3, withCrossShrink: true },
    scalarArb,
    fc.array(tie('v'), { maxLength: 4 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), tie('v'), { maxKeys: 4 }),
  ),
})).v;

/** Build a fresh single-entry keyring with a random 32-byte KEK. */
function freshCipher(version = 1): FieldCipher {
  return new FieldCipher(Keyring.fromKey(randomBytes(32), version));
}

// ── Property 12a: round-trip equality ───────────────────────────────────────────

// Feature: consumer-platform-security, Property 12: Field-encryption round-trip
// Validates: Requirements 6.3, 6.4
describe('Property 12: field-encryption round-trip', () => {
  it('decrypt(encrypt(x)) deeply equals x for all supported plaintext (R6.3/R6.4)', () => {
    fc.assert(
      fc.property(plaintextArb, fc.integer({ min: 0, max: 1_000_000 }), (value, version) => {
        const cipher = freshCipher(version);
        const field = cipher.encrypt(value);
        const recovered = cipher.decrypt(field);

        // Authorized read returns plaintext equal to what was assigned.
        assert.deepEqual(recovered, value);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: consumer-platform-security, Property 12: Field-encryption round-trip
  // Validates: Requirements 6.2
  it('stores AES-256-GCM ciphertext rather than plaintext (R6.2)', () => {
    fc.assert(
      // Strings give a concrete plaintext byte-sequence we can search the
      // ciphertext for; a non-empty string guarantees a non-trivial payload.
      fc.property(fc.string({ minLength: 1, maxLength: 64 }), (value) => {
        const cipher = freshCipher();
        const field = cipher.encrypt(value);

        assert.ok(isEncryptedField(field));
        const ctBytes = Buffer.from(field.envelope.ct, 'base64');
        const plainBytes = Buffer.from(JSON.stringify(value), 'utf8');

        // The ciphertext at rest must not contain the serialized plaintext.
        assert.equal(ctBytes.includes(plainBytes), false);
        // And it must still decrypt back to the original (it is real ciphertext,
        // not a lossy transform).
        assert.deepEqual(cipher.decrypt(field), value);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Feature: consumer-platform-security, Property 12: Field-encryption round-trip
  // Validates: Requirements 6.5
  it('wraps a per-value DEK under the current KEK version (envelope encryption, R6.5)', () => {
    fc.assert(
      fc.property(plaintextArb, fc.integer({ min: 0, max: 1_000_000 }), (value, version) => {
        const keyring = Keyring.fromKey(randomBytes(32), version);
        const cipher = new FieldCipher(keyring);
        const field = cipher.encrypt(value);

        // The envelope records the KEK version used to wrap the DEK, and carries
        // a wrapped DEK (not a bare key) — the hallmark of envelope encryption.
        assert.equal(field.envelope.v, keyring.current().version);
        assert.ok(field.envelope.wrappedDek.length > 0);

        // Two encryptions of the same value yield distinct DEKs/ciphertext (a
        // fresh DEK per value), yet both round-trip — confirming the DEK, not the
        // KEK, encrypts the payload.
        const field2 = cipher.encrypt(value);
        assert.notEqual(field.envelope.wrappedDek, field2.envelope.wrappedDek);
        assert.deepEqual(cipher.decrypt(field2), value);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
