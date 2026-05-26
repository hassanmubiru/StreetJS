// src/security/ratelimit.ts
// Sliding-window rate limiter using BigInt nanosecond timestamps.
// Bounded per-key request log with periodic stale-entry sweeping.
import { StreetException } from '../http/exceptions.js';
const MAX_KEYS = 100_000; // max distinct IPs/keys tracked
const MAX_REQUESTS_PER_KEY = 1000; // max stored timestamps per key
export class RateLimiter {
    // Map: key -> array of nanosecond timestamps (bounded)
    store = new Map();
    opts;
    sweepTimer;
    constructor(opts) {
        this.opts = {
            keyFn: defaultKeyFn,
            message: 'Too Many Requests',
            ...opts,
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
                throw new RateLimitException(this.opts.message, Math.ceil(this.opts.windowMs / 1000));
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
function defaultKeyFn(ctx) {
    const forwarded = ctx.headers['x-forwarded-for'];
    if (forwarded)
        return forwarded.split(',')[0]?.trim() ?? 'unknown';
    return ctx.req.socket.remoteAddress ?? 'unknown';
}
export class RateLimitException extends StreetException {
    constructor(message, retryAfterSeconds) {
        super(429, message);
        this.name = 'RateLimitException';
        // Add retry-after header info in details
        void retryAfterSeconds;
    }
}
//# sourceMappingURL=ratelimit.js.map