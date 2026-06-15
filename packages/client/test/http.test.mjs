// HTTP layer + client tests with an injected fake fetch. Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStreetClient, buildUrl, StreetApiError } from '../dist/index.js';

// A fake fetch that records calls and returns a scripted JSON response.
function fakeFetch(script) {
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url, init });
    const r = typeof script === 'function' ? script(url, init) : script;
    const status = r.status ?? 200;
    const bodyText = r.json !== undefined ? JSON.stringify(r.json) : (r.text ?? '');
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? (r.contentType ?? 'application/json') : null) },
      json: () => Promise.resolve(r.json),
      text: () => Promise.resolve(bodyText),
    });
  };
  fn.calls = calls;
  return fn;
}

describe('buildUrl', () => {
  it('joins base + path and appends query, skipping null/undefined', () => {
    assert.equal(buildUrl('/api/', '/users', { a: 1, b: undefined, c: 'x' }), '/api/users?a=1&c=x');
    assert.equal(buildUrl('https://h.co', 'ping'), 'https://h.co/ping');
  });
  it('trims multiple trailing slashes (regex-free)', () => {
    assert.equal(buildUrl('https://h.co///', '/users'), 'https://h.co/users');
    assert.equal(buildUrl('/api///', 'x'), '/api/x');
  });
  it('handles a 100k-slash base in linear time without throwing (ReDoS guard)', () => {
    const evil = 'https://h.co' + '/'.repeat(100_000);
    const start = process.hrtime.bigint();
    const out = buildUrl(evil, '/users');
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.equal(out, 'https://h.co/users');
    assert.ok(ms < 50, `expected <50ms, took ${ms.toFixed(2)}ms`);
  });
});

describe('resource CRUD', () => {
  it('list hits GET /<name> and returns the array', async () => {
    const fetch = fakeFetch({ json: [{ id: 1 }, { id: 2 }] });
    const api = createStreetClient({ baseUrl: '/api', fetch });
    const users = await api.users.list();
    assert.deepEqual(users, [{ id: 1 }, { id: 2 }]);
    assert.equal(fetch.calls[0].url, '/api/users');
    assert.equal(fetch.calls[0].init.method, 'GET');
  });

  it('get/create/update/remove hit the right method + path', async () => {
    const fetch = fakeFetch({ json: { id: 7 } });
    const api = createStreetClient({ baseUrl: '/api', fetch });
    await api.resource('posts').get(7);
    await api.resource('posts').create({ title: 'x' });
    await api.resource('posts').update(7, { title: 'y' });
    await api.resource('posts').remove(7);
    const m = fetch.calls.map((c) => `${c.init.method} ${c.url}`);
    assert.deepEqual(m, ['GET /api/posts/7', 'POST /api/posts', 'PUT /api/posts/7', 'DELETE /api/posts/7']);
    assert.equal(JSON.parse(fetch.calls[1].init.body).title, 'x');
  });
});

describe('auth + headers', () => {
  it('attaches a bearer token from getToken', async () => {
    const fetch = fakeFetch({ json: { ok: true } });
    const api = createStreetClient({ baseUrl: '/api', fetch, getToken: () => 'tok123' });
    await api.auth.session();
    assert.equal(fetch.calls[0].url, '/api/auth/session');
    assert.equal(fetch.calls[0].init.headers.authorization, 'Bearer tok123');
  });

  it('login POSTs credentials as JSON', async () => {
    const fetch = fakeFetch({ json: { token: 'z' } });
    const api = createStreetClient({ baseUrl: '/api', fetch });
    const r = await api.auth.login({ email: 'a@b.co', password: 'pw' });
    assert.equal(r.token, 'z');
    assert.equal(fetch.calls[0].init.headers['content-type'], 'application/json');
    assert.equal(JSON.parse(fetch.calls[0].init.body).email, 'a@b.co');
  });
});

describe('search', () => {
  it('GETs /search with the q param', async () => {
    const fetch = fakeFetch({ json: { hits: [] } });
    const api = createStreetClient({ baseUrl: '/api', fetch });
    await api.search('hello', { limit: 5 });
    assert.match(fetch.calls[0].url, /\/api\/search\?q=hello&limit=5$/);
  });
});

describe('errors', () => {
  it('throws StreetApiError with status + parsed body on non-2xx', async () => {
    const fetch = fakeFetch({ status: 404, json: { message: 'not found' } });
    const api = createStreetClient({ baseUrl: '/api', fetch });
    await assert.rejects(() => api.users.get(99), (err) => {
      assert.ok(err instanceof StreetApiError);
      assert.equal(err.status, 404);
      assert.equal(err.message, 'not found');
      return true;
    });
  });
});
