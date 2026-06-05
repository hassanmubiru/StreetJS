import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';
import { StreetException } from '../http/exceptions.js';
export interface RateLimiterOptions {
    windowMs: number;
    maxRequests: number;
    keyFn?: (ctx: StreetContext) => string;
    message?: string;
    /**
     * Set to true ONLY when the server sits behind a trusted reverse proxy
     * that sets X-Forwarded-For. When false (default), the direct socket
     * address is always used — it cannot be spoofed by the client.
     */
    trustProxy?: boolean;
}
export declare class RateLimiter {
    private readonly store;
    private readonly opts;
    private readonly sweepTimer;
    constructor(opts: RateLimiterOptions);
    middleware(): MiddlewareFn;
    private _check;
    private _remaining;
    private _sweep;
    destroy(): void;
}
export declare class RateLimitException extends StreetException {
    constructor(message: string);
}
export interface RateLimitDecoratorOptions {
    /** Maximum number of requests allowed within the window. */
    requests: number;
    /** Window duration in milliseconds. */
    window: number;
    /**
     * Optional key name used to differentiate rate-limit buckets.
     * When omitted, the router middleware defaults to the remote IP.
     */
    key?: string;
}
/**
 * Method decorator that attaches rate-limit configuration metadata to a route
 * handler.  The actual enforcement is performed by the router middleware
 * pipeline which reads the `street:rateLimit` metadata key at dispatch time.
 *
 * @example
 * ```ts
 * @RateLimit({ requests: 100, window: 60_000 })
 * @Post('/login')
 * async login(ctx: StreetContext) { ... }
 * ```
 */
export declare function RateLimit(opts: RateLimitDecoratorOptions): MethodDecorator;
/** Retrieve the RateLimitDecoratorOptions stored by @RateLimit, or undefined. */
export declare function getRateLimitMeta(target: object, propertyKey: string | symbol): RateLimitDecoratorOptions | undefined;
//# sourceMappingURL=ratelimit.d.ts.map