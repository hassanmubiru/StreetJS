import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';
import { StreetException } from '../http/exceptions.js';
export interface RateLimiterOptions {
    windowMs: number;
    maxRequests: number;
    keyFn?: (ctx: StreetContext) => string;
    message?: string;
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
//# sourceMappingURL=ratelimit.d.ts.map