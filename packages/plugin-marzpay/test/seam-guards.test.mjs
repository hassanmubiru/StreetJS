// packages/plugin-marzpay/test/seam-guards.test.mjs
// Unit tests (example-based) for the verify-don't-invent seam primitives and the
// MARZPAY_SPEC seam snapshot (Task 1.3).
//
// These pin two facts at the type-erased runtime boundary:
//   • requireBoundSeam(undefined, capability) throws UnsupportedOperationError
//     (the verify-don't-invent guard), while a bound value passes through
//     unchanged with no network I/O.
//   • MARZPAY_SPEC leaves the refund / disburse / balance / phoneVerification
//     seams UNBOUND (undefined), and binds a SINGLE base address for both the
//     sandbox and production selections (Research_Artifact V8/V9/R2).
//
// Pure/offline — nothing here touches the network.
// Run: npm test -w packages/plugin-marzpay
//
// Validates: Requirements 1.2, 1.5, 3.1, 5.1

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MARZPAY_SPEC,
  UnsupportedOperationError,
  requireBoundSeam,
} from '../dist/index.js';

// ── requireBoundSeam guard (Req 1.2, 3.1, 5.1) ──────────────────────────────
describe('requireBoundSeam (verify-don\'t-invent guard)', () => {
  it('throws UnsupportedOperationError naming the capability for an undefined seam', () => {
    assert.throws(
      () => requireBoundSeam(undefined, 'disbursements.sendMoney'),
      (err) =>
        err instanceof UnsupportedOperationError &&
        err instanceof Error &&
        /disbursements\.sendMoney/.test(err.message) &&
        /Research_Artifact/.test(err.message),
      'an unbound seam must surface a named UnsupportedOperationError',
    );
  });

  it('sets the error name to UnsupportedOperationError', () => {
    let caught;
    try {
      requireBoundSeam(undefined, 'accounts.getBalance');
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof UnsupportedOperationError);
    assert.equal(caught.name, 'UnsupportedOperationError');
  });

  it('passes a bound value through unchanged', () => {
    assert.equal(requireBoundSeam('/collect-money', 'collections.collectMoney'), '/collect-money');
    // An empty string is still a bound (defined) value and must pass through.
    assert.equal(requireBoundSeam('', 'edge.case'), '');
  });
});

// ── MARZPAY_SPEC seam snapshot (Req 1.5, 3.1, 5.1) ──────────────────────────
describe('MARZPAY_SPEC unbound-seam snapshot', () => {
  it('leaves refund / disburse / balance / phoneVerification seams UNBOUND', () => {
    assert.equal(MARZPAY_SPEC.paths.refund, undefined, 'refund stays unbound (§L5)');
    assert.equal(MARZPAY_SPEC.paths.disburse, undefined, 'disburse stays unbound (unverified)');
    assert.equal(MARZPAY_SPEC.paths.balance, undefined, 'balance stays unbound (unverified)');
    assert.equal(
      MARZPAY_SPEC.paths.phoneVerification,
      undefined,
      'phoneVerification stays unbound (unverified)',
    );
  });

  it('binds the verified collections/transactions seams (sanity anchor)', () => {
    assert.equal(MARZPAY_SPEC.paths.initializePayment, '/collect-money');
    assert.equal(MARZPAY_SPEC.paths.listTransactions, '/transactions');
    assert.equal(typeof MARZPAY_SPEC.paths.verifyPayment, 'function');
    assert.equal(typeof MARZPAY_SPEC.paths.getTransaction, 'function');
  });

  it('leaves the webhook signature scheme UNBOUND (§L4)', () => {
    assert.equal(MARZPAY_SPEC.webhook, undefined, 'webhook scheme stays unbound (§L4)');
  });
});

describe('MARZPAY_SPEC base address (Req 1.5)', () => {
  it('binds a SINGLE base URL shared by both sandbox and production', () => {
    const { sandbox, production } = MARZPAY_SPEC.baseAddress;
    assert.equal(sandbox, 'https://wallet.wearemarz.com/api/v1');
    assert.equal(production, 'https://wallet.wearemarz.com/api/v1');
    assert.equal(sandbox, production, 'sandbox and production resolve to one base address');
  });
});
