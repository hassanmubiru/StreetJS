// tests/ratelimit-scopes.test.ts
// Example-based unit tests for scoped rate limiting (Phase 2, R3.2): verify that
// the `rateLimit({ scope })` middleware keys counts correctly for the global,
// per-IP, and per-user scopes against a shared InMemoryRateLimitStore.
//
// Each test injects a fixed clock so the sliding window never rolls off mid-test,
// isolating the keying behavior from window timing. The X-RateLimit-Remaining
// header is the observable signal of which bucket a request was counted against.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rateLimit,
  RateLimitException,
  type ScopedRateLimitOptions,
} from '../security/ratelimit.js';
import { InMemoryRateLimitStore, type Clock } from '../security/store.js';
import type { StreetContext } from '../core/context.js';

/** Build a minimal StreetContext for middleware, capturing response headers. */
function makeCtx(opts: { ip?: string; userId?: string } = {}): {
  ctx: StreetContext;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const ctx = {
    req: { socket: { remoteAddress: opts.ip ?? '127.0.0.1' } },
    headers: {},
    user: opts.userId ? { id: opts.userId, email: '', roles: [] } : null,
    state: {},
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as StreetContext;
  return { ctx, headers };
}

/** Fixed clock so the window never advances during a test. */
const FIXED_CLOCK: Clock = () => 1_000_000;

/** Run the middleware once against a fresh ctx and return the captured headers. */
async function run(
  mw: ReturnType<typeof rateLimit>,
  ctxOpts: { ip?: string; userId?: string } = {},
): Promise<Record<string, string>> {
  const { ctx, headers } = makeCtx(ctxOpts);
  await mw(ctx, async () => {});
  return headers;
}

/** Shared options factory pinning the store and clock for deterministic keying. */
function opts(
  scope: ScopedRateLimitOptions['scope'],
  store: InMemoryRateLimitStore,
  requests = 5,
): ScopedRateLimitOptions {
  return { scope, requests, window: '1m', store, clock: FIXED_CLOCK };
}

describe('rateLimit global scope', () => {
  it('counts all requests into a single shared bucket regardless of IP or user', async () => {
    const store = new InMemoryRateLimitStore();
    const mw = rateLimit(opts('global', store));

    // Distinct IPs and users all share the one global bucket, so the remaining
    // allowance decreases monotonically across them.
    const h1 = await run(mw, { ip: '1.1.1.1', userId: 'alice' });
    assert.equal(h1['X-RateLimit-Remaining'], '4');

    const h2 = await run(mw, { ip: '2.2.2.2', userId: 'bob' });
    assert.equal(h2['X-RateLimit-Remaining'], '3');

    const h3 = await run(mw, { ip: '3.3.3.3' });
    assert.equal(h3['X-RateLimit-Remaining'], '2');
  });

  it('rejects with 429 once the shared bucket is exhausted by any callers', async () => {
    const store = new InMemoryRateLimitStore();
    const mw = rateLimit(opts('global', store, 2));

    await run(mw, { ip: '1.1.1.1' });
    await run(mw, { ip: '2.2.2.2' }); // bucket now full across the two callers

    const { ctx } = makeCtx({ ip: '3.3.3.3' });
    await assert.rejects(
      () => mw(ctx, async () => {}),
      (err: unknown) => err instanceof RateLimitException,
    );
  });
});

describe('rateLimit per-IP scope', () => {
  it('keys independent buckets per remote IP', async () => {
    const store = new InMemoryRateLimitStore();
    const mw = rateLimit(opts('ip', store));

    // Two requests from the same IP share a bucket.
    const a1 = await run(mw, { ip: '10.0.0.1' });
    assert.equal(a1['X-RateLimit-Remaining'], '4');
    const a2 = await run(mw, { ip: '10.0.0.1' });
    assert.equal(a2['X-RateLimit-Remaining'], '3');

    // A different IP starts fresh — its bucket is independent.
    const b1 = await run(mw, { ip: '10.0.0.2' });
    assert.equal(b1['X-RateLimit-Remaining'], '4');
  });

  it('ignores user identity when keying by IP', async () => {
    const store = new InMemoryRateLimitStore();
    const mw = rateLimit(opts('ip', store));

    // Same IP, different users still share the IP bucket.
    const h1 = await run(mw, { ip: '10.0.0.9', userId: 'alice' });
    assert.equal(h1['X-RateLimit-Remaining'], '4');
    const h2 = await run(mw, { ip: '10.0.0.9', userId: 'bob' });
    assert.equal(h2['X-RateLimit-Remaining'], '3');
  });
});

describe('rateLimit per-user scope', () => {
  it('keys independent buckets per authenticated user, ignoring IP', async () => {
    const store = new InMemoryRateLimitStore();
    const mw = rateLimit(opts('user', store));

    // Same user from two different IPs shares one bucket.
    const a1 = await run(mw, { ip: '1.1.1.1', userId: 'alice' });
    assert.equal(a1['X-RateLimit-Remaining'], '4');
    const a2 = await run(mw, { ip: '2.2.2.2', userId: 'alice' });
    assert.equal(a2['X-RateLimit-Remaining'], '3');

    // A different user starts fresh.
    const b1 = await run(mw, { ip: '1.1.1.1', userId: 'bob' });
    assert.equal(b1['X-RateLimit-Remaining'], '4');
  });

  it('falls back to IP keying for unauthenticated requests', async () => {
    const store = new InMemoryRateLimitStore();
    const mw = rateLimit(opts('user', store));

    // No user → bucketed by IP; same IP shares, different IP is independent.
    const a1 = await run(mw, { ip: '5.5.5.5' });
    assert.equal(a1['X-RateLimit-Remaining'], '4');
    const a2 = await run(mw, { ip: '5.5.5.5' });
    assert.equal(a2['X-RateLimit-Remaining'], '3');

    const b1 = await run(mw, { ip: '6.6.6.6' });
    assert.equal(b1['X-RateLimit-Remaining'], '4');
  });

  it('supports a custom userKeyFn for resolving the user bucket', async () => {
    const store = new InMemoryRateLimitStore();
    const mw = rateLimit({
      scope: 'user',
      requests: 5,
      window: '1m',
      store,
      clock: FIXED_CLOCK,
      userKeyFn: (ctx) => (ctx.headers as Record<string, string>)['x-api-key'],
    });

    const build = (apiKey: string) => {
      const headers: Record<string, string> = {};
      const ctx = {
        req: { socket: { remoteAddress: '7.7.7.7' } },
        headers: { 'x-api-key': apiKey },
        user: null,
        state: {},
        setHeader: (n: string, v: string) => {
          headers[n] = v;
        },
      } as unknown as StreetContext;
      return { ctx, headers };
    };

    const k1 = build('key-A');
    await mw(k1.ctx, async () => {});
    assert.equal(k1.headers['X-RateLimit-Remaining'], '4');

    const k1again = build('key-A');
    await mw(k1again.ctx, async () => {});
    assert.equal(k1again.headers['X-RateLimit-Remaining'], '3');

    const k2 = build('key-B');
    await mw(k2.ctx, async () => {});
    assert.equal(k2.headers['X-RateLimit-Remaining'], '4');
  });
});

describe('rateLimit scopes are isolated from one another', () => {
  it('does not let one scope consume another scope key space', async () => {
    const store = new InMemoryRateLimitStore();
    const globalMw = rateLimit(opts('global', store));
    const ipMw = rateLimit(opts('ip', store));
    const userMw = rateLimit(opts('user', store));

    // The same store underlies all three, but their key prefixes differ, so a
    // hit in one scope does not deplete the others.
    const g = await run(globalMw, { ip: '9.9.9.9', userId: 'carol' });
    assert.equal(g['X-RateLimit-Remaining'], '4');

    const i = await run(ipMw, { ip: '9.9.9.9', userId: 'carol' });
    assert.equal(i['X-RateLimit-Remaining'], '4');

    const u = await run(userMw, { ip: '9.9.9.9', userId: 'carol' });
    assert.equal(u['X-RateLimit-Remaining'], '4');
  });
});
