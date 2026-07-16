/**
 * @streetjs/context — runnable integration example.
 *
 * Builds a StreetContext over a fake Node req/res (no real socket) and shows the
 * responders, the single-write guard, and secure-by-default cookies. In a real
 * app, `req`/`res` come from an `http.Server` request handler.
 *
 * Run with: `npm run example -w packages/context`
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createContext, serializeCookie } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

function fakeReq(headers: Record<string, string> = {}, method = 'GET'): IncomingMessage {
  return { method, headers } as unknown as IncomingMessage;
}

function fakeRes() {
  const headers: Record<string, unknown> = {};
  const state: { status?: number; body?: string; sent?: Record<string, string> } = {};
  return {
    res: {
      writeHead(s: number, h?: Record<string, string>) { state.status = s; if (h) state.sent = h; return this; },
      end(b?: string) { state.body = b; },
      setHeader(n: string, v: unknown) { headers[n] = v; },
      getHeader(n: string) { return headers[n]; },
    } as unknown as ServerResponse,
    state,
    headers,
  };
}

// 1. JSON response with the single-write guard.
{
  const { res, state } = fakeRes();
  const ctx = createContext(fakeReq({ 'x-request-id': 'r-1' }), res, '/users/42', { verbose: '1' });
  assert(ctx.method === 'GET' && ctx.path === '/users/42', 'method/path parsed');
  assert(ctx.headers['x-request-id'] === 'r-1', 'headers lowercased');

  ctx.json({ id: 42, name: 'Ada' }, 200);
  ctx.text('ignored'); // guard: response already sent
  console.log('response:', state.status, state.body);
  assert(state.body === '{"id":42,"name":"Ada"}', 'json body written once');
  assert(ctx.sent, 'context marked sent');
}

// 2. Reading a request cookie.
{
  const { res } = fakeRes();
  const ctx = createContext(fakeReq({ cookie: 'session=abc%20123; theme=dark' }), res, '/', {});
  assert(ctx.cookie('session') === 'abc 123', 'cookie decoded');
  assert(ctx.cookie('theme') === 'dark', 'second cookie read');
  assert(ctx.cookie('nope') === undefined, 'missing cookie is undefined');
}

// 3. Setting multiple secure-by-default cookies.
{
  const { res, headers } = fakeRes();
  const ctx = createContext(fakeReq(), res, '/', {});
  ctx.setCookie('sid', 'token');
  ctx.setCookie('locale', 'en', { httpOnly: false, sameSite: 'Strict', maxAge: 3600 });
  const cookies = headers['Set-Cookie'] as string[];
  console.log('Set-Cookie:', cookies);
  assert(cookies.length === 2, 'two cookies set');
  assert(/HttpOnly; SameSite=Lax/.test(cookies[0]!), 'defaults applied to first');
  assert(!/HttpOnly/.test(cookies[1]!) && /SameSite=Strict; Max-Age=3600/.test(cookies[1]!), 'overrides applied');
}

// 4. The pure serializer.
console.log('serializeCookie:', serializeCookie('a', 'b c'));
assert(serializeCookie('a', 'b c') === 'a=b%20c; HttpOnly; SameSite=Lax', 'pure serializer');

console.log('\nAll @streetjs/context example assertions passed.');
