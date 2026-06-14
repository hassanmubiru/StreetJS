// Tests for the Next.js server helpers. Pure/offline (no Next runtime needed).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, createServerClient } from '../dist/index.js';

describe('parseCookies', () => {
  it('parses a Cookie header into a map and decodes values', () => {
    const c = parseCookies('a=1; street_token=abc%20def; b=2');
    assert.equal(c.a, '1');
    assert.equal(c.street_token, 'abc def');
    assert.equal(c.b, '2');
  });
  it('handles empty/undefined input', () => {
    assert.deepEqual(parseCookies(undefined), {});
    assert.deepEqual(parseCookies(''), {});
  });
});

describe('createServerClient', () => {
  it('attaches the token from a cookie header to requests', async () => {
    const calls = [];
    const fetch = (url, init) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({ ok: true }), text: () => Promise.resolve('') });
    };
    const api = createServerClient({ baseUrl: '/api', fetch, cookieHeader: 'street_token=tok-xyz' });
    await api.auth.session();
    assert.equal(calls[0].init.headers.authorization, 'Bearer tok-xyz');
  });

  it('prefers an explicit token over the cookie', async () => {
    const calls = [];
    const fetch = (url, init) => { calls.push({ init }); return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve({}), text: () => Promise.resolve('') }); };
    const api = createServerClient({ baseUrl: '/api', fetch, token: 'explicit', cookieHeader: 'street_token=cookie' });
    await api.auth.session();
    assert.equal(calls[0].init.headers.authorization, 'Bearer explicit');
  });
});
