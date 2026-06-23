// packages/plugin-marzpay/test/coverage-edge.test.mjs
// Focused example-based tests pinning the defensive/edge branches of the
// MarzPay plugin source that the property and happy-path unit tests do not
// reach: configuration-validation rejections, the list-transactions query
// branches, the webhook negative branches under a BOUND scheme, the defensive
// response-parsing fallbacks across the client operations, and the plugin
// "not loaded" guard.
//
// Pure/offline — every networked case injects a MOCK MarzPayTransport, so no
// socket is ever opened. These complement (do not duplicate) the existing
// suites and exist to exercise the verify-don't-invent guard rails end to end.
//
// Validates: Requirements 2.3, 2.4, 2.7, 3.2, 3.3, 3.4, 3.6, 3.7, 3.8

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { PluginError } from 'streetjs';

import {
  validateMarzPayConfig,
  buildListTransactionsRequest,
  verifyWebhookSignature,
  MarzPayClient,
  MarzPayPlugin,
  MARZPAY_SPEC,
} from '../dist/index.js';

const CONFIG = { apiKey: 'ak', secretKey: 'sk', environment: 'sandbox' };

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

// ── Configuration validation: non-credential rejection branches ─────────────
describe('validateMarzPayConfig: defensive rejection branches', () => {
  it('rejects a non-object / null config', () => {
    assert.throws(() => validateMarzPayConfig(null), (e) => e instanceof PluginError);
    assert.throws(() => validateMarzPayConfig('nope'), (e) => e instanceof PluginError);
    assert.throws(() => validateMarzPayConfig(42), (e) => e instanceof PluginError);
  });

  it('rejects an invalid stateKey naming the field', () => {
    assert.throws(
      () => validateMarzPayConfig({ ...CONFIG, stateKey: '   ' }),
      (e) => e instanceof PluginError && e.message.includes('"stateKey"'),
    );
    assert.throws(
      () => validateMarzPayConfig({ ...CONFIG, stateKey: 123 }),
      (e) => e instanceof PluginError && e.message.includes('"stateKey"'),
    );
  });

  it('rejects an invalid timeoutMs naming the field', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 'soon']) {
      assert.throws(
        () => validateMarzPayConfig({ ...CONFIG, timeoutMs: bad }),
        (e) => e instanceof PluginError && e.message.includes('"timeoutMs"'),
        `timeoutMs=${String(bad)} must be rejected`,
      );
    }
  });

  it('accepts an explicit valid stateKey/timeoutMs (positive path)', () => {
    const cfg = validateMarzPayConfig({ ...CONFIG, stateKey: 'pay', timeoutMs: 5000 });
    assert.equal(cfg.stateKey, 'pay');
    assert.equal(cfg.timeoutMs, 5000);
  });
});

// ── buildListTransactionsRequest: query presence + filter branches ──────────
describe('buildListTransactionsRequest: query branches', () => {
  it('builds a bare URL when query is undefined (empty query string)', () => {
    const req = buildListTransactionsRequest(CONFIG, MARZPAY_SPEC, undefined);
    assert.equal(req.method, 'GET');
    assert.ok(!req.url.includes('?'), 'no query string when no filters');
  });

  it('builds a bare URL when query is null', () => {
    const req = buildListTransactionsRequest(CONFIG, MARZPAY_SPEC, null);
    assert.ok(!req.url.includes('?'), 'null query behaves like no query');
  });

  it('ignores empty/non-finite filters but appends present ones', () => {
    const req = buildListTransactionsRequest(CONFIG, MARZPAY_SPEC, {
      page: Number.NaN, // non-finite → ignored
      per_page: 50, // finite → appended
      type: 'collection',
      status: '   ', // whitespace → ignored
      provider: 'MTN',
      start_date: '',
      end_date: '2024-12-31',
      reference: '  ref-9  ', // trimmed
    });
    const qs = req.url.split('?')[1] ?? '';
    assert.ok(qs.includes('per_page=50'));
    assert.ok(qs.includes('type=collection'));
    assert.ok(qs.includes('provider=MTN'));
    assert.ok(qs.includes('end_date=2024-12-31'));
    assert.ok(qs.includes('reference=ref-9'));
    assert.ok(!qs.includes('page='), 'non-finite page is dropped');
    assert.ok(!qs.includes('status='), 'whitespace status is dropped');
    assert.ok(!qs.includes('start_date='), 'empty start_date is dropped');
  });
});

