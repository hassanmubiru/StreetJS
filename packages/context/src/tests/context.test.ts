import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createContext, serializeCookie } from '../index.js';

// ── Fake req/res (no real socket) ──────────────────────────────────────────────

function makeReq(opts: { method?: string; headers?: Record<string, string | string[] | undefined> } = {}): IncomingMessage {
  return { method: opts.method, headers: opts.headers ?? {} } as unknown as IncomingMessage;
}

interface RecordedRes extends ServerResponse {
  _status?: number;
  _headers: Record<string, unknown>;
  _sentHeaders?: Record<string, string>;
  _body?: string;
  _ended: boolean;
}

function makeRes(): RecordedRes {
  const headers: Record<string, unknown> = {};
  const res = {
    _headers: headers,
    _ended: false,
    writeHead(status: number, sentHeaders?: Record<string, string>) {
      this._status = status;
      if (sentHeaders) this._sentHeaders = sentHeaders;
      return this;
    },
    end(body?: string) {
      this._body = body;
      this._ended = true;
    },
    setHeader(name: string, value: unknown) {
      headers[name] = value;
    },
    getHeader(name: string) {
      return headers[name];
    },
  } as unknown as RecordedRes;
  return res;
}

const ENV = process.env.NODE_ENV;
afterEach(() => {
  if (ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ENV;
});

// ── createContext basics ────────────────────────────────────────────────────────

test('createContext normalizes method, headers, and sets sane defaults', () => {
  const req = makeReq({ method: 'post', headers: { 'X-Foo': 'Bar', 'Multi': ['a', 'b'], skip: undefined } });
  const ctx = createContext(req, makeRes(), '/users', { q: '1' });
  assert.equal(ctx.method, 'POST');
  assert.equal(ctx.path, '/users');
  assert.deepEqual(ctx.query, { q: '1' });
  assert.equal(ctx.headers['x-foo'], 'Bar', 'header keys lowercased');
  assert.equal(ctx.headers['multi'], 'a, b', 'array header joined');
  assert.ok(!('skip' in ctx.headers), 'undefined header values dropped');
  assert.deepEqual(ctx.params, {});
  assert.equal(ctx.body, null);
  assert.deepEqual(ctx.files, []);
  assert.deepEqual(ctx.state, {});
  assert.equal(ctx.user, null);
  assert.equal(typeof ctx.startTime, 'bigint');
  assert.equal(ctx.sent, false);
});

test('method defaults to GET when the request has none', () => {
  const ctx = createContext(makeReq(), makeRes(), '/', {});
  assert.equal(ctx.method, 'GET');
});

// ── Responders ───────────────────────────────────────────────────────────────────

test('json writes the JSON body with content headers and marks sent', () => {
  const res = makeRes();
  const ctx = createContext(makeReq(), res, '/', {});
  ctx.json({ ok: true }, 201);
  assert.equal(res._status, 201);
  assert.equal(res._sentHeaders!['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(res._sentHeaders!['X-Content-Type-Options'], 'nosniff');
  assert.equal(res._body, '{"ok":true}');
  assert.equal(res._sentHeaders!['Content-Length'], String(Buffer.byteLength('{"ok":true}')));
  assert.equal(ctx.sent, true);
});

test('json defaults to status 200', () => {
  const res = makeRes();
  createContext(makeReq(), res, '/', {}).json({});
  assert.equal(res._status, 200);
});

test('text and html set their content types', () => {
  const r1 = makeRes();
  createContext(makeReq(), r1, '/', {}).text('hello');
  assert.equal(r1._sentHeaders!['Content-Type'], 'text/plain; charset=utf-8');
  assert.equal(r1._body, 'hello');

  const r2 = makeRes();
  createContext(makeReq(), r2, '/', {}).html('<b>hi</b>', 202);
  assert.equal(r2._status, 202);
  assert.equal(r2._sentHeaders!['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(r2._sentHeaders!['X-Content-Type-Options'], 'nosniff');
});

test('send writes an empty response with the given status', () => {
  const res = makeRes();
  const ctx = createContext(makeReq(), res, '/', {});
  ctx.send(204);
  assert.equal(res._status, 204);
  assert.equal(res._ended, true);
  assert.equal(res._body, undefined);
  assert.equal(ctx.sent, true);
});

test('the single-write guard prevents a second response', () => {
  const res = makeRes();
  const ctx = createContext(makeReq(), res, '/', {});
  ctx.json({ first: true });
  ctx.text('second');   // ignored
  ctx.html('third');    // ignored
  ctx.send(500);        // ignored
  assert.equal(res._body, '{"first":true}');
  assert.equal(res._status, 200);
});

test('setHeader delegates to the response', () => {
  const res = makeRes();
  createContext(makeReq(), res, '/', {}).setHeader('X-Trace', 'abc');
  assert.equal(res.getHeader('X-Trace'), 'abc');
});

// ── Cookies ──────────────────────────────────────────────────────────────────────

test('cookie reads and decodes a request cookie', () => {
  const req = makeReq({ headers: { cookie: 'a=1; token=hello%20world; b=2' } });
  const ctx = createContext(req, makeRes(), '/', {});
  assert.equal(ctx.cookie('token'), 'hello world');
  assert.equal(ctx.cookie('a'), '1');
  assert.equal(ctx.cookie('missing'), undefined);
});

test('cookie returns undefined when no cookie header is present', () => {
  const ctx = createContext(makeReq(), makeRes(), '/', {});
  assert.equal(ctx.cookie('x'), undefined);
});

test('setCookie appends multiple Set-Cookie values in order', () => {
  const res = makeRes();
  const ctx = createContext(makeReq(), res, '/', {});
  ctx.setCookie('a', '1');
  ctx.setCookie('b', '2', { path: '/' });
  const setCookie = res.getHeader('Set-Cookie') as string[];
  assert.ok(Array.isArray(setCookie));
  assert.equal(setCookie.length, 2);
  assert.match(setCookie[0]!, /^a=1; HttpOnly; SameSite=Lax$/);
  assert.match(setCookie[1]!, /^b=2; HttpOnly; SameSite=Lax; Path=\/$/);
});

test('setCookie coalesces a pre-existing string Set-Cookie header into an array', () => {
  const res = makeRes();
  res.setHeader('Set-Cookie', 'pre=existing');
  const ctx = createContext(makeReq(), res, '/', {});
  ctx.setCookie('new', 'v');
  const setCookie = res.getHeader('Set-Cookie') as string[];
  assert.deepEqual(setCookie[0], 'pre=existing');
  assert.match(setCookie[1]!, /^new=v; HttpOnly; SameSite=Lax$/);
});

// ── serializeCookie (pure) ──────────────────────────────────────────────────────

test('serializeCookie applies secure-by-default flags and encodes the value', () => {
  delete process.env.NODE_ENV; // not production
  const c = serializeCookie('sid', 'a b+c');
  assert.equal(c, 'sid=a%20b%2Bc; HttpOnly; SameSite=Lax');
});

test('serializeCookie omits HttpOnly when explicitly disabled', () => {
  const c = serializeCookie('sid', 'x', { httpOnly: false });
  assert.ok(!/HttpOnly/.test(c));
});

test('serializeCookie adds Secure in production by default', () => {
  process.env.NODE_ENV = 'production';
  assert.match(serializeCookie('sid', 'x'), /Secure/);
});

test('serializeCookie honors an explicit secure flag regardless of env', () => {
  delete process.env.NODE_ENV;
  assert.match(serializeCookie('sid', 'x', { secure: true }), /Secure/);
  process.env.NODE_ENV = 'production';
  assert.ok(!/Secure/.test(serializeCookie('sid', 'x', { secure: false })));
});

test('serializeCookie emits all attributes in a stable order', () => {
  delete process.env.NODE_ENV;
  const c = serializeCookie('sid', 'v', {
    sameSite: 'Strict',
    maxAge: 3600,
    path: '/app',
    domain: 'example.com',
  });
  assert.equal(c, 'sid=v; HttpOnly; SameSite=Strict; Max-Age=3600; Path=/app; Domain=example.com');
});
