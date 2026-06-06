// src/tests/oauth2.test.ts
// Integration tests for the OAuth2 / OIDC implementation in src/auth/oauth2.ts.
// Covers the four scenarios required by roadmap task 16.8:
//   1. PKCE code_challenge matches the verifier (S256 = base64url(sha256(verifier)))
//   2. state round-trip — a state produced by authorizationUrl is accepted by handleCallback
//   3. invalid state is rejected (CSRF / 400-equivalent rejection)
//   4. JwksCache serves stale keys on provider failure (real local node:http server)
//
// Uses only node:test + node:assert/strict and a real node:http server — no mocks
// of the unit under test, no external libraries.
//
// Run after `tsc`:
//   node --test dist/tests/oauth2.test.js

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { OAuthManager, JwksCache } from '../auth/oauth2.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

/** A minimal in-memory session manager satisfying the OAuthManager contract. */
function makeSessionManager() {
  const store = new Map<string, unknown>();
  return {
    get: (_ctx: unknown, key: string) => store.get(key) ?? null,
    set: (_ctx: unknown, key: string, value: unknown) => { store.set(key, value); },
  } as unknown as NonNullable<ConstructorParameters<typeof OAuthManager>[0]['sessionManager']>;
}

const GOOGLE_PROVIDER = {
  name: 'google',
  clientId: 'client-abc',
  clientSecret: 'secret-xyz',
  redirectUri: 'https://app.example.com/auth/callback',
  scopes: ['openid', 'profile', 'email'],
};

// A provider with no built-in endpoint config. handleCallback validates `state`
// BEFORE looking up the provider config, so a matching state proceeds past the
// CSRF check and then deterministically fails with "No built-in config" — proving
// the state was accepted without making any network call.
const NOCONFIG_PROVIDER = {
  name: 'custom-test',
  clientId: 'client-abc',
  clientSecret: 'secret-xyz',
  redirectUri: 'https://app.example.com/auth/callback',
};

// ── Scenario 1: PKCE code_challenge matches verifier ──────────────────────────

describe('OAuth2 PKCE — code_challenge matches verifier', () => {
  it('authorizationUrl emits code_challenge = base64url(sha256(codeVerifier)) with S256', async () => {
    const mgr = new OAuthManager({ providers: [GOOGLE_PROVIDER], sessionManager: makeSessionManager() });

    const { url, codeVerifier } = await mgr.authorizationUrl('google');
    const params = new URL(url).searchParams;

    const codeChallenge = params.get('code_challenge');
    const method = params.get('code_challenge_method');

    assert.ok(codeChallenge, 'authorization URL must include code_challenge');
    assert.equal(method, 'S256', 'PKCE method must be S256');

    const expected = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    assert.equal(codeChallenge, expected, 'code_challenge must equal base64url(sha256(verifier))');

    // base64url is URL-safe and SHA-256 output is 43 chars unpadded.
    assert.ok(!/[+/=]/.test(codeChallenge!), 'code_challenge must be base64url (no +, /, =)');
    assert.equal(codeChallenge!.length, 43, 'SHA-256 base64url challenge is 43 chars');
  });
});

// ── Scenario 2: state round-trip ──────────────────────────────────────────────

describe('OAuth2 state — round-trip acceptance', () => {
  it('state produced by authorizationUrl is accepted by handleCallback when echoed back', async () => {
    const mgr = new OAuthManager({
      providers: [GOOGLE_PROVIDER, NOCONFIG_PROVIDER],
      sessionManager: makeSessionManager(),
    });

    const { url, state } = await mgr.authorizationUrl('google');

    // The generated state is what the browser carries to the provider.
    assert.ok(new URL(url).searchParams.get('state'), 'authorization URL must include state');
    assert.equal(new URL(url).searchParams.get('state'), state);

    // Echo the SAME state back as both the returned state and the stored session
    // state. Validation passes (no CSRF rejection); the flow then stops at the
    // missing endpoint config, proving the round-tripped state was accepted.
    await assert.rejects(
      () => mgr.handleCallback('custom-test', 'auth-code', state, state, 'verifier'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(!/state mismatch/i.test(err.message), 'matching state must NOT be rejected as a mismatch');
        assert.match(err.message, /no built-in config/i, 'flow proceeded past the accepted state check');
        return true;
      },
    );
  });
});

