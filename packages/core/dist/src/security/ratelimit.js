// src/security/ratelimit.ts
// Sliding-window rate limiter using BigInt nanosecond timestamps.
// Bounded per-key request log with periodic stale-entry sweeping.
import { StreetException } from '../http/exceptions.js';
const MAX_KEYS = 100_000; // max distinct IPs/keys tracked
const MAX_REQUESTS_PER_KEY = 1000; // max stored timestamps per key
// Regex for a valid IPv4 or IPv6 address segment
const VALID_IP_RE = /^[\w.:[\]]+$/;
export class RateLimiter {
    // Map: key -> array of nanosecond timestamps (bounded)
    store = new Map();
    opts;
    sweepTimer;
    constructor(opts) {
        const resolvedKeyFn = opts.keyFn ?? ((ctx) => defaultKeyFn(ctx, opts.trustProxy ?? false));
        this.opts = {
            message: 'Too Many Requests',
            trustProxy: false,
            ...opts,
            keyFn: resolvedKeyFn,
        };
        // Sweep stale keys every half-window
        const sweepInterval = Math.max(opts.windowMs / 2, 5_000);
        this.sweepTimer = setInterval(() => this._sweep(), sweepInterval);
        this.sweepTimer.unref();
    }
    middleware() {
        return async (ctx, next) => {
            const key = this.opts.keyFn(ctx);
            const allowed = this._check(key);
            if (!allowed) {
                throw new RateLimitException(this.opts.message);
            }
            ctx.setHeader('X-RateLimit-Limit', String(this.opts.maxRequests));
            const remaining = this._remaining(key);
            ctx.setHeader('X-RateLimit-Remaining', String(remaining));
            await next();
        };
    }
    _check(key) {
        const nowNs = process.hrtime.bigint();
        const windowNs = BigInt(this.opts.windowMs) * 1000000n;
        const cutoff = nowNs - windowNs;
        let timestamps = this.store.get(key);
        if (!timestamps) {
            if (this.store.size >= MAX_KEYS) {
                // Evict oldest key when at capacity
                const firstKey = this.store.keys().next().value;
                if (firstKey !== undefined)
                    this.store.delete(firstKey);
            }
            timestamps = [];
            this.store.set(key, timestamps);
        }
        // Remove expired entries
        let start = 0;
        while (start < timestamps.length && timestamps[start] < cutoff)
            start++;
        if (start > 0)
            timestamps.splice(0, start);
        if (timestamps.length >= this.opts.maxRequests)
            return false;
        // Enforce bounded per-key storage
        if (timestamps.length >= MAX_REQUESTS_PER_KEY)
            return false;
        timestamps.push(nowNs);
        return true;
    }
    _remaining(key) {
        const nowNs = process.hrtime.bigint();
        const windowNs = BigInt(this.opts.windowMs) * 1000000n;
        const cutoff = nowNs - windowNs;
        const timestamps = this.store.get(key) ?? [];
        const active = timestamps.filter((t) => t >= cutoff).length;
        return Math.max(0, this.opts.maxRequests - active);
    }
    _sweep() {
        const nowNs = process.hrtime.bigint();
        const windowNs = BigInt(this.opts.windowMs) * 1000000n;
        const cutoff = nowNs - windowNs;
        for (const [key, timestamps] of this.store.entries()) {
            const filtered = timestamps.filter((t) => t >= cutoff);
            if (filtered.length === 0) {
                this.store.delete(key);
            }
            else {
                this.store.set(key, filtered);
            }
        }
    }
    destroy() {
        clearInterval(this.sweepTimer);
        this.store.clear();
    }
}
function defaultKeyFn(ctx, trustProxy) {
    // When trustProxy is false (default), always use the direct socket address.
    // It is set by the OS/kernel and cannot be forged by the HTTP client.
    if (!trustProxy) {
        return ctx.req.socket.remoteAddress ?? 'unknown';
    }
    // trustProxy=true: take the RIGHTMOST IP added by the trusted proxy.
    // The leftmost entries in X-Forwarded-For are client-supplied and can be
    // forged; the rightmost entry is appended by the proxy we trust.
    const forwarded = ctx.headers['x-forwarded-for'];
    if (forwarded) {
        const parts = forwarded.split(',');
        // Walk right-to-left to find the first valid-looking IP
        for (let i = parts.length - 1; i >= 0; i--) {
            const candidate = parts[i]?.trim() ?? '';
            if (candidate && VALID_IP_RE.test(candidate)) {
                return candidate;
            }
        }
    }
    return ctx.req.socket.remoteAddress ?? 'unknown';
}
export class RateLimitException extends StreetException {
    constructor(message) {
        super(429, message);
        this.name = 'RateLimitException';
    }
}
//# sourceMappingURL=ratelimit.js.map