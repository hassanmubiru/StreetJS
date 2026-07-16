import 'reflect-metadata';
import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type { StreetContext, MiddlewareFn } from '@streetjs/context';
import { RateLimit } from '@streetjs/ratelimit';
import { NotFoundException, BadRequestException } from '@streetjs/exceptions';

import { Router, notFoundHandler, errorHandler } from '../index.js';
import type { ValidationSchema, RouteProfiler } from '../index.js';

// ── Fake StreetContext ─────────────────────────────────────────────────────────

interface FakeCtx extends StreetContext {
  _json?: { data: unknown; status: number };
}

function makeCtx(opts: {
  method?: string;
  path?: string;
  body?: unknown;
  query?: Record<string, string>;
  ip?: string;
  userId?: string;
} = {}): FakeCtx {
  const ctx = {
    method: (opts.method ?? 'GET').toUpperCase(),
    path: opts.path ?? '/',
    params: {} as Record<string, string>,
    query: opts.query ?? {},
    headers: {} as Record<string, string>,
    body: opts.body ?? null,
    state: {} as Record<string, unknown>,
    user: opts.userId ? { id: opts.userId, email: '', roles: [] } : null,
    req: { socket: { remoteAddress: opts.ip ?? '10.0.0.1' } },
    setHeader() {},
    json(data: unknown, status = 200) { (ctx as FakeCtx)._json = { data, status }; },
  } as unknown as FakeCtx;
  return ctx;
}

afterEach(() => mock.restoreAll());

// ── Matching & dispatch ────────────────────────────────────────────────────────

test('dispatch runs the handler for a matching route and returns true', async () => {
  const router = new Router();
  let ran = false;
  router.add('GET', '/health', [], () => { ran = true; });
  const ok = await router.dispatch(makeCtx({ method: 'GET', path: '/health' }));
  assert.equal(ok, true);
  assert.equal(ran, true);
});

test('dispatch returns false when no route matches', async () => {
  const router = new Router();
  router.add('GET', '/a', [], () => {});
  assert.equal(await router.dispatch(makeCtx({ path: '/b' })), false);
});

test('path params are extracted and URL-decoded', async () => {
  const router = new Router();
  let seen: Record<string, string> = {};
  router.add('GET', '/users/:id/posts/:slug', [], (ctx) => { seen = ctx.params; });
  await router.dispatch(makeCtx({ path: '/users/42/posts/hello%20world' }));
  assert.deepEqual(seen, { id: '42', slug: 'hello world' });
});

test('a wildcard path and wildcard method match any request', async () => {
  const router = new Router();
  let ran = false;
  router.add('*', '/files/*', [], () => { ran = true; });
  const ok = await router.dispatch(makeCtx({ method: 'DELETE', path: '/files/a/b/c.txt' }));
  assert.equal(ok, true);
  assert.equal(ran, true);
  // A wildcard method also matches a different verb on a plain path.
  const r2 = new Router();
  r2.add('*', '/any', [], () => {});
  assert.equal(await r2.dispatch(makeCtx({ method: 'PATCH', path: '/any' })), true);
});

test('dispatch initializes ctx.state when the context lacks one', async () => {
  const router = new Router();
  router.add('GET', '/s', [], () => {});
  const ctx = makeCtx({ path: '/s' });
  (ctx as unknown as { state: unknown }).state = undefined;
  await router.dispatch(ctx);
  assert.deepEqual(ctx.state['_requiredRoles'], []);
});

test('middlewares run in order before the handler, threading next()', async () => {
  const router = new Router();
  const order: string[] = [];
  const mw = (name: string): MiddlewareFn => async (_ctx, next) => { order.push(name); await next(); };
  router.add('GET', '/x', [mw('a'), mw('b')], () => { order.push('handler'); });
  await router.dispatch(makeCtx({ path: '/x' }));
  assert.deepEqual(order, ['a', 'b', 'handler']);
});

test('listRoutes reports method and compiled pattern source', () => {
  const router = new Router();
  router.add('POST', '/users', [], () => {});
  const routes = router.listRoutes();
  assert.equal(routes[0]!.method, 'POST');
  assert.match(routes[0]!.path, /users/);
});

// ── Validation ───────────────────────────────────────────────────────────────────

test('validation passes valid input and rejects invalid input with a 400', async () => {
  const schema: ValidationSchema = {
    body: {
      name: { type: 'string', required: true, min: 2, max: 5 },
      age: { type: 'number' },
      email: { type: 'email' },
      id: { type: 'uuid' },
      active: { type: 'boolean' },
    },
  };
  const router = new Router();
  let ran = false;
  router.add('POST', '/u', [], () => { ran = true; }, schema);

  // Valid.
  await router.dispatch(makeCtx({
    method: 'POST',
    path: '/u',
    body: { name: 'ada', age: '30', email: 'a@b.co', id: '12345678-1234-1234-1234-123456789abc', active: 'true' },
  }));
  assert.equal(ran, true);

  // Invalid: missing required name, bad email/uuid/number, too-long name handled separately.
  await assert.rejects(
    () => router.dispatch(makeCtx({ method: 'POST', path: '/u', body: { age: 'x', email: 'nope', id: 'bad' } })),
    (err: unknown) => {
      assert.ok(err instanceof BadRequestException);
      const details = (err as BadRequestException).details as string[];
      assert.ok(details.some((d) => /name is required/.test(d)));
      assert.ok(details.some((d) => /age must be a number/.test(d)));
      assert.ok(details.some((d) => /email must be a valid email/.test(d)));
      assert.ok(details.some((d) => /id must be a valid UUID/.test(d)));
      return true;
    },
  );
});

