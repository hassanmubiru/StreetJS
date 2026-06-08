// tests/preservation-class-a-dispatch.test.ts
// Class A preservation baseline (Property 7 — Non-Buggy Inputs Unchanged).
//
// Captures the CURRENT (pre-fix) behavior of the webhook request-options builder
// for targets that do NOT satisfy isBugCondition_A, i.e.:
//   - no `tls` at all
//   - `tls.ca` only (private-CA path, the supported mechanism)
//   - `tls.rejectUnauthorized === true`
//   - `tls.rejectUnauthorized === undefined`
//
// For all of these the options object must NEVER carry `rejectUnauthorized: false`
// (certificate validation stays enabled), the custom CA must be passed through
// when supplied, and the standard request shape (method, headers, signature,
// timeout, host/port/path) must be exactly as observed today. The Class A fix
// (removing the `rejectUnauthorized: false` spread) must leave every one of these
// non-buggy inputs untouched: F(X) === F'(X).
//
// **Validates: Requirements 3.1, 3.7**

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestOptions, type WebhookTarget } from '../webhook/dispatcher.js';

type Tls = WebhookTarget['tls'];

const URL = 'https://hooks.example.com/path?x=1';
const CONTENT_LENGTH = 128;
const SIGNATURE = 'sha256=abc123';
const TIMEOUT = 7_500;

/** isBugCondition_A: tls present AND rejectUnauthorized === false. */
function isBugCondition_A(tls: Tls): boolean {
  return tls != null && tls.rejectUnauthorized === false;
}

// All of these are NON-buggy (preservation domain): isBugCondition_A is false.
const NON_BUGGY_TLS: ReadonlyArray<readonly [string, Tls]> = [
  ['no tls', undefined],
  ['rejectUnauthorized: true', { rejectUnauthorized: true }],
  ['rejectUnauthorized: undefined', { rejectUnauthorized: undefined }],
  ['tls.ca only', { ca: 'PEM-CA' }],
  ['tls.ca + rejectUnauthorized: true', { ca: 'PEM-CA', rejectUnauthorized: true }],
];

describe('Class A preservation — normal dispatch options unchanged', () => {
  for (const [label, tls] of NON_BUGGY_TLS) {
    it(`never disables validation and keeps the standard shape for ${label}`, () => {
      // Precondition: this input is in the preservation domain.
      assert.equal(isBugCondition_A(tls), false, 'precondition: must NOT satisfy isBugCondition_A');

      const options = buildRequestOptions(URL, CONTENT_LENGTH, SIGNATURE, TIMEOUT, tls);

      // (1) Certificate validation is never disabled for non-buggy targets.
      assert.notEqual(
        (options as { rejectUnauthorized?: boolean }).rejectUnauthorized,
        false,
        'options must never carry rejectUnauthorized:false for a non-buggy target',
      );

      // (2) Standard request shape — the observed baseline.
      assert.equal(options.hostname, 'hooks.example.com');
      assert.equal(options.port, 443);
      assert.equal(options.path, '/path?x=1');
      assert.equal(options.method, 'POST');
      assert.equal(options.timeout, TIMEOUT);
      const headers = options.headers as Record<string, unknown>;
      assert.equal(headers['Content-Type'], 'application/json');
      assert.equal(headers['Content-Length'], CONTENT_LENGTH);
      assert.equal(headers['X-Street-Signature'], SIGNATURE);
      assert.equal(headers['User-Agent'], 'Street-Webhook/1.0');

      // (3) Custom CA is passed through iff supplied; otherwise absent.
      if (tls?.ca) {
        assert.equal(options.ca, tls.ca, 'custom tls.ca must be forwarded unchanged');
      } else {
        assert.equal('ca' in options, false, 'no ca key when tls.ca is not supplied');
      }
    });
  }

  it('forwards the port from the URL when explicitly specified', () => {
    const options = buildRequestOptions(
      'https://hooks.example.com:8443/p',
      CONTENT_LENGTH,
      SIGNATURE,
      TIMEOUT,
      undefined,
    );
    assert.equal(options.port, '8443');
    assert.notEqual((options as { rejectUnauthorized?: boolean }).rejectUnauthorized, false);
  });
});
