// packages/plugin-marzpay/test/coverage-bound-seams.test.mjs
// Targeted branch-coverage tests (Task 14.2) for the verify-don't-invent code
// that is AUTHORED-BUT-DORMANT in the production `MARZPAY_SPEC`: the send/parse
// paths behind the currently-unbound `refund`, `disburse`, `balance`, and
// `phoneVerification.*` seams, plus the defensive `??` response-parsing
// fallbacks in the collections namespace.
//
// These paths are unreachable while the real seams stay unbound (the namespaces
// throw `UnsupportedOperationError`/`PluginError` before any send — covered by
// `unverified-seams.test.mjs`). The plugin source comments them as "retained for
// the day MarzPay publishes a verified endpoint and the seam becomes bound".
// This suite exercises exactly that code by constructing the EXPORTED namespace
// factories / client over a SYNTHETIC, locally-bound spec clone and a MOCK
// transport — so nothing touches the network and the production `MARZPAY_SPEC`
// is never mutated (verify-don't-invent is preserved; no endpoint is invented in
// shipped code).
//
// Pure/offline — every case injects a mock transport.
//
// Validates: Requirements 13.2, 13.3, 14.1

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MARZPAY_SPEC,
  MarzPayClient,
  buildRefundRequest,
  createCollectionsNamespace,
  createDisbursementsNamespace,
  createAccountsNamespace,
  createPhoneVerificationNamespace,
} from '../dist/index.js';
import { PluginError } from 'streetjs';

const CONFIG = { apiKey: 'ak-test', secretKey: 'sk-test', environment: 'sandbox' };

/**
 * A SYNTHETIC spec clone with the otherwise-unbound seams bound to placeholder
 * paths. Used ONLY in this test to reach the dormant send/parse branches. The
 * shared production `MARZPAY_SPEC` is left untouched.
 */
const BOUND_SPEC = {
  ...MARZPAY_SPEC,
  paths: {
    ...MARZPAY_SPEC.paths,
    refund: '/refunds',
    disburse: '/send-money',
    balance: '/balance',
    phoneVerification: {
      verify: '/phone/verify',
      isVerified: (id) => `/phone/${encodeURIComponent(id)}/verified`,
      getUserInfo: (id) => `/phone/${encodeURIComponent(id)}/info`,
    },
  },
};

/** A transport that records calls and resolves a fixed { status, body }. */
function resolving(response) {
  const t = (req, _timeoutMs) => {
    t.captured = req;
    t.calls += 1;
    return Promise.resolve(response);
  };
  t.calls = 0;
  t.captured = undefined;
  return t;
}

/** Build namespace deps over the synthetic bound spec + a given transport. */
function boundDeps(transport) {
  return { config: CONFIG, spec: BOUND_SPEC, transport, timeoutMs: 1000 };
}

// ── Collections namespace: defensive `??` fallback branches ─────────────────
describe('collections namespace: response-parsing fallbacks (verified seam)', () => {
  it('collectMoney falls back to root.status when transaction.status is absent', async () => {
    const body = JSON.stringify({ status: 'queued', data: { transaction: { reference: 'r-fb' } } });
    const ns = createCollectionsNamespace(boundDeps(resolving({ status: 200, body })));
    const res = await ns.collectMoney({
      amount: 10, country: 'UG', reference: 'r-fb', phone_number: '+256700000000',
    });
    assert.deepEqual(res, { reference: 'r-fb', status: 'queued' });
  });

  it('collectMoney yields empty reference/status for an empty body', async () => {
    const ns = createCollectionsNamespace(boundDeps(resolving({ status: 200, body: '{}' })));
    const res = await ns.collectMoney({
      amount: 10, country: 'UG', reference: 'r-empty', phone_number: '+256700000000',
    });
    assert.deepEqual(res, { reference: '', status: '' });
  });

  it('getStatus yields empty reference/status when transaction is absent', async () => {
    const ns = createCollectionsNamespace(boundDeps(resolving({ status: 200, body: '{}' })));
    assert.deepEqual(await ns.getStatus('r-x'), { reference: '', status: '' });
  });
});

