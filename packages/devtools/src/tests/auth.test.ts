// tests/auth.test.ts
// Unit tests for the devtools token-gated, read-only authorization gate (Req 7.7).
// These assert the ENFORCEMENT behaviour (fail-closed), not just that a model is
// declared: a missing/wrong token is rejected, and even a valid token cannot
// issue a mutating method against the inspected app.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DevtoolsAuthGate,
  SAFE_METHODS,
  hashToken,
  isSafeMethod,
  parseBearer,
} from '../auth.js';

const TOKEN = 'super-secret-devtools-token';

describe('DevtoolsAuthGate — authentication (Req 7.7)', () => {
  it('allows a read-only request with the correct token', () => {
    const gate = DevtoolsAuthGate.fromToken(TOKEN);
    const d = gate.authorize({ token: TOKEN, method: 'GET' });
    assert.equal(d.allowed, true);
    assert.equal(d.code, 'ALLOWED');
    assert.equal(d.status, 200);
  });

  it('rejects a missing token as UNAUTHENTICATED (401)', () => {
    const gate = DevtoolsAuthGate.fromToken(TOKEN);
    const d = gate.authorize({ token: undefined, method: 'GET' });
    assert.equal(d.allowed, false);
    assert.equal(d.code, 'UNAUTHENTICATED');
    assert.equal(d.status, 401);
  });

  it('rejects an empty token as UNAUTHENTICATED', () => {
    const gate = DevtoolsAuthGate.fromToken(TOKEN);
    assert.equal(gate.authorize({ token: '', method: 'GET' }).code, 'UNAUTHENTICATED');
  });

  it('rejects a wrong token as UNAUTHENTICATED', () => {
    const gate = DevtoolsAuthGate.fromToken(TOKEN);
    assert.equal(gate.authorize({ token: 'wrong', method: 'GET' }).code, 'UNAUTHENTICATED');
  });

  it('authentication is the first gate: wrong token + mutating method is UNAUTHENTICATED', () => {
    const gate = DevtoolsAuthGate.fromToken(TOKEN);
    // A bad credential is rejected before the read-only policy is even consulted.
    assert.equal(gate.authorize({ token: 'wrong', method: 'POST' }).code, 'UNAUTHENTICATED');
  });

  it('can be constructed from a precomputed token hash', () => {
    const gate = DevtoolsAuthGate.fromTokenHash(hashToken(TOKEN));
    assert.equal(gate.authenticate(TOKEN), true);
    assert.equal(gate.authenticate('nope'), false);
  });

  it('refuses to construct from an empty token', () => {
    assert.throws(() => DevtoolsAuthGate.fromToken('  '));
  });

  it('refuses to construct from a non-hex hash', () => {
    assert.throws(() => DevtoolsAuthGate.fromTokenHash('not-a-hash'));
  });
});

describe('DevtoolsAuthGate — read-only authorization (Req 7.7)', () => {
  const gate = DevtoolsAuthGate.fromToken(TOKEN);

  for (const m of SAFE_METHODS) {
    it(`allows safe method ${m} with a valid token`, () => {
      assert.equal(gate.authorize({ token: TOKEN, method: m }).allowed, true);
    });
  }

  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT', 'TRACE', 'WEIRD']) {
    it(`rejects mutating/unknown method ${m} as READ_ONLY (403) even with a valid token`, () => {
      const d = gate.authorize({ token: TOKEN, method: m });
      assert.equal(d.allowed, false);
      assert.equal(d.code, 'READ_ONLY');
      assert.equal(d.status, 403);
    });
  }

  it('is case-insensitive about method names', () => {
    assert.equal(gate.authorize({ token: TOKEN, method: 'get' }).allowed, true);
    assert.equal(gate.authorize({ token: TOKEN, method: 'post' }).code, 'READ_ONLY');
  });

  it('authorizeHeader extracts the bearer token and applies the same policy', () => {
    assert.equal(gate.authorizeHeader(`Bearer ${TOKEN}`, 'GET').allowed, true);
    assert.equal(gate.authorizeHeader(`Bearer ${TOKEN}`, 'DELETE').code, 'READ_ONLY');
    assert.equal(gate.authorizeHeader('Bearer wrong', 'GET').code, 'UNAUTHENTICATED');
    assert.equal(gate.authorizeHeader(undefined, 'GET').code, 'UNAUTHENTICATED');
  });
});

describe('helpers', () => {
  it('isSafeMethod recognises only GET/HEAD/OPTIONS', () => {
    assert.ok(isSafeMethod('GET') && isSafeMethod('head') && isSafeMethod(' options '));
    assert.ok(!isSafeMethod('POST') && !isSafeMethod('delete'));
  });

  it('parseBearer extracts the token or returns undefined', () => {
    assert.equal(parseBearer('Bearer abc'), 'abc');
    assert.equal(parseBearer('bearer  xyz '), 'xyz');
    assert.equal(parseBearer('Basic abc'), undefined);
    assert.equal(parseBearer(undefined), undefined);
    assert.equal(parseBearer(''), undefined);
  });
});
