import 'reflect-metadata';
import type { StreetApp } from '../http/server.js';
/**
 * Class decorator that tags a controller with an API version string.
 * Metadata is stored under the `street:apiVersion` key so the router
 * and tooling can introspect it.
 *
 * @example
 * ```ts
 * @ApiVersion('v1')
 * @Controller('/users')
 * export class UsersControllerV1 { ... }
 * ```
 */
export declare function ApiVersion(version: string): ClassDecorator;
/** Retrieve the API version stored by @ApiVersion, or undefined. */
export declare function getApiVersion(target: object): string | undefined;
export interface DeprecatedOptions {
    /**
     * RFC 8594 sunset date. When provided, a `Sunset` header is added to
     * every response from the decorated method.
     */
    sunset?: Date;
}
/**
 * Method decorator that marks an endpoint as deprecated.
 * Adds a `Deprecation: true` header (and an optional `Sunset` header) to
 * every response produced by the decorated handler.
 *
 * The decorator wraps the original method's descriptor so that it injects
 * headers automatically — no router-level changes required.
 *
 * @example
 * ```ts
 * @Deprecated({ sunset: new Date('2025-12-31') })
 * @Get('/old-endpoint')
 * async legacyHandler(ctx: StreetContext) { ... }
 * ```
 */
export declare function Deprecated(opts?: DeprecatedOptions): MethodDecorator;
/** Retrieve the DeprecatedOptions stored by @Deprecated, or undefined. */
export declare function getDeprecatedMeta(target: object, propertyKey: string | symbol): DeprecatedOptions | undefined;
export interface VersioningOptions {
    /** Routing strategy. `'url'` strips the version prefix from `ctx.path`. */
    strategy: 'url' | 'header';
    /**
     * For `strategy: 'header'`, the request header that carries the version
     * (e.g. `'Accept-Version'`).  Defaults to `'Accept-Version'`.
     */
    headerName?: string;
}
/**
 * Register a versioning middleware on the Street application.
 *
 * **URL strategy** (`strategy: 'url'`):
 *   Rewrites `ctx.path` by stripping a leading version prefix that matches
 *   `/v<digits>` (e.g. `/v1/users` → `/users`).  The original path is
 *   preserved in `ctx['originalPath']` for logging.
 *
 * **Header strategy** (`strategy: 'header'`):
 *   Reads the version from the request header (default `Accept-Version`)
 *   and stores it as `ctx['apiVersion']` for downstream handlers.
 */
export declare function enableVersioning(app: StreetApp, opts: VersioningOptions): void;
//# sourceMappingURL=strategy.d.ts.map