import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { StreetContext } from '@streetjs/context';
import {
  RateLimiter,
  RateLimitException,
  RateLimit,
  getRateLimitMeta,
  rateLimit,
  parseWindow,
  RedisRateLimitStore,
  type RedisLike,
} from '../index.js';

// ── Fake StreetContext ─────────────────────────────────────────────────────────

interface FakeCtx extends StreetContext {
  _headers: Record<string, string>;
}

function makeCtx(opts: { ip?: string; xff?: string; userId?: string } = {}): FakeCtx {
  const headers: Record<string, string> = {};
  if (opts.xff) headers['x-forwarded-for'] = opts.xff;
  const ctx = {
    _headers: {} as Record<string, string>,
    req: { socket: { remoteAddress: opts.ip ?? '10.0.0.1' } },
    headers,
    user: opts.userId ? { id: opts.userId, email: '', roles: [] } : null,
    setHeader(name: string, value: string) { (ctx as FakeCtx)._headers[name] = value; },
  } as unknown as FakeCtx;
  return ctx;
}

const noop = async () => {};

// ── parseWindow ──────────────────────────────────────────────────────────────────

test('parseWindow handles units, bare numbers, and numeric input', () => {
  assert.equal(parseWindow('1m'), 60_000);
  assert.equal(parseWindow('30s'), 30_000);
  assert.equal(parseWindow('2h'), 7_200_000);
  assert.equal(parseWindow('7d'), 604_800_000);
  assert.equal(parseWindow('500ms'), 500);
  assert.equal(parseWindow('1.5h'), 5_400_000);
  assert.equal(parseWindow('1000'), 1000, 'bare number string is ms');
  assert.equal(parseWindow(5000), 5000);
});

test('parseWindow rejects invalid or non-positive windows', () => {
  assert.throws(() => parseWindow('nonsense'), /Invalid rate-limit window/);
  assert.throws(() => parseWindow(0), /Invalid rate-limit window/);
  assert.throws(() => parseWindow(-5), /Invalid rate-limit window/);
  assert.throws(() => parseWindow(Number.POSITIVE_INFINITY), /Invalid rate-limit window/);
});

// ── RateLimiter (class) ────────────────────────────────────────────────────────

test('RateLimiter allows up to maxRequests then rejects with 429 + headers', async () => {
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
  const mw = limiter.middleware();
  const ctx = makeCtx({ ip: '1.2.3.4' });

  await mw(ctx, noop); // 1
  assert.equal(ctx._headers['X-RateLimit-Limit'], '2');
  assert.equal(ctx._headers['X-RateLimit-Remaining'], '1');
  await mw(ctx, noop); // 2
  assert.equal(ctx._headers['X-RateLimit-Remaining'], '0');

  await assert.rejects(() => mw(ctx, noop), (e: unknown) => {
    assert.ok(e instanceof RateLimitException);
    assert.equal((e as RateLimitException).status, 429);
    return true;
  });
  assert.equal(ctx._headers['Retry-After'], '60');
  limiter.destroy();
});

test('RateLimiter isolates buckets by key (remote IP by default)', async () => {
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
  const mw = limiter.middleware();
  await mw(makeCtx({ ip: 'a' }), noop);
  // A different IP has its own fresh bucket.
  await assert.doesNotReject(() => mw(makeCtx({ ip: 'b' }), noop));
  limiter.destroy();
});

test('RateLimiter with trustProxy uses the rightmost X-Forwarded-For IP', async () => {
  const seen: string[] = [];
  const limiter = new RateLimiter({
    windowMs: 60_000,
    maxRequests: 5,
    trustProxy: true,
    keyFn: undefined,
  });
  // Use the internal keyFn indirectly: two requests with the same rightmost
  // proxy IP share a bucket even if the client-forged leftmost differs.
  const mw = limiter.middleware();
  const ctx1 = makeCtx({ xff: 'forged, 203.0.113.9' });
  const ctx2 = makeCtx({ xff: 'other, 203.0.113.9' });
  await mw(ctx1, noop);
  await mw(ctx2, noop);
  seen.push(ctx1._headers['X-RateLimit-Remaining']!, ctx2._headers['X-RateLimit-Remaining']!);
  // Same bucket → remaining decremented across both (5→4, then 4→3).
  assert.deepEqual(seen, ['4', '3']);
  limiter.destroy();
});

test('RateLimiter honors a custom keyFn and message', async () => {
  const limiter = new RateLimiter({
    windowMs: 60_000,
    maxRequests: 1,
    keyFn: () => 'fixed',
    message: 'slow down',
  });
  const mw = limiter.middleware();
  await mw(makeCtx(), noop);
  await assert.rejects(() => mw(makeCtx(), noop), /slow down/);
  limiter.destroy();
});

// ── @RateLimit decorator ────────────────────────────────────────────────────────

test('@RateLimit stores metadata retrievable via getRateLimitMeta', () => {
  class Controller {
    @RateLimit({ requests: 100, window: 60_000, key: 'login' })
    login() {}
  }
  const meta = getRateLimitMeta(Controller.prototype, 'login');
  assert.deepEqual(meta, { requests: 100, window: 60_000, key: 'login' });
  assert.equal(getRateLimitMeta(Controller.prototype, 'missing'), undefined);
});