// ── Scenario 3: invalid state rejected (CSRF / 400) ───────────────────────────

describe('OAuth2 state — invalid state rejected', () => {
  it('handleCallback rejects when echoed state does not match session state', async () => {
    const mgr = new OAuthManager({
      providers: [GOOGLE_PROVIDER, NOCONFIG_PROVIDER],
      sessionManager: makeSessionManager(),
    });

    const { state } = await mgr.authorizationUrl('google');
    const tampered = `${state}tampered`;

    await assert.rejects(
      () => mgr.handleCallback('custom-test', 'auth-code', tampered, state, 'verifier'),
      /state mismatch/i,
    );
  });

  it('rejects same-length mismatched state (constant-time compare fails closed)', async () => {
    const mgr = new OAuthManager({
      providers: [NOCONFIG_PROVIDER],
      sessionManager: makeSessionManager(),
    });

    const sessionState = crypto.randomBytes(32).toString('hex');
    const echoed = crypto.randomBytes(32).toString('hex'); // same length, different value

    await assert.rejects(
      () => mgr.handleCallback('custom-test', 'auth-code', echoed, sessionState, 'verifier'),
      /state mismatch/i,
    );
  });
});

// ── Scenario 4: JWKS cache serves stale on provider failure ───────────────────

describe('JwksCache — serves stale keys on provider failure', () => {
  let server: http.Server;
  let jwksUrl: string;
  // Controls how the local JWKS endpoint behaves for the next request.
  let mode: 'ok' | 'fail' = 'ok';
  let requestCount = 0;

  // A valid RSA public JWK to serve, tagged with a kid we can assert on.
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const baseJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
  const servedKey = { ...baseJwk, kid: 'street-test-key-1', use: 'sig', alg: 'RS256' };

  before(async () => {
    server = http.createServer((_req, res) => {
      requestCount += 1;
      if (mode === 'fail') {
        // Respond with a non-JSON body so the JWKS fetch rejects (the helper
        // parses the body as JSON), simulating an unreachable/broken provider.
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error — provider down');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [servedKey] }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as AddressInfo;
    jwksUrl = `http://127.0.0.1:${addr.port}/jwks`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('primes the cache from the provider on first use', async () => {
    mode = 'ok';
    const cache = new JwksCache();
    const keys = await cache.getKeys(jwksUrl);
    assert.equal(keys.length, 1);
    assert.equal(keys[0]!.kid, 'street-test-key-1');
  });

  it('returns previously cached keys when the provider later fails (served stale)', async () => {
    // Zero TTL forces every subsequent call to re-fetch, exercising the
    // stale-fallback (catch) branch rather than a fresh in-window cache hit.
    const cache = new JwksCache(0);

    mode = 'ok';
    const primed = await cache.getKeys(jwksUrl);
    assert.equal(primed.length, 1);
    assert.equal(primed[0]!.kid, 'street-test-key-1');

    const beforeFailure = requestCount;

    // Provider now fails on the refresh attempt.
    mode = 'fail';
    const stale = await cache.getKeys(jwksUrl);

    // It actually attempted a refresh (proving it didn't just hit a fresh cache)...
    assert.ok(requestCount > beforeFailure, 'a refresh request must have been attempted');
    // ...and on failure it fell back to the previously cached keys instead of throwing.
    assert.deepEqual(stale, primed, 'stale cached keys must be served on provider failure');
    assert.equal(stale[0]!.kid, 'street-test-key-1');
  });

  it('throws when the provider fails and nothing was ever cached', async () => {
    mode = 'fail';
    const cache = new JwksCache(0);
    await assert.rejects(
      () => cache.getKeys(`${jwksUrl}?cold=1`),
      /failed to fetch jwks/i,
    );
  });
});
