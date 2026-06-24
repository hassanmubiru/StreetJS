// packages/plugin-marzpay/test/utils-namespace.test.mjs
// Unit tests (example-based) for the `marzpay.utils` namespace (Task 4.2).
//
// The namespace exposes ONLY two phone helpers, both delegating to the single
// internal Uganda-MSISDN normalizer (no new validation implementation):
//   • isValidPhoneNumber(value) → true/false
//   • formatPhoneNumber(value)  → canonical +2567XXXXXXXX, or throws
//
// Pure/offline — nothing here touches the network. Complements the phone
// round-trip property test (Property 2) by pinning concrete accept/reject and
// round-trip examples for the namespace surface.
// Run: npm test -w packages/plugin-marzpay
//
// Validates: Requirements 11.1, 11.2, 11.4, 11.5

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createUtilsNamespace } from '../dist/index.js';

const utils = createUtilsNamespace();

describe('marzpay.utils namespace surface', () => {
  it('exposes ONLY formatPhoneNumber and isValidPhoneNumber (Req 11.5)', () => {
    assert.deepEqual(Object.keys(utils).sort(), ['formatPhoneNumber', 'isValidPhoneNumber']);
    assert.equal(typeof utils.formatPhoneNumber, 'function');
    assert.equal(typeof utils.isValidPhoneNumber, 'function');
  });
});

describe('marzpay.utils.isValidPhoneNumber (Req 11.2)', () => {
  it('accepts the documented Uganda MSISDN shapes', () => {
    for (const v of ['+256712345678', '256712345678', '0712345678', '712345678']) {
      assert.equal(utils.isValidPhoneNumber(v), true, `expected ${v} to be valid`);
    }
  });

  it('accepts values with separator whitespace, dashes, and parentheses', () => {
    assert.equal(utils.isValidPhoneNumber('+256 712-345 678'), true);
    assert.equal(utils.isValidPhoneNumber('(0712) 345-678'), true);
  });

  it('rejects invalid numbers without throwing', () => {
    for (const v of ['', '   ', '0812345678', '71234567', '7123456789', 'not-a-number', '+25671234567a']) {
      assert.equal(utils.isValidPhoneNumber(v), false, `expected ${JSON.stringify(v)} to be invalid`);
    }
  });
});

describe('marzpay.utils.formatPhoneNumber (Req 11.1, 11.4)', () => {
  it('normalizes every accepted shape to the canonical +2567XXXXXXXX form', () => {
    for (const v of ['+256712345678', '256712345678', '0712345678', '712345678', '+256 712-345 678']) {
      assert.equal(utils.formatPhoneNumber(v), '+256712345678');
    }
  });

  it('round-trip consistency: formatted output is accepted by isValidPhoneNumber (Req 11.4)', () => {
    const formatted = utils.formatPhoneNumber('0712345678');
    assert.equal(utils.isValidPhoneNumber(formatted), true);
    // Idempotent: formatting an already-canonical value is a fixed point.
    assert.equal(utils.formatPhoneNumber(formatted), formatted);
  });

  it('throws (rather than returning an invalid string) for rejected values', () => {
    for (const v of ['', '0812345678', 'not-a-number']) {
      assert.throws(() => utils.formatPhoneNumber(v), /not a valid phone number/);
    }
  });
});
