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
interface VersionAwareCtx {
    method: string;
    path: string;
    json(data: unknown, status?: number): void;
}
interface VersionAwareApp {
    use(mw: (ctx: VersionAwareCtx, next: () => Promise<void>) => Promise<void>): void;
}
/**
 * Reject requests that target an unknown version prefix (e.g. `/v9/...` when
 * only v1/v2 exist) with HTTP 404 and the list of available versions.
 * Requests whose first segment is not a version prefix pass through untouched.
 */
export declare function versionGuard(app: VersionAwareApp, knownVersions: string[]): void;
/**
 * Filter a full OpenAPI document down to the paths belonging to a single
 * version prefix (e.g. `v1` keeps only `/v1/...` paths).
 */
export declare function filterOpenApiByVersion(spec: object, version: string): object;
/**
 * Register `GET /<version>/openapi.json` for each version, serving a spec
 * filtered to that version's routes. `specFn` returns the full OpenAPI doc.
 */
export declare function registerVersionedOpenApi(app: VersionAwareApp, versions: string[], specFn: () => object): void;
export {};
//# sourceMappingURL=strategy.d.ts.map