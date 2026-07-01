// tests/ratelimit-store.test.ts
// Unit coverage for the pluggable rate-limit / counter / key-value stores
// (security/store.ts) and the sliding-window rate limiter + scoped middleware
// (security/ratelimit.ts). All paths are deterministic via an injected clock
// and require no database, network, or live broker.

import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  systemClock,
  InMemoryRateLimitStore,
  InMemoryCounterStore,
  InMemoryKeyValueStore,
} from '../security/store.js';
import {
  parseWindow,
  RateLimiter,
  RateLimitException,
  rateLimit,
  RateLimit,
  getRateLimitMeta,
  RedisRateLimitStore,
  type RedisLike,
} from '../security/ratelimit.js';

/** Minimal StreetContext stand-in exposing only the fields the limiter reads. */
function makeCtx(opts: { ip?: string; xff?: string; userId?: string } = {}): {
  ctx: any;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const ctx = {
    setHeader: (name: string, value: string) => { headers[name] = value; },
    req: { socket: { remoteAddress: opts.ip ?? '203.0.113.7' } },
    headers: opts.xff ? { 'x-forwarded-for': opts.xff } : {},
    user: opts.userId !== undefined ? { id: opts.userId } : undefined,
  };
  return { ctx, headers };
}

/** A controllable clock for deterministic window timing. */
function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('security/store — InMemoryRateLimitStore', () => {
  it('counts hits within the window and prunes expired ones via the injected clock', async () => {
    const clk = fakeClock();
    const store = new InMemoryRateLimitStore({ clock: clk.now });
    assert.equal(store.now(), clk.now());
    assert.equal(await store.hit('k', clk.now(), 1000), 1);
    assert.equal(await store.hit('k', clk.now(), 1000), 2);
    assert.equal(await store.count('k', clk.now(), 1000), 2);
    // Advance past the window: old hits prune on the next access.
    clk.advance(2000);
    assert.equal(await store.count('k', clk.now(), 1000), 0);
    assert.equal(await store.hit('k', clk.now(), 1000), 1);
    assert.equal(store.size(), 1);
    store.reset('k');
    assert.equal(store.size(), 0);
    store.destroy();
  });

  it('count returns 0 for an unknown key', async () => {
    const store = new InMemoryRateLimitStore();
    assert.equal(await store.count('missing', Date.now(), 1000), 0);
    store.destroy();
  });

  it('evicts the oldest key when maxKeys is reached', async () => {
    const store = new InMemoryRateLimitStore({ maxKeys: 2 });
    await store.hit('a', 0, 1000);
    await store.hit('b', 0, 1000);
    await store.hit('c', 0, 1000); // evicts 'a'
    assert.equal(store.size(), 2);
    store.destroy();
  });

  it('bounds stored timestamps per key at maxRequestsPerKey', async () => {
    const store = new InMemoryRateLimitStore({ maxRequestsPerKey: 3 });
    for (let i = 0; i < 10; i++) await store.hit('k', i, 1_000_000);
    // Count never exceeds the per-key cap.
    assert.equal(await store.count('k', 10, 1_000_000), 3);
    store.destroy();
  });

  it('periodic sweep drops idle keys older than the retention horizon', async () => {
    const clk = fakeClock();
    const store = new InMemoryRateLimitStore({
      clock: clk.now,
      sweepIntervalMs: 10,
      retentionMs: 100,
    });
    await store.hit('k', clk.now(), 50);
    assert.equal(store.size(), 1);
    clk.advance(500);
    // Invoke the private sweep deterministically rather than waiting on a timer.
    (store as unknown as { _sweep(): void })._sweep();
    assert.equal(store.size(), 0);
    store.destroy();
  });
});

describe('security/store — InMemoryCounterStore', () => {
  it('increments and counts a sliding window then resets', async () => {
    const clk = fakeClock();
    const counter = new InMemoryCounterStore({ clock: clk.now });
    assert.equal(await counter.increment('u', clk.now(), 1000), 1);
    assert.equal(await counter.increment('u', clk.now(), 1000), 2);
    assert.equal(await counter.count('u', clk.now(), 1000), 2);
    await counter.reset('u');
    assert.equal(await counter.count('u', clk.now(), 1000), 0);
    counter.destroy();
  });
});

describe('security/store — InMemoryKeyValueStore', () => {
  it('stores, retrieves, and deletes values', async () => {
    const kv = new InMemoryKeyValueStore();
    assert.equal(await kv.get('missing'), undefined);
    await kv.set('k', 'v');
    assert.equal(await kv.get('k'), 'v');
    await kv.delete('k');
    assert.equal(await kv.get('k'), undefined);
  });

  it('expires entries past their TTL using the injected clock', async () => {
    const clk = fakeClock();
    const kv = new InMemoryKeyValueStore({ clock: clk.now });
    await kv.set('k', 'v', 100);
    assert.equal(await kv.get('k'), 'v');
    clk.advance(101);
    assert.equal(await kv.get('k'), undefined);
    await kv.set('a', '1');
    await kv.set('b', '2');
    kv.clear();
    assert.equal(await kv.get('a'), undefined);
  });

  it('systemClock returns an increasing wall-clock millisecond value', () => {
    assert.equal(typeof systemClock(), 'number');
    assert.ok(systemClock() > 0);
  });
});

describe('security/ratelimit — parseWindow', () => {
  it('parses numeric milliseconds and human-readable units', () => {
    assert.equal(parseWindow(5000), 5000);
    assert.equal(parseWindow('500ms'), 500);
    assert.equal(parseWindow('30s'), 30_000);
    assert.equal(parseWindow('1m'), 60_000);
    assert.equal(parseWindow('2h'), 7_200_000);
    assert.equal(parseWindow('7d'), 604_800_000);
    assert.equal(parseWindow('1.5h'), 5_400_000);
    assert.equal(parseWindow('1000'), 1000); // bare number string = ms
  });

  it('throws on non-positive or unparseable windows', () => {
    assert.throws(() => parseWindow(0));
    assert.throws(() => parseWindow(-5));
    assert.throws(() => parseWindow('nope'));
    assert.throws(() => parseWindow('10x'));
  });
});

