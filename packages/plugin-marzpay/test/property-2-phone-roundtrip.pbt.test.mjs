// Feature: marzpay-scope-alignment, Property 2: Phone formatting round-trip and idempotence
//
// Property 2 (design): phone formatting round-trip and idempotence.
//   For any value `v`:
//     • if utils.isValidPhoneNumber(v) is true, then
//         - utils.isValidPhoneNumber(utils.formatPhoneNumber(v)) is true, and
//         - utils.formatPhoneNumber(utils.formatPhoneNumber(v)) === utils.formatPhoneNumber(v)
//           (idempotence — the canonical form is a fixed point).
//     • if utils.isValidPhoneNumber(v) is false, then utils.formatPhoneNumber(v)
//       throws rather than returning an invalid string.
//
// The validity check is the gate (never assume an arbitrary string is invalid):
// whatever isValidPhoneNumber decides drives which branch is asserted. This keeps
// the property total over the entire input space.
//
// Pure/offline — nothing here touches the network.
// Run: node --test test/property-2-phone-roundtrip.pbt.test.mjs
//
// Validates: Requirements 11.1, 11.2, 11.4, 14.4

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { createUtilsNamespace } from '../dist/index.js';

const utils = createUtilsNamespace();

const NUM_RUNS = 200; // >= 100 iterations as required.

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A separator character that the normalizer strips: whitespace, dash, parens. */
const separator = fc.constantFrom(' ', '\t', '\n', '-', '(', ')', '  ', ' - ');

/** The 9-digit national significant number: `7` followed by 8 digits. */
const nationalNumber = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 8, maxLength: 8 })
  .map((digits) => `7${digits.join('')}`);

/** One of the accepted prefix shapes for a 9-digit national number. */
const prefix = fc.constantFrom('+256', '256', '0', '');

/**
 * Sprinkle separator characters between the characters of `core`. Because the
 * normalizer removes every `[\s\-()]` before parsing, inserting them anywhere
 * preserves validity, exercising the "optional separator whitespace/dashes/parens"
 * requirement.
 */
function intersperseSeparators(core) {
  return fc
    .array(separator, { minLength: 0, maxLength: core.length + 1 })
    .map((seps) => {
      const chars = core.split('');
      let out = seps[0] ?? '';
      for (let i = 0; i < chars.length; i++) {
        out += chars[i];
        out += seps[i + 1] ?? '';
      }
      return out;
    });
}

/** A valid Uganda MSISDN in one of the documented shapes, with optional separators. */
const validMsisdn = fc
  .tuple(prefix, nationalNumber)
  .chain(([p, national]) => intersperseSeparators(`${p}${national}`));

/** Arbitrary strings for the invalid branch (occasionally valid — gated below). */
const arbitraryString = fc.string();

// ---------------------------------------------------------------------------
// Property 2 — valid side: round-trip + idempotence
// ---------------------------------------------------------------------------

describe('Property 2: phone formatting round-trip and idempotence (valid side)', () => {
  it('formatted output is valid and formatting is idempotent for accepted values', () => {
    fc.assert(
      fc.property(validMsisdn, (v) => {
        // Precondition: our generator only yields values the validator accepts.
        assert.equal(utils.isValidPhoneNumber(v), true, `expected ${JSON.stringify(v)} to be valid`);

        const formatted = utils.formatPhoneNumber(v);

        // Round-trip: the formatted output is itself accepted.
        assert.equal(
          utils.isValidPhoneNumber(formatted),
          true,
          `expected formatted ${JSON.stringify(formatted)} to be valid`,
        );

        // Canonical shape.
        assert.match(formatted, /^\+2567\d{8}$/);

        // Idempotence: formatting the canonical form is a fixed point.
        assert.equal(utils.formatPhoneNumber(formatted), formatted);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 — total over all inputs: validity gates the branch.
// ---------------------------------------------------------------------------

describe('Property 2: validity gates formatting behavior (total over all inputs)', () => {
  it('valid ⇒ round-trip + idempotent; invalid ⇒ formatPhoneNumber throws', () => {
    fc.assert(
      fc.property(fc.oneof(validMsisdn, arbitraryString), (v) => {
        if (utils.isValidPhoneNumber(v)) {
          const formatted = utils.formatPhoneNumber(v);
          assert.equal(utils.isValidPhoneNumber(formatted), true);
          assert.equal(utils.formatPhoneNumber(formatted), formatted);
        } else {
          // Must throw rather than return an invalid string.
          assert.throws(() => utils.formatPhoneNumber(v));
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