// ── Disbursements namespace: dormant send/parse behind a bound disburse seam ─
describe('disbursements.sendMoney: send/parse branches (synthetic bound seam)', () => {
  it('sends optional fields and parses transaction status', async () => {
    const body = JSON.stringify({ data: { transaction: { reference: 'd-1', status: 'sent' } } });
    const transport = resolving({ status: 200, body });
    const ns = createDisbursementsNamespace(boundDeps(transport));
    const res = await ns.sendMoney({
      amount: 5000,
      country: 'UG',
      reference: 'd-1',
      phone_number: '+256700000000',
      currency: 'UGX',
      description: 'payout',
      callback_url: 'https://cb.example/hook',
    });
    assert.equal(transport.calls, 1);
    assert.equal(transport.captured.url, 'https://wallet.wearemarz.com/api/v1/send-money');
    const sent = JSON.parse(transport.captured.body);
    assert.equal(sent.currency, 'UGX');
    assert.equal(sent.description, 'payout');
    assert.equal(sent.callback_url, 'https://cb.example/hook');
    assert.deepEqual(res, { reference: 'd-1', status: 'sent' });
  });

  it('omits absent optional fields and falls back to root.status, then empty', async () => {
    const rootStatusBody = JSON.stringify({ status: 'accepted', data: { transaction: { reference: 'd-2' } } });
    let transport = resolving({ status: 200, body: rootStatusBody });
    let ns = createDisbursementsNamespace(boundDeps(transport));
    let res = await ns.sendMoney({ amount: 1, country: 'UG', reference: 'd-2', phone_number: '+256700000000' });
    const sent = JSON.parse(transport.captured.body);
    assert.equal(sent.currency, undefined);
    assert.equal(sent.description, undefined);
    assert.equal(sent.callback_url, undefined);
    assert.deepEqual(res, { reference: 'd-2', status: 'accepted' });

    ns = createDisbursementsNamespace(boundDeps(resolving({ status: 200, body: '{}' })));
    res = await ns.sendMoney({ amount: 1, country: 'UG', reference: 'd-3', phone_number: '+256700000000' });
    assert.deepEqual(res, { reference: '', status: '' });
  });

  it('maps a non-2xx response to an error including the HTTP status', async () => {
    const ns = createDisbursementsNamespace(boundDeps(resolving({ status: 503, body: '{}' })));
    await assert.rejects(
      () => ns.sendMoney({ amount: 1, country: 'UG', reference: 'd-4', phone_number: '+256700000000' }),
      (e) => e instanceof Error && /503/.test(e.message),
    );
  });
});

// ── Accounts namespace: dormant parse behind a bound balance seam ───────────
describe('accounts.getBalance: defensive parse branches (synthetic bound seam)', () => {
  it('parses nested balance{available,currency,raw}', async () => {
    const body = JSON.stringify({ data: { balance: { available: 12000, currency: 'UGX', raw: 12000 } } });
    const ns = createAccountsNamespace(boundDeps(resolving({ status: 200, body })));
    const res = await ns.getBalance();
    assert.deepEqual(res, { currency: 'UGX', available: 12000, raw: 12000 });
  });

  it('falls back to data-level available/currency and omits raw when absent', async () => {
    const body = JSON.stringify({ data: { available: 999, currency: 'KES' } });
    const ns = createAccountsNamespace(boundDeps(resolving({ status: 200, body })));
    const res = await ns.getBalance();
    assert.deepEqual(res, { currency: 'KES', available: 999 });
  });

  it('defaults to zero/empty for an empty body', async () => {
    const ns = createAccountsNamespace(boundDeps(resolving({ status: 200, body: '{}' })));
    assert.deepEqual(await ns.getBalance(), { currency: '', available: 0 });
  });

  it('maps a non-2xx response to an error including the HTTP status', async () => {
    const ns = createAccountsNamespace(boundDeps(resolving({ status: 500, body: '{}' })));
    await assert.rejects(() => ns.getBalance(), (e) => e instanceof Error && /500/.test(e.message));
  });
});

