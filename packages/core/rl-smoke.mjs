import { parseWindow, rateLimit, RedisRateLimitStore } from './dist/security/ratelimit.js';
import { InMemoryRateLimitStore } from './dist/security/store.js';
import assert from 'node:assert';

assert.equal(parseWindow('1m'), 60_000);
assert.equal(parseWindow('30s'), 30_000);
assert.equal(parseWindow('2h'), 7_200_000);
assert.equal(parseWindow('500ms'), 500);
assert.equal(parseWindow(5_000), 5_000);
assert.throws(() => parseWindow('bogus'));
assert.throws(() => parseWindow(0));

let t = 1_000;
const clock = () => t;
const store = new InMemoryRateLimitStore({ clock });
const mw = rateLimit({ scope: 'ip', requests: 2, window: '1m', store, clock });

function mkCtx(ip) {
  const headers = {};
  return { req: { socket: { remoteAddress: ip } }, headers: {}, user: undefined,
    setHeader(k, v) { headers[k] = v; }, _headers: headers };
}
async function run(ctx) { let ran = false;
  try { await mw(ctx, async () => { ran = true; }); } catch (e) { return { ran, err: e }; }
  return { ran }; }

const a = mkCtx('1.1.1.1');
let r = await run(a); assert.equal(r.ran, true); assert.equal(a._headers['X-RateLimit-Remaining'], '1');
r = await run(a); assert.equal(r.ran, true); assert.equal(a._headers['X-RateLimit-Remaining'], '0');
r = await run(a); assert.equal(r.ran, false); assert.equal(r.err.statusCode ?? r.err.status, 429);
assert.equal(a._headers['Retry-After'], '60');
const b = mkCtx('2.2.2.2');
r = await run(b); assert.equal(r.ran, true);

class FakeRedis {
  sets = new Map();
  async command(args) {
    const [cmd, key, ...rest] = args.map(String);
    if (cmd === 'ZREMRANGEBYSCORE') {
      const set = this.sets.get(key) ?? [];
      const exclusive = rest[1].startsWith('(');
      const lo = exclusive ? Number(rest[1].slice(1)) : Number(rest[1]);
      this.sets.set(key, set.filter(m => exclusive ? m.score >= lo : m.score > lo));
      return 0;
    }
    if (cmd === 'ZADD') { const set = this.sets.get(key) ?? []; set.push({ score: Number(rest[0]), member: rest[1] }); this.sets.set(key, set); return 1; }
    if (cmd === 'PEXPIRE') return 1;
    if (cmd === 'ZCARD') return (this.sets.get(key) ?? []).length;
    return null;
  }
}
const redis = new FakeRedis();
const rstore = new RedisRateLimitStore(redis, { keyPrefix: 'rl:' });
assert.equal(await rstore.hit('k', 1000, 60_000), 1);
assert.equal(await rstore.hit('k', 1500, 60_000), 2);
assert.equal(await rstore.count('k', 1500, 60_000), 2);
assert.equal(await rstore.count('k', 1000 + 60_001, 60_000), 1);

console.log('ALL SMOKE CHECKS PASSED');
