import 'reflect-metadata';
import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn, ValidationSchema } from '../core/types.js';
import type { RouteProfiler } from '../diagnostics/route-profiler.js';
export interface RouterOptions {
    profiler?: RouteProfiler;
}
export declare class Router {
    private readonly routes;
    private readonly _profiler;
    constructor(opts?: RouterOptions);
    /** Compile and register a route */
    add(method: string, path: string, middlewares: MiddlewareFn[], handler: (ctx: StreetContext) => Promise<void> | void, validate?: ValidationSchema, 
    /** Optional: controller prototype — used to read @Roles/@Permissions decorator metadata */
    handlerTarget?: object, 
    /** Optional: method name on handlerTarget — used to read @Roles/@Permissions decorator metadata */
    handlerMethodName?: string): void;
    /** Match a request and execute the middleware pipeline */
    dispatch(ctx: StreetContext): Promise<boolean>;
    private match;
    /** List all registered routes (for OpenAPI) */
    listRoutes(): Array<{
        method: string;
        path: string;
    }>;
}
/** Not-found handler */
export declare function notFoundHandler(ctx: StreetContext): Promise<void>;
/** Global error handler */
export declare function errorHandler(ctx: StreetContext, err: unknown): Promise<void>;
//# sourceMappingURL=router.d.ts.map