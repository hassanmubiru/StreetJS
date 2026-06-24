// Feature: marzpay-scope-alignment, Property 1: Argument guards never touch the network
// Validates: Requirements 2.3, 2.5, 3.3, 3.5, 4.3, 10.4, 14.3
//
// For ANY reachable namespace operation that takes arguments
//   • collections.collectMoney(req)      (amount/country/reference/channel guards)
//   • collections.getStatus(reference)   (trimmed reference guard)
//   • disbursements.getStatus(reference) (trimmed reference guard — verified seam)
//   • transactions.get(reference)        (trimmed reference guard)
//   • disbursements.sendMoney(req)       (field guards run BEFORE the unbound seam)
//   • phoneVerification.verify/isVerified/getUserInfo(req)  (phone_number guard)
// and for ANY invalid argument — a missing/empty/whitespace-only required field,
// or a reference that is empty/whitespace-only/longer than 256 chars after
// trimming — the operation rejects with a PluginError whose message NAMES the
// offending field/argument AND the injected transport records ZERO sends.
//
// The transport spy is injected into `new MarzPayClient(config, MARZPAY_SPEC, spy)`
// and counts every send; the property asserts `spy.calls === 0` for every case,
// proving the argument guards short-circuit before any network I/O.
//
// Pure/offline — nothing ever touches the network. Run: npm test -w packages/plugin-marzpay

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { PluginError } from 'streetjs';
import { MarzPayClient, MARZPAY_SPEC } from '../dist/index.js';

const RUNS = 200; // ≥100 iterations.

/** Validated config; the transport spy is injected so nothing ever networks. */
const CONFIG = { apiKey: 'ak-test', secretKey: 'sk-test', environment: 'sandbox' };

/**
 * A transport spy that counts every send. If any guarded operation reaches the
 * network on invalid input, `spy.calls` becomes non-zero and the test fails. It
 * resolves a benign 200 so a leaked send would NOT itself reject — isolating the
 * assertion to "did we send at all?".
 */
function makeSpy() {
  const spy = (_req, _timeoutMs) => {
    spy.calls += 1;
    return Promise.resolve({ status: 200, body: '{}' });
  };
  spy.calls = 0;
  return spy;
}

// ---------------------------------------------------------------------------
// Invalid-input generators
// ---------------------------------------------------------------------------

/** Invalid reference/identifier: empty, whitespace-only, >256 after trim, or non-string. */
const invalidReference = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.stringMatching(/^[ \t\n\r]{1,12}$/),
  fc.constantFrom(undefined, null, 42, {}, true),
  // Trimmed length strictly greater than 256 (non-whitespace core).
  fc.integer({ min: 257, max: 600 }).map((n) => 'a'.repeat(n)),
);