// ── Phone verification namespace: dormant send/parse behind bound seams ─────
describe('phoneVerification: send/parse branches (synthetic bound seam)', () => {
  it('verify parses {phone_number, verified} and falls back to the input number', async () => {
    let body = JSON.stringify({ data: { phone_number: '+256700000001', verified: true } });
    let ns = createPhoneVerificationNamespace(boundDeps(resolving({ status: 200, body })));
    let res = await ns.verify({ phone_number: '+256700000000' });
    assert.deepEqual(res, { phone_number: '+256700000001', verified: true });

    ns = createPhoneVerificationNamespace(boundDeps(resolving({ status: 200, body: '{}' })));
    res = await ns.verify({ phone_number: '+256700000000' });
    assert.deepEqual(res, { phone_number: '+256700000000', verified: false });
  });

  it('isVerified returns the boolean verification state', async () => {
    let ns = createPhoneVerificationNamespace(
      boundDeps(resolving({ status: 200, body: JSON.stringify({ data: { verified: true } }) })),
    );
    assert.equal(await ns.isVerified({ phone_number: '+256700000000' }), true);

    ns = createPhoneVerificationNamespace(boundDeps(resolving({ status: 200, body: '{}' })));
    assert.equal(await ns.isVerified({ phone_number: '+256700000000' }), false);
  });

  it('getUserInfo narrows scalar fields and skips non-scalar ones', async () => {
    const body = JSON.stringify({
      data: {
        phone_number: '+256700000002',
        name: 'Ada',
        verified: true,
        score: 7,
        meta: { nested: 'object-skipped' },
        tags: ['array-skipped'],
      },
    });
    const ns = createPhoneVerificationNamespace(boundDeps(resolving({ status: 200, body })));
    const res = await ns.getUserInfo({ phone_number: '+256700000000' });
    assert.equal(res.phone_number, '+256700000002');
    assert.equal(res.name, 'Ada');
    assert.equal(res.verified, true);
    assert.equal(res.score, 7);
    assert.equal(res.meta, undefined, 'nested object is skipped');
    assert.equal(res.tags, undefined, 'array is skipped');
  });

  it('getUserInfo falls back to the input phone number when absent', async () => {
    const ns = createPhoneVerificationNamespace(boundDeps(resolving({ status: 200, body: '{}' })));
    const res = await ns.getUserInfo({ phone_number: '+256700000000' });
    assert.equal(res.phone_number, '+256700000000');
  });

  it('maps a non-2xx response to an error including the HTTP status', async () => {
    const ns = createPhoneVerificationNamespace(boundDeps(resolving({ status: 404, body: '{}' })));
    await assert.rejects(
      () => ns.verify({ phone_number: '+256700000000' }),
      (e) => e instanceof Error && /404/.test(e.message),
    );
  });
});

// ── Refund builder + client send/parse behind a bound refund seam ───────────
describe('buildRefundRequest: argument-guard branches (synthetic bound seam)', () => {
  it('rejects a non-object / null request', () => {
    assert.throws(() => buildRefundRequest(CONFIG, BOUND_SPEC, null), (e) => e instanceof PluginError);
    assert.throws(() => buildRefundRequest(CONFIG, BOUND_SPEC, 'nope'), (e) => e instanceof PluginError);
  });

  it('rejects a missing/empty transactionId naming the field', () => {
    assert.throws(
      () => buildRefundRequest(CONFIG, BOUND_SPEC, { transactionId: '' }),
      (e) => e instanceof PluginError && /transactionId/.test(e.message),
    );
  });

  it('includes a finite amount in the payload and omits a non-finite one', () => {
    const withAmount = buildRefundRequest(CONFIG, BOUND_SPEC, { transactionId: 'tx-1', amount: 2500 });
    assert.equal(JSON.parse(withAmount.body).amount, 2500);
    assert.equal(withAmount.url, 'https://wallet.wearemarz.com/api/v1/refunds');

    const noAmount = buildRefundRequest(CONFIG, BOUND_SPEC, { transactionId: 'tx-2' });
    assert.equal(JSON.parse(noAmount.body).amount, undefined);

    const nanAmount = buildRefundRequest(CONFIG, BOUND_SPEC, { transactionId: 'tx-3', amount: Number.NaN });
    assert.equal(JSON.parse(nanAmount.body).amount, undefined, 'a non-finite amount is dropped');
  });
});

describe('MarzPayClient.refund: send/parse branches (synthetic bound seam)', () => {
  it('parses {id,status} from a successful refund response', async () => {
    const body = JSON.stringify({ id: 'rf-1', status: 'refunded' });
    const client = new MarzPayClient(CONFIG, BOUND_SPEC, resolving({ status: 200, body }));
    assert.deepEqual(await client.refund({ transactionId: 'tx-1' }), { id: 'rf-1', status: 'refunded' });
  });

  it('yields empty id/status for an empty body', async () => {
    const client = new MarzPayClient(CONFIG, BOUND_SPEC, resolving({ status: 200, body: '{}' }));
    assert.deepEqual(await client.refund({ transactionId: 'tx-2' }), { id: '', status: '' });
  });

  it('maps a non-2xx response to an error including the HTTP status', async () => {
    const client = new MarzPayClient(CONFIG, BOUND_SPEC, resolving({ status: 422, body: '{}' }));
    await assert.rejects(
      () => client.refund({ transactionId: 'tx-3' }),
      (e) => e instanceof Error && /422/.test(e.message),
    );
  });
});