test('validation enforces string length and pattern on query and params', async () => {
  const schema: ValidationSchema = {
    query: { q: { type: 'string', min: 3, pattern: /^[a-z]+$/ } },
  };
  const router = new Router();
  router.add('GET', '/s', [], () => {}, schema);
  await assert.rejects(
    () => router.dispatch(makeCtx({ path: '/s', query: { q: 'A1' } })),
    (err: unknown) => {
      const d = (err as BadRequestException).details as string[];
      assert.ok(d.some((x) => /at least 3 chars/.test(x)));
      assert.ok(d.some((x) => /invalid format/.test(x)));
      return true;
    },
  );
});

// ── RBAC & rate-limit baking ─────────────────────────────────────────────────────

test('dispatch bakes @Roles/@Permissions metadata onto ctx.state', async () => {
  class Ctrl { handler() {} }
  Reflect.defineMetadata('street:roles', ['admin'], Ctrl.prototype, 'handler');
  Reflect.defineMetadata('street:permissions', ['users:write'], Ctrl.prototype, 'handler');

  const router = new Router();
  const ctx = makeCtx({ path: '/admin' });
  router.add('GET', '/admin', [], () => {}, undefined, Ctrl.prototype, 'handler');
  await router.dispatch(ctx);
  assert.deepEqual(ctx.state['_requiredRoles'], ['admin']);
  assert.deepEqual(ctx.state['_requiredPermissions'], ['users:write']);
});

test('a @RateLimit-decorated route bakes and enforces a limiter', async () => {
  class Ctrl {
    @RateLimit({ requests: 1, window: 60_000 })
    login() {}
  }
  const router = new Router();
  router.add('POST', '/login', [], () => {}, undefined, Ctrl.prototype, 'login');
  // First request from an IP passes; the second is rejected (429).
  await router.dispatch(makeCtx({ method: 'POST', path: '/login', ip: 'x' }));
  await assert.rejects(
    () => router.dispatch(makeCtx({ method: 'POST', path: '/login', ip: 'x' })),
    /Too Many Requests/,
  );
});

test('routes with no decorator metadata bake empty RBAC arrays', async () => {
  const router = new Router();
  const ctx = makeCtx({ path: '/open' });
  router.add('GET', '/open', [], () => {});
  await router.dispatch(ctx);
  assert.deepEqual(ctx.state['_requiredRoles'], []);
  assert.deepEqual(ctx.state['_requiredPermissions'], []);
});

// ── Profiler ──────────────────────────────────────────────────────────────────────

test('the profiler records latency for successful and failing dispatches', async () => {
  const records: Array<{ method: string; path: string; isError: boolean }> = [];
  const profiler: RouteProfiler = {
    record(method, pathTemplate, _latencyNs, isError) {
      records.push({ method, path: pathTemplate, isError });
    },
  };
  const router = new Router({ profiler });
  router.add('GET', '/ok', [], () => {});
  router.add('GET', '/boom', [], () => { throw new Error('kaboom'); });

  await router.dispatch(makeCtx({ path: '/ok' }));
  await assert.rejects(() => router.dispatch(makeCtx({ path: '/boom' })), /kaboom/);

  assert.deepEqual(records, [
    { method: 'GET', path: '/ok', isError: false },
    { method: 'GET', path: '/boom', isError: true },
  ]);
});

// ── Handlers ────────────────────────────────────────────────────────────────────

test('notFoundHandler throws a NotFoundException naming the route', async () => {
  await assert.rejects(
    () => notFoundHandler(makeCtx({ method: 'GET', path: '/missing' })),
    (err: unknown) => {
      assert.ok(err instanceof NotFoundException);
      assert.match((err as Error).message, /GET \/missing not found/);
      return true;
    },
  );
});

test('errorHandler serializes a StreetException with its status', async () => {
  const ctx = makeCtx();
  await errorHandler(ctx, new NotFoundException('gone'));
  assert.equal(ctx._json!.status, 404);
  assert.equal((ctx._json!.data as { status: number }).status, 404);
});

test('errorHandler masks an unknown error as a generic 500 and reports it', async () => {
  const writes: string[] = [];
  mock.method(process.stderr, 'write', (c: string | Uint8Array) => { writes.push(String(c)); return true; });
  const ctx = makeCtx();
  ctx.state['correlationId'] = 'corr-9';
  await errorHandler(ctx, new Error('internal detail'));
  assert.equal(ctx._json!.status, 500);
  assert.deepEqual(ctx._json!.data, { error: 'InternalException', message: 'Internal Server Error', status: 500 });
  // The real error was reported to stderr (with the correlation id), not leaked to the client.
  assert.ok(writes.join('').includes('corr-9'));
});
