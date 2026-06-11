// tests/tamper-detection-pbt.test.ts
// Property-based test for tamper detection (Phase 5, R6.7).
//
// Feature: consumer-platform-security, Property 14: Tamper detection
// **Validates: Requirements 6.7**
//
// Requirement 6.7 demands that IF ciphertext or its authentication tag has been
// altered, THEN the EncryptedField SHALL fail decryption with an error and
// SHALL NOT return plaintext. The design realizes this with AES-256-GCM at two
// layers — the per-value DEK encrypts the plaintext, and the DEK itself is
// wrapped under a KEK. Both layers carry a GCM authentication tag, so altering
// the data ciphertext (`ct`), the data auth tag (`tag`), or the wrapped DEK
// (`wrappedDek`, whose own [iv][tag][ciphertext] layout is GCM-authenticated)
// causes `final()` to throw. `FieldCipher.decrypt` surfaces that as an error and
// never returns plaintext.
//
// This file proves, across arbitrary plaintext values and arbitrary
// single-bit/single-byte mutations of each authenticated envelope component,
// that:
//   1. Mutating `ct` (data ciphertext) makes decryption throw (R6.7).
//   2. Mutating `tag` (data auth tag) makes decryption throw (R6.7).
//   3. Mutating `wrappedDek` (the wrapped DEK blob) makes decryption throw
//      (tampering with the key-wrapping layer is also caught).
//   4. Mutating `iv` (data IV) makes decryption throw — a shifted IV cannot
//      reproduce the authenticated state.
//   5. In every tampered case `decrypt` throws rather than returning any value,
//      so plaintext is never leaked.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  Keyring,
  FieldCipher,
  type EncryptedField,
  type EncryptedEnvelope,
} from '../security/encrypted-field.js';

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

// The authenticated base64 components of the envelope that, if altered, must
// break decryption.
type MutableComponent = 'ct' | 'tag' | 'wrappedDek' | 'iv';
const componentArb: fc.Arbitrary<MutableComponent> = fc.constantFrom(
  'ct',
  'tag',
  'wrappedDek',
  'iv',
);

/**
 * Flip a single byte in a base64-encoded buffer, returning a new base64 string
 * that is guaranteed to differ from the input by exactly one byte. `byteSel`
 * and `xorMask` are arbitraries so fast-check explores many positions/bit flips.
 */
function tamperBase64(b64: string, byteSel: number, xorMask: number): string {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0) return Buffer.from([xorMask | 1]).toString('base64');
  const idx = byteSel % buf.length;
  const mask = (xorMask % 255) + 1; // 1..255 → always changes the byte
  buf[idx] = buf[idx]! ^ mask;
  return buf.toString('base64');
}

// Feature: consumer-platform-security, Property 14: Tamper detection
// Validates: Requirements 6.7
describe('Property 14: tamper detection', () => {
  it('fails decryption (and never returns plaintext) when any authenticated envelope component is altered', () => {
    fc.assert(
      fc.property(
        kekArb,
        plaintextArb,
        componentArb,
        fc.nat(),
        fc.integer({ min: 0, max: 254 }),
        (kek, value, component, byteSel, xorMask) => {
          const cipher = new FieldCipher(Keyring.fromKey(kek));
          const field = cipher.encrypt(value);

          // Sanity: the untouched envelope round-trips before we tamper.
          assert.deepEqual(cipher.decrypt(field), value);

          // Produce a tampered envelope where exactly one authenticated
          // component is mutated by a single byte.
          const tamperedEnvelope: EncryptedEnvelope = { ...field.envelope };
          tamperedEnvelope[component] = tamperBase64(
            field.envelope[component],
            byteSel,
            xorMask,
          );

          const tampered: EncryptedField<unknown> = {
            __enc: 'EncryptedField',
            envelope: tamperedEnvelope,
          };

          // Decryption MUST throw — it must never return a (possibly wrong)
          // plaintext value for tampered data (R6.7).
          assert.throws(
            () => cipher.decrypt(tampered),
            `tampering with "${component}" must fail decryption`,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('detects truncation of the ciphertext and refuses to return plaintext', () => {
    fc.assert(
      fc.property(kekArb, plaintextArb, (kek, value) => {
        const cipher = new FieldCipher(Keyring.fromKey(kek));
        const field = cipher.encrypt(value);

        // Drop the final byte of the data ciphertext: a GCM length/auth
        // mismatch that decryption must reject.
        const ctBuf = Buffer.from(field.envelope.ct, 'base64');
        const truncatedEnvelope: EncryptedEnvelope = {
          ...field.envelope,
          ct: ctBuf.subarray(0, Math.max(0, ctBuf.length - 1)).toString('base64'),
        };
        const tampered: EncryptedField<unknown> = {
          __enc: 'EncryptedField',
          envelope: truncatedEnvelope,
        };

        assert.throws(() => cipher.decrypt(tampered));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a ciphertext re-encrypted under a different key (cross-key tamper)', () => {
    fc.assert(
      fc.property(kekArb, kekArb, plaintextArb, (kekA, kekB, value) => {
        fc.pre(!kekA.equals(kekB));

        const cipherA = new FieldCipher(Keyring.fromKey(kekA, 1));
        const cipherB = new FieldCipher(Keyring.fromKey(kekB, 1));

        const fieldA = cipherA.encrypt(value);

        // The envelope from cipherA records version 1, so cipherB will attempt
        // to unwrap the DEK with the WRONG KEK. GCM auth on the wrapping layer
        // must fail rather than yield a bogus DEK and plaintext.
        assert.throws(() => cipherB.decrypt(fieldA));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