// ── verifyWebhookSignature: negative branches under a BOUND scheme ──────────
describe('verifyWebhookSignature: negative branches (bound scheme)', () => {
  const scheme = { signatureHeader: 'x-marzpay-signature', algorithm: 'sha256', encoding: 'hex' };
  const secret = 'whsec';
  const body = '{"event":"x"}';
  const good = createHmac(scheme.algorithm, secret).update(body, 'utf8').digest(scheme.encoding);

  it('round-trip positive (anchor)', () => {
    assert.equal(verifyWebhookSignature(scheme, secret, body, good), true);
  });

  it('returns false for absent/empty/non-string signature material', () => {
    assert.equal(verifyWebhookSignature(scheme, secret, body, undefined), false);
    assert.equal(verifyWebhookSignature(scheme, secret, body, ''), false);
    assert.equal(verifyWebhookSignature(scheme, secret, body, '   '), false);
    assert.equal(verifyWebhookSignature(scheme, secret, body, 123), false);
  });

  it('returns false for a missing/empty signing secret', () => {
    assert.equal(verifyWebhookSignature(scheme, '', body, good), false);
    assert.equal(verifyWebhookSignature(scheme, undefined, body, good), false);
  });

  it('returns false for a non-string raw body', () => {
    assert.equal(verifyWebhookSignature(scheme, secret, undefined, good), false);
    assert.equal(verifyWebhookSignature(scheme, secret, { a: 1 }, good), false);
  });

  it('returns false for a malformed scheme (unsupported algorithm/encoding)', () => {
    const badAlgo = { ...scheme, algorithm: 'not-a-real-hash' };
    assert.equal(verifyWebhookSignature(badAlgo, secret, body, good), false);
  });

  it('returns false for an unequal-length (malformed) signature', () => {
    assert.equal(verifyWebhookSignature(scheme, secret, body, good + 'extra'), false);
    assert.equal(verifyWebhookSignature(scheme, secret, body, 'abcd'), false);
  });

  it('returns false for a correct-length but wrong signature', () => {
    const wrong = createHmac(scheme.algorithm, 'other-secret').update(body, 'utf8').digest(scheme.encoding);
    assert.equal(verifyWebhookSignature(scheme, secret, body, wrong), false);
  });
});

// ── Client response parsing: defensive fallback branches ────────────────────
describe('MarzPayClient: defensive response-parsing fallbacks', () => {
  it('initializePayment falls back to root status and omits redirectUrl when absent', async () => {
    // transaction.status absent → falls back to root.status; no redirect_url.
    const body = JSON.stringify({ status: 'queued', data: { transaction: { reference: 'r1' } } });
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, resolving({ status: 200, body }));
    const res = await client.initializePayment({
      amount: 1, country: 'UG', reference: 'r1', phone_number: '+256700000000',
    });
    assert.equal(res.reference, 'r1');
    assert.equal(res.status, 'queued');
    assert.equal(res.redirectUrl, undefined);
  });

  it('initializePayment yields empty fields for a body with no transaction data', async () => {
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, resolving({ status: 200, body: '{}' }));
    const res = await client.initializePayment({
      amount: 1, country: 'UG', reference: 'r1', phone_number: '+256700000000',
    });
    assert.deepEqual(res, { reference: '', status: '' });
  });

  it('verifyPayment yields empty fields when transaction is absent', async () => {
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, resolving({ status: 200, body: '{}' }));
    assert.deepEqual(await client.verifyPayment('r1'), { reference: '', status: '' });
  });

  it('getTransaction parses a flat numeric amount and the uuid id field', async () => {
    const body = JSON.stringify({
      transaction: { uuid: 'u-1', reference: 'r2', amount: 7500, currency: 'UGX', status: 'completed' },
    });
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, resolving({ status: 200, body }));
    const txn = await client.getTransaction('r2');
    assert.equal(txn.id, 'u-1');
    assert.equal(txn.amount, 7500);
    assert.equal(txn.currency, 'UGX');
  });

  it('getTransaction parses the nested amount{raw,currency} shape and id fallback', async () => {
    const body = JSON.stringify({
      transaction: { id: 'i-1', reference: 'r3', amount: { raw: 9000, currency: 'KES' }, status: 'pending' },
    });
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, resolving({ status: 200, body }));
    const txn = await client.getTransaction('r3');
    assert.equal(txn.id, 'i-1');
    assert.equal(txn.amount, 9000);
    assert.equal(txn.currency, 'KES');
  });

  it('getTransaction yields zeroed defaults for an absent/empty transaction', async () => {
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, resolving({ status: 200, body: '{}' }));
    const txn = await client.getTransaction('r4');
    assert.deepEqual(txn, { id: '', reference: '', amount: 0, currency: '', status: '' });
  });

  it('listTransactions tolerates a non-array transactions field and surfaces a cursor', async () => {
    const withCursor = JSON.stringify({
      data: { transactions: [{ uuid: 'u', reference: 'r', status: 's' }], pagination: { next_page_url: 'p2' } },
    });
    let client = new MarzPayClient(CONFIG, MARZPAY_SPEC, resolving({ status: 200, body: withCursor }));
    let list = await client.listTransactions();
    assert.equal(list.items.length, 1);
    assert.equal(list.cursor, 'p2');

    const nonArray = JSON.stringify({ data: { transactions: { not: 'an array' } } });
    client = new MarzPayClient(CONFIG, MARZPAY_SPEC, resolving({ status: 200, body: nonArray }));
    list = await client.listTransactions();
    assert.deepEqual(list.items, []);
    assert.equal(list.cursor, undefined);
  });

  it('raises a JSON error on a malformed (non-JSON) success body', async () => {
    const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, resolving({ status: 200, body: 'not json' }));
    await assert.rejects(
      () => client.verifyPayment('r1'),
      (e) => e instanceof Error && /not valid JSON/.test(e.message),
    );
  });
});

// ── Plugin lifecycle: "not loaded" guard ────────────────────────────────────
describe('MarzPayPluginModule: payments guard before load', () => {
  it('throws when the client is accessed before the plugin loads', () => {
    const mod = MarzPayPlugin(CONFIG);
    assert.throws(() => mod.payments, (e) => e instanceof PluginError && /not loaded/.test(e.message));
  });
});
