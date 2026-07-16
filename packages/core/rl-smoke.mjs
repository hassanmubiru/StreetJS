import { rateLimit, parseWindow, RateLimitException, RateLimiter } from './dist/security/ratelimit.js';
console.log('parseWindow', parseWindow('1m'), 'types', typeof rateLimit, typeof RateLimiter, typeof RateLimitException);
let t = 0;
const mw = rateLimit({ scope: 'ip', requests: 1, window: '1m', clock: () => t });
const ctx = { req: { socket: { remoteAddress: '1.1.1.1' } }, headers: {}, user: null, setHeader() {} };
await mw(ctx, async () => {});
let rejected = false;
try { await mw(ctx, async () => {}); } catch (e) { rejected = e instanceof RateLimitException; }
console.log('OK second-request-rejected=', rejected);
