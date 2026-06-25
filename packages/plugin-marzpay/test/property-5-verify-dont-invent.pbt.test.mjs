// Property-based test for the MarzPay plugin's verify-don't-invent discipline.
// Pure/offline — every case injects a transport spy into the client constructor
// (`new MarzPayClient(config, spec, transport)`), so no socket is ever opened.
// Run: npm test -w packages/plugin-marzpay
//
// ---------------------------------------------------------------------------
// Feature: marzpay-scope-alignment, Property 5: Verify-don't-invent —
// unverified capabilities issue no request
//
// For ANY call to an operation backed by an UNBOUND seam
// (`disbursements.sendMoney`, `accounts.getBalance`,
// `phoneVerification.verify/isVerified/getUserInfo`, and `refund`) and for ANY
// arguments (valid OR invalid), the operation throws an error that NAMES the
// capability AND the injected transport records ZERO sends.
//
//   • `disbursements.sendMoney`, `accounts.getBalance`, and every
//     `phoneVerification.*` operation surface an `UnsupportedOperationError`
//     once their required-field guards pass (the seam is unbound).
//   • `refund` is a Recorded_Limitation (§L5): it throws a plain `PluginError`
//     (NOT the `UnsupportedOperationError` subclass) naming the "refund"
//     capability before any send.
//   • In ALL cases — valid or invalid arguments — the transport records zero
//     sends (no network request is ever issued for an unbound seam).
//
// Validates: Requirements 1.3, 3.6, 5.3, 10.5, 12.7
// ---------------------------------------------------------------------------

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { MarzPayClient, MARZPAY_SPEC, UnsupportedOperationError } from '../dist/index.js';

const RUNS = 200; // ≥100 iterations.

/** Validated config; the transport spy is injected so nothing ever networks. */
const CONFIG = { apiKey: 'ak-test', secretKey: 'sk-test', environment: 'sandbox' };

/**
 * A transport spy that counts every send. If any unbound-seam operation reaches
 * the network, `spy.calls` becomes non-zero and the property fails. It resolves
 * a benign 200 so a leaked send would NOT itself reject — isolating the
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

// Mirror of the plugin's internal `isNonEmptyString` (module-local, not exported)
// so the test can classify whether generated arguments pass the field guards.
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

// ── argument arbitraries ────────────────────────────────────────────────────

/** A non-empty, non-whitespace-only string (survives the field guards). */
const nonEmptyStr = fc
  .string({ minLength: 1, maxLength: 32 })
  .map((s) => s.replace(/\s/g, 'x'))
  .map((s) => (s.length === 0 ? 'x' : s));

/** A positive, finite amount (passes the sendMoney amount guard). */
const positiveAmount = fc.double({ min: 0.01, max: 1e9, noNaN: true }).filter((n) => Number.isFinite(n) && n > 0);

/** Arbitrary "anything" payloads — covers invalid (and incidentally valid) shapes. */
const anyArg = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant({}),
  fc.anything(),
);

/** Valid + invalid disbursement send-money requests. */
const sendMoneyArg = fc.oneof(
  fc.record({
    amount: positiveAmount,
    country: nonEmptyStr,
    reference: nonEmptyStr,
    phone_number: nonEmptyStr,
  }),
  // Partially-formed (likely-invalid) records to exercise the field guards.
  fc.record(
    {
      amount: fc.oneof(positiveAmount, fc.constant(0), fc.constant(-1), fc.string()),
      country: fc.oneof(nonEmptyStr, fc.constant(''), fc.constant('   ')),
      reference: fc.oneof(nonEmptyStr, fc.constant('')),
      phone_number: fc.oneof(nonEmptyStr, fc.constant('')),
    },
    { requiredKeys: [] },
  ),
  anyArg,
);

/** Valid + invalid phone-verification requests. */
const phoneArg = fc.oneof(
  fc.record({ phone_number: nonEmptyStr }),
  fc.record({ phone_number: fc.oneof(fc.constant(''), fc.constant('   '), fc.integer()) }, { requiredKeys: [] }),
  anyArg,
);

