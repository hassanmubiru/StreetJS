/**
 * @streetjs/router — runnable integration example.
 *
 * Registers a few routes (with params, middleware, and validation) and dispatches
 * fake contexts through them — no HTTP server needed. In a real app the server
 * builds a StreetContext per request and calls `router.dispatch(ctx)`.
 *
 * Run with: `npm run example -w packages/router`
 */

import type { StreetContext, MiddlewareFn } from '@streetjs/context';
import { Router, notFoundHandler, errorHandler } from '../index.js';
import type { ValidationSchema } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

function fakeCtx(method: string, path: string, body: unknown = null): StreetContext & { _json?: { data: unknown; status: number } } {
  const ctx = {
    method: method.toUpperCase(),
    path,
    params: {} as Record<string, string>,
    query: {} as Record<string, string>,
    headers: {} as Record<string, string>,
    body,
    state: {} as Record<string, unknown>,
    user: null,
    req: { socket: { remoteAddress: '127.0.0.1' } },
    setHeader() {},
    json(data: unknown, status = 200) { (ctx as { _json?: unknown })._json = { data, status }; },
  } as unknown as StreetContext & { _json?: { data: unknown; status: number } };
  return ctx;
}

const router = new Router();

// A logging middleware and a param route.
const log: MiddlewareFn = async (ctx, next) => { console.log(`  -> ${ctx.method} ${ctx.path}`); await next(); };
router.add('GET', '/users/:id', [log], (ctx) => ctx.json({ id: ctx.params['id'] }));

// A validated create route.
const schema: ValidationSchema = { body: { name: { type: 'string', required: true, min: 2 } } };
router.add('POST', '/users', [], (ctx) => ctx.json({ created: (ctx.body as { name: string }).name }, 201), schema);

// 1. Param route.
const g = fakeCtx('GET', '/users/7');
assert(await router.dispatch(g), 'user route matched');
assert((g._json!.data as { id: string }).id === '7', 'param extracted');
console.log('GET /users/7 ->', g._json!.data);

// 2. Valid create.
const c = fakeCtx('POST', '/users', { name: 'Ada' });
await router.dispatch(c);
assert(c._json!.status === 201, 'created');
console.log('POST /users ->', c._json!.status, c._json!.data);

// 3. Invalid create → the error handler masks it into a 400 body.
const bad = fakeCtx('POST', '/users', { name: 'x' });
try {
  await router.dispatch(bad);
  throw new Error('should have thrown');
} catch (err) {
  await errorHandler(bad, err);
  assert(bad._json!.status === 400, 'validation failed → 400');
  console.log('POST /users (invalid) ->', bad._json!.status);
}

// 4. No match → dispatch returns false; the app would call notFoundHandler.
const miss = fakeCtx('GET', '/nope');
assert((await router.dispatch(miss)) === false, 'no route matched');
try {
  await notFoundHandler(miss);
} catch (err) {
  await errorHandler(miss, err);
  assert(miss._json!.status === 404, 'not found → 404');
  console.log('GET /nope ->', miss._json!.status);
}

console.log('\nAll @streetjs/router example assertions passed.');