/** Invalid amount: zero, negative, NaN, infinities, or a non-number. */
const invalidAmount = fc.oneof(
  fc.constant(0),
  fc.constant(-0),
  fc.double({ min: -1e12, max: -Number.MIN_VALUE, noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
  fc.constantFrom('10', undefined, null, {}),
);

/** Invalid value for a required non-empty-string field. */
const emptyOrAbsent = fc.constantFrom('', '   ', '\t', '\n  ', undefined, null, 42, {});

/** A fully-valid collection request used as the base to corrupt one field at a time. */
const VALID_COLLECT = { amount: 1000, country: 'UG', reference: 'ref-collect-1', phone_number: '+256700000000' };
/** A fully-valid send-money request used as the base to corrupt one field at a time. */
const VALID_SEND = { amount: 5000, country: 'UG', reference: 'ref-disb-1', phone_number: '+256700000000' };

// ---------------------------------------------------------------------------
// Case generators — each yields { label, invoke(client), pattern } where
// `pattern` must match the thrown error message (naming the offending field).
// ---------------------------------------------------------------------------

// Reference-taking operations: empty/whitespace/>256/non-string ⇒ named "reference".
const referenceOps = [
  { name: 'collections.getStatus', call: (c, ref) => c.collections.getStatus(ref) },
  { name: 'disbursements.getStatus', call: (c, ref) => c.disbursements.getStatus(ref) },
  { name: 'transactions.get', call: (c, ref) => c.transactions.get(ref) },
];

const referenceCase = fc
  .tuple(fc.constantFrom(...referenceOps), invalidReference)
  .map(([op, ref]) => ({
    label: op.name,
    invoke: (c) => op.call(c, ref),
    pattern: /reference/,
  }));

// collections.collectMoney — corrupt exactly one required field so its guard fires.
const collectMoneyCase = fc.oneof(
  invalidAmount.map((bad) => ({
    label: 'collections.collectMoney#amount',
    invoke: (c) => c.collections.collectMoney({ ...VALID_COLLECT, amount: bad }),
    pattern: /"amount"/,
  })),
  emptyOrAbsent.map((bad) => ({
    label: 'collections.collectMoney#country',
    invoke: (c) => c.collections.collectMoney({ ...VALID_COLLECT, country: bad }),
    pattern: /"country"/,
  })),
  emptyOrAbsent.map((bad) => ({
    label: 'collections.collectMoney#reference',
    invoke: (c) => c.collections.collectMoney({ ...VALID_COLLECT, reference: bad }),
    pattern: /"reference"/,
  })),
  // Missing payment channel: no method:'card' and no usable phone_number.
  emptyOrAbsent.map((badPhone) => {
    const req = { amount: 1000, country: 'UG', reference: 'ref-collect-1' };
    if (badPhone !== undefined) req.phone_number = badPhone;
    return {
      label: 'collections.collectMoney#channel',
      invoke: (c) => c.collections.collectMoney(req),
      pattern: /payment channel|phone_number|method/,
    };
  }),
);

// disbursements.sendMoney — corrupt one required field; the field guard runs
// BEFORE the unbound-seam guard, so the thrown PluginError names the field.
const sendMoneyCase = fc.oneof(
  invalidAmount.map((bad) => ({
    label: 'disbursements.sendMoney#amount',
    invoke: (c) => c.disbursements.sendMoney({ ...VALID_SEND, amount: bad }),
    pattern: /"amount"/,
  })),
  emptyOrAbsent.map((bad) => ({
    label: 'disbursements.sendMoney#country',
    invoke: (c) => c.disbursements.sendMoney({ ...VALID_SEND, country: bad }),
    pattern: /"country"/,
  })),
  emptyOrAbsent.map((bad) => ({
    label: 'disbursements.sendMoney#reference',
    invoke: (c) => c.disbursements.sendMoney({ ...VALID_SEND, reference: bad }),
    pattern: /"reference"/,
  })),
  emptyOrAbsent.map((bad) => ({
    label: 'disbursements.sendMoney#phone_number',
    invoke: (c) => c.disbursements.sendMoney({ ...VALID_SEND, phone_number: bad }),
    pattern: /"phone_number"/,
  })),
);

// phoneVerification.* — invalid request ⇒ named "phone_number" before the seam guard.
const phoneVerificationOps = ['verify', 'isVerified', 'getUserInfo'];
const invalidPhoneReq = fc.oneof(
  fc.constant({ phone_number: '' }),
  fc.constant({ phone_number: '   ' }),
  fc.constant({ phone_number: '\t\n' }),
  fc.constant({ phone_number: 42 }),
  fc.constant({}),
  fc.constantFrom(null, undefined, 'x', 5),
);

const phoneVerificationCase = fc
  .tuple(fc.constantFrom(...phoneVerificationOps), invalidPhoneReq)
  .map(([op, req]) => ({
    label: `phoneVerification.${op}`,
    invoke: (c) => c.phoneVerification[op](req),
    pattern: /phone_number/,
  }));

/** Any invalid invocation across every reachable arg-taking operation. */
const invalidCase = fc.oneof(referenceCase, collectMoneyCase, sendMoneyCase, phoneVerificationCase);

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

describe('Property 1: Argument guards never touch the network', () => {
  it('rejects every invalid argument with a named PluginError and issues ZERO sends', async () => {
    await fc.assert(
      fc.asyncProperty(invalidCase, async (testCase) => {
        const spy = makeSpy();
        const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, spy);

        let threw = false;
        let error;
        try {
          await testCase.invoke(client);
        } catch (err) {
          threw = true;
          error = err;
        }

        // Must reject (no value returned for an invalid argument).
        assert.equal(threw, true, `${testCase.label} must reject on invalid input`);
        // The rejection is a PluginError (the argument-guard error type).
        assert.ok(
          error instanceof PluginError,
          `${testCase.label} must throw a PluginError; got: ${error && error.constructor && error.constructor.name}`,
        );
        // The message names the offending field/argument.
        assert.match(
          error.message,
          testCase.pattern,
          `${testCase.label} error must name the offending field; got: ${error.message}`,
        );
        // No network request may be issued before the guard rejects.
        assert.equal(spy.calls, 0, `${testCase.label} must issue ZERO sends on invalid input`);
      }),
      { numRuns: RUNS },
    );
  });
});
