// Feature: marzpay-integration, Property 4
// Property 4: Required-field validation for payment/refund requests
// Validates: Requirements 3.1, 3.9
//
// For all payment-initialization requests, buildInitializePaymentRequest builds
// the verified request when every MarzPay-required field is present and
// non-empty (amount finite positive number, country non-empty, reference
// non-empty, and a channel: phone_number non-empty OR method 'card'); otherwise
// it raises a validation error identifying the missing/invalid field and sends
// no request. The builder is pure, so "sends no request" is asserted by the
// fact that it throws and returns no MarzPayHttpRequest.
//
// Refund note: buildRefundRequest is unsupported (refund seam unbound) — it
// always throws "refunds not supported" regardless of fields. A small
// assertion covers that unsupported-operation guard; the property iterations
// center on payment requests.
//
// Pure/offline — no network. Run: npm test -w packages/plugin-marzpay

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  buildInitializePaymentRequest,
  buildRefundRequest,
  MARZPAY_SPEC,
} from '../dist/index.js';

const NUM_RUNS = 200;

const cfg = {
  apiKey: 'test-api-key',
  secretKey: 'test-secret-key',
  environment: 'sandbox',
  stateKey: 'marzpay',
  timeoutMs: 30_000,
};

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A string that is guaranteed non-empty after trimming (appends a literal). */
const nonEmptyStr = fc.string().map((s) => `${s}x`);

/** A finite, strictly-positive amount. */
const positiveAmount = fc.double({
  min: Number.MIN_VALUE,
  max: 1e12,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Values that are NOT a usable channel string (empty/whitespace/absent/non-string). */
const emptyOrAbsent = fc.constantFrom('', '   ', '\t', '\n  ', undefined, null, 42, {});

/** A valid payment channel: either a non-empty phone_number OR method 'card'. */
const validChannel = fc.oneof(
  nonEmptyStr.map((phone) => ({ phone_number: phone })),
  fc.constant({ method: 'card' }),
  // card with an (ignored) empty phone — still valid because method is 'card'.
  fc.constant({ method: 'card', phone_number: '' }),
);

/** A fully-valid PaymentRequest (all required fields present + non-empty). */
const validRequest = fc
  .record({
    amount: positiveAmount,
    country: nonEmptyStr,
    reference: nonEmptyStr,
    channel: validChannel,
    currency: fc.option(nonEmptyStr, { nil: undefined }),
    description: fc.option(nonEmptyStr, { nil: undefined }),
    callback_url: fc.option(nonEmptyStr, { nil: undefined }),
  })
  .map(({ amount, country, reference, channel, currency, description, callback_url }) => {
    const req = { amount, country, reference, ...channel };
    if (currency !== undefined) req.currency = currency;
    if (description !== undefined) req.description = description;
    if (callback_url !== undefined) req.callback_url = callback_url;
    return req;
  });

/** Invalid amounts: zero, negative, NaN, infinities, and non-numbers. */
const invalidAmount = fc.oneof(
  fc.constant(0),
  fc.constant(-0),
  fc.double({ min: -1e12, max: -Number.MIN_VALUE, noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
  fc.constantFrom('10', undefined, null, {}),
);

// ---------------------------------------------------------------------------
// Property 4 — valid side: every required field present ⇒ builds the request
// ---------------------------------------------------------------------------

describe('Property 4: required-field validation for initializePayment (valid side)', () => {
  it('builds the verified request when every required field is present and non-empty', () => {
    fc.assert(
      fc.property(validRequest, (req) => {
        const built = buildInitializePaymentRequest(cfg, MARZPAY_SPEC, req);

        assert.equal(built.method, 'POST');
        assert.equal(
          built.url,
          `${MARZPAY_SPEC.baseAddress.sandbox}${MARZPAY_SPEC.paths.initializePayment}`,
        );
        assert.match(built.headers.Authorization, /^Basic /);
        assert.equal(built.headers['Content-Type'], 'application/json');

        const body = JSON.parse(built.body);
        // Required fields are carried verbatim.
        assert.equal(body.amount, req.amount);
        assert.equal(body.country, req.country);
        assert.equal(body.reference, req.reference);
        // Exactly one verified channel is present.
        if (req.method === 'card') {
          assert.equal(body.method, 'card');
          assert.equal(body.phone_number, undefined);
        } else {
          assert.equal(body.phone_number, req.phone_number);
          assert.equal(body.method, undefined);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4 — invalid side: each missing/invalid required field ⇒ throws,
// names the field, and returns no request.
// ---------------------------------------------------------------------------

describe('Property 4: required-field validation for initializePayment (invalid side)', () => {
  it('rejects an invalid/missing amount, naming "amount", and sends no request', () => {
    fc.assert(
      fc.property(validRequest, invalidAmount, (base, badAmount) => {
        const req = { ...base, amount: badAmount };
        assert.throws(
          () => buildInitializePaymentRequest(cfg, MARZPAY_SPEC, req),
          /"amount"/,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects an empty/absent country, naming "country", and sends no request', () => {
    fc.assert(
      fc.property(validRequest, emptyOrAbsent, (base, badCountry) => {
        const req = { ...base };
        if (badCountry === undefined) delete req.country;
        else req.country = badCountry;
        assert.throws(
          () => buildInitializePaymentRequest(cfg, MARZPAY_SPEC, req),
          /"country"/,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects an empty/absent reference, naming "reference", and sends no request', () => {
    fc.assert(
      fc.property(validRequest, emptyOrAbsent, (base, badReference) => {
        const req = { ...base };
        if (badReference === undefined) delete req.reference;
        else req.reference = badReference;
        assert.throws(
          () => buildInitializePaymentRequest(cfg, MARZPAY_SPEC, req),
          /"reference"/,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a missing channel (no card, no non-empty phone_number), naming the channel, and sends no request', () => {
    fc.assert(
      fc.property(
        fc.record({ amount: positiveAmount, country: nonEmptyStr, reference: nonEmptyStr }),
        emptyOrAbsent,
        (base, badPhone) => {
          // No method:'card' and no usable phone_number ⇒ no valid channel.
          const req = { ...base };
          if (badPhone !== undefined) req.phone_number = badPhone;
          assert.throws(
            () => buildInitializePaymentRequest(cfg, MARZPAY_SPEC, req),
            /payment channel|phone_number|method/,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects a non-object request', () => {
    fc.assert(
      fc.property(fc.constantFrom(null, undefined, 'x', 5, true), (bad) => {
        assert.throws(() => buildInitializePaymentRequest(cfg, MARZPAY_SPEC, bad));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Refund unsupported-operation guard (seam unbound) — small, focused check.
// ---------------------------------------------------------------------------

describe('Property 4: buildRefundRequest is unsupported regardless of fields', () => {
  it('always throws "refunds not supported" — even with a fully-valid-looking request', () => {
    fc.assert(
      fc.property(
        fc.record({
          transactionId: fc.oneof(nonEmptyStr, fc.constant(''), fc.constant(undefined)),
          amount: fc.option(positiveAmount, { nil: undefined }),
        }),
        (refundReq) => {
          assert.throws(
            () => buildRefundRequest(cfg, MARZPAY_SPEC, refundReq),
            /refunds are not supported|not supported by MarzPay/,
          );
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