// ── rateLimit (scoped factory) ────────────────────────────────────────────────

test('rateLimit validates the requests option', () => {
  assert.throws(() => rateLimit({ scope: 'ip', requests: 0, window: '1m' }), /positive integer/);
  assert.throws(() => rateLimit({ scope: 'ip', requests: 1.5, window: '1m' }), /positive integer/);
});

test('rateLimit (ip scope) allows then rejects within the window', async () => {
  let t = 1_000_000;
  const mw = rateLimit({ scope: 'ip', requests: 2, window: '1m', clock: () => t });
  const ctx = makeCtx({ ip: '9.9.9.9' });
  await mw(ctx, noop);
  assert.equal(ctx._headers['X-RateLimit-Remaining'], '1');
  await mw(ctx, noop);
  assert.equal(ctx._headers['X-RateLimit-Remaining'], '0');
  await assert.rejects(() => mw(ctx, noop), /Too Many Requests/);
  assert.equal(ctx._headers['Retry-After'], '60');

  // After the window elapses, the allowance recovers.
  t += 61_000;
  await assert.doesNotReject(() => mw(ctx, noop));
});

test('rateLimit (global scope) shares one bucket across all callers', async () => {
  let t = 0;
  const mw = rateLimit({ scope: 'global', requests: 1, window: '1m', clock: () => t });
  await mw(makeCtx({ ip: 'a' }), noop);
  await assert.rejects(() => mw(makeCtx({ ip: 'b' }), noop), /Too Many Requests/);
});

test('rateLimit (user scope) keys by user id and falls back to IP when anonymous', async () => {
  let t = 0;
  const mw = rateLimit({ scope: 'user', requests: 1, window: '1m', clock: () => t });
  // Same user → shared bucket.
  await mw(makeCtx({ userId: 'u1' }), noop);
  await assert.rejects(() => mw(makeCtx({ userId: 'u1' }), noop), /Too Many Requests/);
  // Different user → separate bucket.
  await assert.doesNotReject(() => mw(makeCtx({ userId: 'u2' }), noop));
  // Anonymous falls back to IP.
  await assert.doesNotReject(() => mw(makeCtx({ ip: 'anon-ip' }), noop));
});

test('rateLimit supports a custom userKeyFn', async () => {
  let t = 0;
  const mw = rateLimit({
    scope: 'user',
    requests: 1,
    window: '1m',
    clock: () => t,
    userKeyFn: (ctx) => ctx.headers['x-api-key'],
  });
  const a = makeCtx();
  a.headers['x-api-key'] = 'key-1';
  await mw(a, noop);
  const b = makeCtx();
  b.headers['x-api-key'] = 'key-1';
  await assert.rejects(() => mw(b, noop), /Too Many Requests/);
});

// ── RedisRateLimitStore ────────────────────────────────────────────────────────

test('RedisRateLimitStore issues the expected commands and returns ZCARD', async () => {
  const calls: (string | number)[][] = [];
  let card = 0;
  const redis: RedisLike = {
    async command(args) {
      calls.push(args);
      if (args[0] === 'ZADD') card++;
      if (args[0] === 'ZCARD') return card;
      return 'OK';
    },
  };
  const store = new RedisRateLimitStore(redis, { keyPrefix: 'rl:' });
  const n = await store.hit('ip:1', 10_000, 1000);
  assert.equal(n, 1);
  // Verify the command sequence: trim, add, expire, then count.
  assert.equal(calls[0]![0], 'ZREMRANGEBYSCORE');
  assert.deepEqual(calls[0]!.slice(1), ['rl:ip:1', '-inf', '(9000']);
  assert.equal(calls[1]![0], 'ZADD');
  assert.equal(calls[2]![0], 'PEXPIRE');
  assert.equal(calls[3]![0], 'ZCARD');

  const c = await store.count('ip:1', 10_000, 1000);
  assert.equal(c, 1, 'count trims and returns cardinality without adding');
});

test('RedisRateLimitStore coerces a non-number ZCARD reply and defaults the prefix', async () => {
  const redis: RedisLike = {
    async command(args) {
      if (args[0] === 'ZCARD') return '3'; // string reply
      return 'OK';
    },
  };
  const store = new RedisRateLimitStore(redis); // default prefix 'ratelimit:'
  assert.equal(await store.count('k', 1, 1), 3);
});

test('rateLimit works over a RedisRateLimitStore backing', async () => {
  let card = 0;
  const redis: RedisLike = {
    async command(args) {
      if (args[0] === 'ZADD') card++;
      if (args[0] === 'ZCARD') return card;
      return 'OK';
    },
  };
  let t = 0;
  const mw = rateLimit({
    scope: 'ip',
    requests: 1,
    window: '1m',
    clock: () => t,
    store: new RedisRateLimitStore(redis),
  });
  await mw(makeCtx({ ip: 'x' }), noop);
  await assert.rejects(() => mw(makeCtx({ ip: 'x' }), noop), /Too Many Requests/);
});
