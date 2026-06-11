// tests/encryption-key-rotation-pbt.test.ts
// Property-based test for key-rotation decryptability (Phase 5, R6.6).
//
// Feature: consumer-platform-security, Property 13: Key rotation preserves decryptability
// **Validates: Requirements 6.6**
//
// Requirement 6.6 demands that WHEN a Key_Encryption_Key is rotated, the
// EncryptedField SHALL continue to decrypt values that were encrypted under a
// previous Key_Encryption_Key. The design realizes this with envelope
// encryption over a versioned `Keyring`: each `EncryptedEnvelope` records the
// KEK version (`v`) used to wrap its per-value DEK, so adding a higher KEK
// version (rotation) never invalidates historical envelopes — the older KEK is
// retained and selected by version at decrypt time.
//
// This file proves, across arbitrary plaintext values and arbitrary rotation
// histories (a growing keyring of distinct 32-byte KEKs at increasing
// versions), that:
//   1. Cross-rotation decryptability (R6.6): a value encrypted under any
//      historical keyring state still decrypts to the original plaintext after
//      one or more subsequent rotations, using a cipher built on the fully
//      rotated keyring.
//   2. New writes use the current (highest) KEK: after rotation, freshly
//      encrypted envelopes carry the newest version, and still round-trip.
//   3. Retiring an old KEK breaks decryption of data wrapped under it: if the
//      rotated keyring no longer contains the version recorded in an old
//      envelope, decryption fails rather than silently returning wrong data.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { Keyring, FieldCipher, type KeyringEntry } from '../security/encrypted-field.js';

const NUM_RUNS = 100;

// ── Generators ────────────────────────────────────────────────────────────────

// A 32-byte AES-256 KEK.
const kekArb: fc.Arbitrary<Buffer> = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((a) => Buffer.from(a));

// JSON-serializable plaintext values the EncryptedField is meant to protect
// (message content, phone numbers, addresses, private notes, profile metadata).
const plaintextArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.record({
    phone: fc.string(),
    note: fc.string(),
    age: fc.integer({ min: 0, max: 120 }),
  }),
  fc.array(fc.string(), { maxLength: 5 }),
);

// A rotation history: a sequence of distinct KEKs at strictly increasing
// versions. We generate N distinct KEKs and assign them versions 1..N; "rotating"
// means revealing the keyring with one more entry than the previous state.
interface RotationCase {
  keks: Buffer[]; // index i ⇒ version i+1
}

const rotationArb: fc.Arbitrary<RotationCase> = fc
  // At least 2 versions so there is something to rotate to.
  .array(kekArb, { minLength: 2, maxLength: 6 })
  .map((keks) => ({ keks }));

/** Build a keyring containing versions 1..count from the rotation history. */
function keyringUpTo(keks: Buffer[], count: number): Keyring {
  const entries: KeyringEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({ version: i + 1, kek: keks[i]! });
  }
  return new Keyring(entries);
}

// Feature: consumer-platform-security, Property 13: Key rotation preserves decryptability
// Validates: Requirements 6.6
describe('Property 13: key rotation preserves decryptability', () => {
  it('decrypts values encrypted under any previous KEK after one or more rotations', () => {
    fc.assert(
      fc.property(rotationArb, plaintextArb, ({ keks }, value) => {
        const total = keks.length;

        // Encrypt the same value at each historical keyring state: after
        // version 1 is live, after version 2 is live, ... up to the full set.
        // Each ciphertext is wrapped under whatever the "current" KEK was at
        // that point in history.
        const envelopes = [];
        for (let live = 1; live <= total; live++) {
          const cipher = new FieldCipher(keyringUpTo(keks, live));
          const field = cipher.encrypt(value);
          // The envelope records the current (highest available) version.
          assert.equal(field.envelope.v, live);
          envelopes.push(field);
        }

        // After the final rotation, a cipher built on the FULLY rotated keyring
        // must still decrypt every historical envelope back to the original
        // plaintext (R6.6) — old data survives every intervening rotation.
        const rotated = new FieldCipher(keyringUpTo(keks, total));
        for (const field of envelopes) {
          assert.deepEqual(rotated.decrypt(field), value);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('uses the newest KEK for fresh writes after rotation and still round-trips', () => {
    fc.assert(
      fc.property(rotationArb, plaintextArb, ({ keks }, value) => {
        const total = keks.length;
        const rotated = new FieldCipher(keyringUpTo(keks, total));

        const field = rotated.encrypt(value);
        // New writes bind to the current (highest) version (R6.5/6.6).
        assert.equal(field.envelope.v, total);
        assert.deepEqual(rotated.decrypt(field), value);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('fails to decrypt when the KEK version recorded in an old envelope has been retired', () => {
    fc.assert(
      fc.property(rotationArb, plaintextArb, ({ keks }, value) => {
        const total = keks.length;

        // Encrypt under version 1 (the oldest KEK).
        const oldCipher = new FieldCipher(keyringUpTo(keks, 1));
        const field = oldCipher.encrypt(value);
        assert.equal(field.envelope.v, 1);

        // A keyring that no longer carries version 1 (only the newer versions
        // 2..total) cannot unwrap the DEK, so decryption MUST throw rather than
        // return plaintext.
        const newerEntries: KeyringEntry[] = [];
        for (let i = 1; i < total; i++) {
          newerEntries.push({ version: i + 1, kek: keks[i]! });
        }
        const rotatedWithoutOld = new FieldCipher(new Keyring(newerEntries));
        assert.throws(() => rotatedWithoutOld.decrypt(field));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
