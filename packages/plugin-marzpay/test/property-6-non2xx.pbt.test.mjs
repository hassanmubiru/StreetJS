// packages/plugin-marzpay/test/property-6-non2xx.pbt.test.mjs
// Feature: marzpay-scope-alignment, Property 6: Non-2xx responses fail with the status and no partial result
// Validates: Requirements 2.6, 3.7, 4.4
//
// For ANY reachable operation (`collections.collectMoney`, `collections.getStatus`,
// `disbursements.getStatus`, `transactions.get`) and ANY non-2xx HTTP status
// returned by the transport, the operation throws an error whose message INCLUDES
// the returned HTTP status and returns no value (no partial result).
//
// Every case injects a MOCK MarzPayTransport into the client constructor
// (`new MarzPayClient(config, MARZPAY_SPEC, transport)`), so the verified path
// (build → send → ensureSuccessStatus → defensive parse) is exercised
// deterministically without sockets. Arguments are generated valid so the pure
// builder guards pass and execution reaches the injected transport.
//
// Run: npm test -w packages/plugin-marzpay

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { MarzPayClient, MARZPAY_SPEC } from '../dist/index.js';

const RUNS = 200; // ≥100 iterations per property.

/** Base config; the transport is injected so nothing ever networks. */
const CONFIG = { apiKey: 'ak', secretKey: 'sk', environment: 'sandbox', timeoutMs: 30_000 };

/** A valid reference/id that survives the pure builder guards (non-empty, ≤256). */
const VALID_ID = 'ref-123';
/** A valid collectMoney request so the builder doesn't throw before sending. */
const VALID_PAYMENT = { amount: 1000, country: 'UG', reference: 'ref-123', phone_number: '+256700000000' };

/**
 * The four REACHABLE operations named by Property 6, each invoked with valid args
 * so the pure builders pass and execution reaches the injected transport.
 */
const OPERATIONS = [
  { name: 'collections.collectMoney', invoke: (client) => client.collections.collectMoney(VALID_PAYMENT) },
  { name: 'collections.getStatus', invoke: (client) => client.collections.getStatus(VALID_ID) },
  { name: 'disbursements.getStatus', invoke: (client) => client.disbursements.getStatus(VALID_ID) },
  { name: 'transactions.get', invoke: (client) => client.transactions.get(VALID_ID) },
];

const opName = fc.constantFrom(...OPERATIONS.map((o) => o.name));
const opByName = (name) => OPERATIONS.find((o) => o.name === name);

/** A transport that records whether it was called and resolves a fixed response. */
function resolvingTransport(response) {
  const transport = (_req, _timeoutMs) => {
    transport.calls += 1;
    return Promise.resolve(response);
  };
  transport.calls = 0;
  return transport;
}

// ── 2xx success sanity (anchors the negative property) ───────────────────────
// Confirms the transport seam is wired for each reachable op: a 2xx + valid body
// resolves. This proves the negative property below rejects for the right reason
// (the non-2xx status), not because the op was unreachable past its guards.
describe('Property 6 sanity: each reachable op resolves on a 2xx response', () => {
  const VERIFIED_BODY = JSON.stringify({
    status: 'success',
    transaction: {
      uuid: 'txn-uuid-1',
      reference: 'ref-123',
      amount: { raw: 1000, currency: 'UGX' },
      status: 'completed',
    },
    data: { transaction: { reference: 'ref-123', status: 'completed' } },
  });

  for (const op of OPERATIONS) {
    it(`${op.name} resolves on status 200 + a verified body`, async () => {
      const transport = resolvingTransport({ status: 200, body: VERIFIED_BODY });
      const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, transport);
      const result = await op.invoke(client);
      assert.notEqual(result, undefined, `${op.name} should resolve a parsed result on 2xx`);
      assert.equal(transport.calls, 1, `${op.name} should have sent exactly one request`);
    });
  }
});

// ── Property 6 ───────────────────────────────────────────────────────────────
// Feature: marzpay-scope-alignment, Property 6: Non-2xx responses fail with the status and no partial result
// Validates: Requirements 2.6, 3.7, 4.4
describe('Property 6: Non-2xx responses fail with the status and no partial result', () => {
  // Status codes outside the 2xx success band: 100–199 and 300–599.
  const nonSuccessStatus = fc.oneof(
    fc.integer({ min: 100, max: 199 }),
    fc.integer({ min: 300, max: 599 }),
  );
  // Bodies that WOULD parse into a result if the status check were skipped —
  // ensures the rejection is due to the status, not a parse failure.
  const validishBody = fc.constantFrom(
    JSON.stringify({ status: 'success', data: { transaction: { reference: 'ref-123', status: 'completed' } } }),
    JSON.stringify({ transaction: { reference: 'ref-123', status: 'processing' } }),
    JSON.stringify({ transaction: { uuid: 'u', reference: 'ref-123', amount: { raw: 1000, currency: 'UGX' }, status: 'completed' } }),
    '{}',
  );

  it('every reachable op rejects with an error including the status and returns no value', async () => {
    await fc.assert(
      fc.asyncProperty(opName, nonSuccessStatus, validishBody, async (name, status, body) => {
        const transport = resolvingTransport({ status, body });
        const client = new MarzPayClient(CONFIG, MARZPAY_SPEC, transport);

        let returned;
        let threw = false;
        let message = '';
        try {
          returned = await opByName(name).invoke(client);
        } catch (err) {
          threw = true;
          message = err instanceof Error ? err.message : String(err);
        }

        // Must reject — no value is returned.
        assert.equal(threw, true, `${name} must reject on non-2xx status ${status}`);
        assert.equal(returned, undefined, `${name} must return no partial result on status ${status}`);
        // The error message must include the returned HTTP status.
        assert.ok(
          message.includes(String(status)),
          `${name} error message must include status ${status}; got: ${message}`,
        );
        // The transport was reached (proving the op passed its guards and the
        // failure is the non-2xx status, not an early argument-guard rejection).
        assert.equal(transport.calls, 1, `${name} should have sent exactly one request`);
      }),
      { numRuns: RUNS },
    );
  });
});
