// packages/plugin-marzpay/test/unverified-seams.test.mjs
// Unit tests (example-based) for the verify-don't-invent UNVERIFIED-seam behavior
// of the namespaced MarzPayClient surface (Task 3.4).
//
// Every operation backed by an UNBOUND MarzPaySpec seam must:
//   • throw `UnsupportedOperationError` whose message NAMES the capability, and
//   • issue NO network request — an injected transport spy must record ZERO sends.
//
// Crucially, this must hold EVEN AFTER argument validation passes: the field
// guards run first (named-field errors, no send), and once they pass the seam
// guard fires (still no send). So we always call with VALID arguments to prove
// the no-send guarantee is the seam's, not the argument validator's.
//
// Operations covered (all backed by unbound seams — Research_Artifact has no
// Verified_Capability for them):
//   • disbursements.sendMoney        → guarded via requireBoundSeam(paths.disburse)
//   • accounts.getBalance            → guarded via requireBoundSeam(paths.balance)
//   • phoneVerification.verify       → guarded via requireBoundSeam(paths.phoneVerification.verify)
//   • phoneVerification.isVerified   → seam object undefined → throws directly
//   • phoneVerification.getUserInfo  → seam object undefined → throws directly
//   • refund (optional)              → §L5 unbound; throws a named PluginError, no send
//
// Pure/offline — the transport spy is injected so nothing ever touches the
// network. Run: npm test -w packages/plugin-marzpay
//
// Validates: Requirements 3.6, 5.3, 10.5

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MarzPayClient, MARZPAY_SPEC, UnsupportedOperationError } from '../dist/index.js';

/** Validated config; the transport spy is injected so nothing ever networks. */
const CONFIG = { apiKey: 'ak-test', secretKey: 'sk-test', environment: 'sandbox' };

/**
 * A transport spy that counts every send. If any unverified operation reaches
 * the network, `spy.calls` becomes non-zero and the test fails. It resolves a
 * benign 200 so a leaked send would NOT itself reject (isolating the assertion
 * to "did we send at all?").
 */
function makeSpy() {
  const spy = (_req, _timeoutMs) => {
    spy.calls += 1;
    return Promise.resolve({ status: 200, body: '{}' });
  };
  spy.calls = 0;
  return spy;
}

/** VALID arguments per operation, so argument validation passes BEFORE the seam guard. */
const VALID_SEND_MONEY = {
  amount: 5000,
  country: 'UG',
  reference: 'ref-disb-1',
  phone_number: '+256700000000',
};
const VALID_PHONE = { phone_number: '+256700000000' };

// ── disbursements.sendMoney (Req 3.6) ───────────────────────────────────────
describe('disbursements.sendMoney (unverified seam)', () => {
  it('throws UnsupportedOperationError naming the capability and sends nothing (valid args)', async () => {
    const spy = makeSpy();
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, spy);

    await assert.rejects(
      () => client.disbursements.sendMoney(VALID_SEND_MONEY),
      (err) =>
        err instanceof UnsupportedOperationError &&
        /disbursements\.sendMoney/.test(err.message),
      'sendMoney must surface a named UnsupportedOperationError after validation passes',
    );
    assert.equal(spy.calls, 0, 'no network request may be issued for an unbound disburse seam');
  });
});

// ── accounts.getBalance (Req 5.3) ───────────────────────────────────────────
describe('accounts.getBalance (unverified seam)', () => {
  it('throws UnsupportedOperationError naming the capability and sends nothing', async () => {
    const spy = makeSpy();
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, spy);

    await assert.rejects(
      () => client.accounts.getBalance(),
      (err) =>
        err instanceof UnsupportedOperationError && /accounts\.getBalance/.test(err.message),
      'getBalance must surface a named UnsupportedOperationError',
    );
    assert.equal(spy.calls, 0, 'no network request may be issued for an unbound balance seam');
  });
});

// ── phoneVerification.* (Req 10.5) ──────────────────────────────────────────
describe('phoneVerification.verify (unverified seam, guarded via requireBoundSeam)', () => {
  it('throws UnsupportedOperationError naming the capability and sends nothing (valid args)', async () => {
    const spy = makeSpy();
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, spy);

    await assert.rejects(
      () => client.phoneVerification.verify(VALID_PHONE),
      (err) =>
        err instanceof UnsupportedOperationError &&
        /phoneVerification\.verify/.test(err.message),
      'verify must surface a named UnsupportedOperationError after validation passes',
    );
    assert.equal(spy.calls, 0, 'no network request may be issued for an unbound verify seam');
  });
});

describe('phoneVerification.isVerified (unverified seam, undefined seam object)', () => {
  it('throws UnsupportedOperationError naming the capability and sends nothing (valid args)', async () => {
    const spy = makeSpy();
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, spy);

    await assert.rejects(
      () => client.phoneVerification.isVerified(VALID_PHONE),
      (err) =>
        err instanceof UnsupportedOperationError &&
        /phoneVerification\.isVerified/.test(err.message),
      'isVerified must surface a named UnsupportedOperationError after validation passes',
    );
    assert.equal(spy.calls, 0, 'no network request may be issued while the phoneVerification seam is undefined');
  });
});

describe('phoneVerification.getUserInfo (unverified seam, undefined seam object)', () => {
  it('throws UnsupportedOperationError naming the capability and sends nothing (valid args)', async () => {
    const spy = makeSpy();
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, spy);

    await assert.rejects(
      () => client.phoneVerification.getUserInfo(VALID_PHONE),
      (err) =>
        err instanceof UnsupportedOperationError &&
        /phoneVerification\.getUserInfo/.test(err.message),
      'getUserInfo must surface a named UnsupportedOperationError after validation passes',
    );
    assert.equal(spy.calls, 0, 'no network request may be issued while the phoneVerification seam is undefined');
  });
});

// ── refund (optional — §L5 Recorded_Limitation) ─────────────────────────────
// `refund` is unbound per Research_Artifact §L5. It throws a named PluginError
// (not the UnsupportedOperationError subclass) before any send. We assert the
// capability is named ("refund") and that the transport records zero sends.
describe('refund (unbound §L5 — named error, no send)', () => {
  it('rejects naming the "refund" capability and sends nothing (valid args)', async () => {
    const spy = makeSpy();
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, spy);

    await assert.rejects(
      () => client.refund({ transactionId: 'tx-refund-1' }),
      (err) => err instanceof Error && /refund/.test(err.message),
      'refund must reject naming the refund capability while the seam is unbound',
    );
    assert.equal(spy.calls, 0, 'no network request may be issued for an unbound refund seam');
  });
});
