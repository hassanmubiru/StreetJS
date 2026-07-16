/**
 * @streetjs/ratelimit — runnable integration example.
 *
 * Demonstrates the scoped `rateLimit` middleware and the `parseWindow` helper
 * over a fake context and an injected clock (no server needed). In a real app
 * you register the returned middleware on your router.
 *
 * Run with: `npm run example -w packages/ratelimit`
 */

import type { StreetContext } from '@streetjs/context';
import { rateLimit, parseWindow, RateLimitException } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

function fakeCtx(ip: string): StreetContext & { headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const sent: Record<string, string> = {};
  return {
    req: { socket: { remoteAddress: ip } },
    headers,
    user: null,
    setHeader(n: string, v: string) { sent[n] = v; },
    _sent: sent,
  } as unknown as StreetContext & { headers: Record<string, string> };
}

console.log('parseWindow("1m") =', parseWindow('1m'));
console.log('parseWindow("500ms") =', parseWindow('500ms'));
assert(parseWindow('1m') === 60_000, 'window parses to ms');

// A per-IP limiter: 3 requests per minute, with a controllable clock.
let now = 0;
const limiter = rateLimit({ scope: 'ip', requests: 3, window: '1m', clock: () => now });
const noop = async () => {};

let accepted = 0;
let rejected = 0;
for (let i = 0; i < 5; i++) {
  try {
    await limiter(fakeCtx('203.0.113.5'), noop);
    accepted++;
  } catch (err) {
    if (err instanceof RateLimitException) rejected++;
    else throw err;
  }
}
console.log(`within window: ${accepted} accepted, ${rejected} rejected (limit 3)`);
assert(accepted === 3 && rejected === 2, 'limit enforced within the window');

// After the window passes, the allowance recovers.
now += 61_000;
await limiter(fakeCtx('203.0.113.5'), noop);
console.log('after the window elapsed: request accepted again');

// A different IP is unaffected by another IP's usage.
now = 0;
await limiter(fakeCtx('198.51.100.7'), noop);
console.log('a distinct IP has its own bucket');

console.log('\nAll @streetjs/ratelimit example assertions passed.');