/** Valid + invalid refund requests. */
const refundArg = fc.oneof(
  fc.record({ transactionId: nonEmptyStr, amount: fc.option(positiveAmount, { nil: undefined }) }),
  anyArg,
);

// ── validity classifiers (faithful to the plugin's field guards) ────────────

const isValidSendMoney = (req) =>
  typeof req === 'object' &&
  req !== null &&
  typeof req.amount === 'number' &&
  Number.isFinite(req.amount) &&
  req.amount > 0 &&
  isNonEmptyString(req.country) &&
  isNonEmptyString(req.reference) &&
  isNonEmptyString(req.phone_number);

const isValidPhone = (req) => typeof req === 'object' && req !== null && isNonEmptyString(req.phone_number);

// ── operation descriptors (each backed by an UNBOUND seam) ──────────────────

const OPERATIONS = {
  'disbursements.sendMoney': {
    argArb: sendMoneyArg,
    invoke: (client, args) => client.disbursements.sendMoney(args),
    // Once the field guard passes, the unbound `disburse` seam throws.
    expectsUnsupported: (args) => isValidSendMoney(args),
  },
  'accounts.getBalance': {
    argArb: fc.constant(undefined), // no arguments → always reaches the seam guard
    invoke: (client) => client.accounts.getBalance(),
    expectsUnsupported: () => true,
  },
  'phoneVerification.verify': {
    argArb: phoneArg,
    invoke: (client, args) => client.phoneVerification.verify(args),
    expectsUnsupported: (args) => isValidPhone(args),
  },
  'phoneVerification.isVerified': {
    argArb: phoneArg,
    invoke: (client, args) => client.phoneVerification.isVerified(args),
    expectsUnsupported: (args) => isValidPhone(args),
  },
  'phoneVerification.getUserInfo': {
    argArb: phoneArg,
    invoke: (client, args) => client.phoneVerification.getUserInfo(args),
    expectsUnsupported: (args) => isValidPhone(args),
  },
  // §L5 Recorded_Limitation: throws a plain PluginError (NOT the
  // UnsupportedOperationError subclass) naming "refund", for ANY args, no send.
  refund: {
    argArb: refundArg,
    invoke: (client, args) => client.refund(args),
    expectsUnsupported: () => false,
    isRefund: true,
  },
};

/** A case = an operation name paired with arguments drawn from its arbitrary. */
const caseArb = fc.oneof(
  ...Object.entries(OPERATIONS).map(([name, def]) => def.argArb.map((args) => ({ name, args }))),
);

describe('Feature: marzpay-scope-alignment, Property 5: Verify-don\'t-invent — unverified capabilities issue no request', () => {
  it('every unbound-seam operation throws naming the capability and issues zero sends, for any arguments', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ name, args }) => {
        const def = OPERATIONS[name];
        const spy = makeSpy();
        const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, spy);

        let threw = false;
        let err;
        try {
          await def.invoke(client, args);
        } catch (e) {
          threw = true;
          err = e;
        }

        // (1) The operation must reject — no partial result is produced.
        assert.equal(threw, true, `${name} must throw for an unbound seam`);

        // (2) Verify-don't-invent core invariant: ZERO network sends, for ANY args.
        assert.equal(spy.calls, 0, `${name} must issue no network request (got ${spy.calls})`);

        // (3) The surfaced error names the capability.
        assert.ok(err instanceof Error, `${name} must reject with an Error`);
        const expectedName = def.isRefund ? 'refund' : name;
        assert.ok(
          err.message.includes(expectedName),
          `${name} error must name the capability "${expectedName}"; got: ${err.message}`,
        );

        // (4) Error-type specificity.
        if (def.isRefund) {
          // §L5: refund surfaces a plain PluginError, not the Unsupported subclass.
          assert.ok(
            !(err instanceof UnsupportedOperationError),
            'refund must reject with a plain PluginError, not UnsupportedOperationError',
          );
        } else if (def.expectsUnsupported(args)) {
          // Field guards passed → the unbound seam guard fires.
          assert.ok(
            err instanceof UnsupportedOperationError,
            `${name} must surface an UnsupportedOperationError once field guards pass; got: ${err.message}`,
          );
        }
      }),
      { numRuns: RUNS },
    );
  });
});
