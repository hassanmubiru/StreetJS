import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn, ValidationSchema } from '../core/types.js';
export declare class Router {
    private readonly routes;
    /** Compile and register a route */
    add(method: string, path: string, middlewares: MiddlewareFn[], handler: (ctx: StreetContext) => Promise<void> | void, validate?: ValidationSchema): void;
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