describe('security/ratelimit — RateLimiter (class)', () => {
  it('allows up to the limit, sets headers, then rejects with 429', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const mw = limiter.middleware();

    const a = makeCtx({ ip: '198.51.100.1' });
    await mw(a.ctx, async () => {});
    assert.equal(a.headers['X-RateLimit-Limit'], '2');
    assert.equal(a.headers['X-RateLimit-Remaining'], '1');

    const b = makeCtx({ ip: '198.51.100.1' });
    await mw(b.ctx, async () => {});
    assert.equal(b.headers['X-RateLimit-Remaining'], '0');

    const c = makeCtx({ ip: '198.51.100.1' });
    await assert.rejects(() => mw(c.ctx, async () => {}), (e: unknown) => e instanceof RateLimitException);
    assert.equal(c.headers['Retry-After'], '60');
    limiter.destroy();
  });

  it('uses the rightmost X-Forwarded-For entry only when trustProxy is enabled', async () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1, trustProxy: true });
    const mw = limiter.middleware();
    const { ctx } = makeCtx({ ip: '10.0.0.1', xff: '1.1.1.1, 2.2.2.2' });
    await mw(ctx, async () => {});
    // A second hit for the same proxied key is rejected.
    const { ctx: ctx2 } = makeCtx({ ip: '10.0.0.1', xff: '9.9.9.9, 2.2.2.2' });
    await assert.rejects(() => mw(ctx2, async () => {}));
    limiter.destroy();
  });
});

describe('security/ratelimit — rateLimit (scoped middleware)', () => {
  it('rejects invalid requests counts', () => {
    assert.throws(() => rateLimit({ scope: 'ip', requests: 0, window: '1m' }));
    assert.throws(() => rateLimit({ scope: 'ip', requests: 1.5, window: '1m' }));
  });

  it('enforces a global bucket across distinct IPs', async () => {
    const clk = fakeClock();
    const store = new InMemoryRateLimitStore({ clock: clk.now });
    const mw = rateLimit({ scope: 'global', requests: 1, window: '1m', store, clock: clk.now });
    await mw(makeCtx({ ip: 'a' }).ctx, async () => {});
    await assert.rejects(() => mw(makeCtx({ ip: 'b' }).ctx, async () => {}));
    store.destroy();
  });

  it('keys per-IP and per-user independently', async () => {
    const clk = fakeClock();
    const ipMw = rateLimit({ scope: 'ip', requests: 1, window: '1m', clock: clk.now });
    await ipMw(makeCtx({ ip: 'x' }).ctx, async () => {});
    await ipMw(makeCtx({ ip: 'y' }).ctx, async () => {}); // different IP, allowed

    const userMw = rateLimit({ scope: 'user', requests: 1, window: '1m', clock: clk.now });
    await userMw(makeCtx({ userId: 'u1' }).ctx, async () => {});
    await assert.rejects(() => userMw(makeCtx({ userId: 'u1' }).ctx, async () => {}));
    // Unauthenticated falls back to IP keying (still bounded).
    await userMw(makeCtx({ ip: 'z' }).ctx, async () => {});
  });
});

describe('security/ratelimit — @RateLimit decorator', () => {
  it('attaches and retrieves rate-limit metadata', () => {
    class Ctrl {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      handler(): void {}
    }
    const dec = RateLimit({ requests: 100, window: 60_000, key: 'login' });
    dec(Ctrl.prototype, 'handler', Object.getOwnPropertyDescriptor(Ctrl.prototype, 'handler')!);
    const meta = getRateLimitMeta(Ctrl.prototype, 'handler');
    assert.deepEqual(meta, { requests: 100, window: 60_000, key: 'login' });
    assert.equal(getRateLimitMeta(Ctrl.prototype, 'missing'), undefined);
  });
});

describe('security/ratelimit — RedisRateLimitStore', () => {
  // Minimal in-memory fake of the RESP commands the store issues.
  function fakeRedis(): RedisLike {
    const sets = new Map<string, Map<string, number>>(); // key -> member -> score
    return {
      async command(args: (string | number)[]): Promise<unknown> {
        const [cmd, key] = [String(args[0]).toUpperCase(), String(args[1])];
        const set = sets.get(key) ?? new Map<string, number>();
        sets.set(key, set);
        switch (cmd) {
          case 'ZREMRANGEBYSCORE': {
            const upper = String(args[3]); // e.g. "(cutoff"
            const exclusive = upper.startsWith('(');
            const bound = Number(exclusive ? upper.slice(1) : upper);
            for (const [m, score] of set) {
              if (score < bound) set.delete(m);
            }
            return 0;
          }
          case 'ZADD': {
            set.set(String(args[3]), Number(args[2]));
            return 1;
          }
          case 'PEXPIRE':
            return 1;
          case 'ZCARD':
            return set.size;
          default:
            return 0;
        }
      },
    };
  }

  it('records hits and counts the sliding window via sorted-set commands', async () => {
    const store = new RedisRateLimitStore(fakeRedis(), { keyPrefix: 'rl:' });
    assert.equal(await store.hit('user:1', 1000, 1000), 1);
    assert.equal(await store.hit('user:1', 1500, 1000), 2);
    assert.equal(await store.count('user:1', 1500, 1000), 2);
    // Advance beyond the window: earlier members are trimmed.
    assert.equal(await store.count('user:1', 2600, 1000), 0);
  });
});
