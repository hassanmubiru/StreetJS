// src/versioning/strategy.ts
// API versioning decorators and middleware factory for the Street framework.
// Supports URL-prefix strategy (e.g. /v1/users → /users) and
// header-based strategy (e.g. Accept-Version: v1).

import 'reflect-metadata';
import type { StreetApp } from '../http/server.js';
import type { MiddlewareFn } from '../core/types.js';

const API_VERSION_KEY = 'street:apiVersion';
const DEPRECATED_KEY  = 'street:deprecated';

// ─── @ApiVersion ─────────────────────────────────────────────────────────────

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
export function ApiVersion(version: string): ClassDecorator {
  return (target: object): void => {
    Reflect.defineMetadata(API_VERSION_KEY, version, target);
  };
}

/** Retrieve the API version stored by @ApiVersion, or undefined. */
export function getApiVersion(target: object): string | undefined {
  return Reflect.getMetadata(API_VERSION_KEY, target) as string | undefined;
}

// ─── @Deprecated ─────────────────────────────────────────────────────────────

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
export function Deprecated(opts: DeprecatedOptions = {}): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    // Store metadata for introspection
    Reflect.defineMetadata(DEPRECATED_KEY, opts, target, propertyKey);

    const original = descriptor.value as ((...args: unknown[]) => unknown) | undefined;
    if (typeof original !== 'function') return descriptor;

    descriptor.value = async function deprecatedWrapper(...args: unknown[]): Promise<unknown> {
      // args[0] is the StreetContext when called by the router
      const ctx = args[0] as { setHeader?: (name: string, value: string) => void } | undefined;
      if (ctx && typeof ctx.setHeader === 'function') {
        ctx.setHeader('Deprecation', 'true');
        if (opts.sunset) {
          ctx.setHeader('Sunset', opts.sunset.toUTCString());
        }
      }
      return original.apply(this, args);
    };

    return descriptor;
  };
}

/** Retrieve the DeprecatedOptions stored by @Deprecated, or undefined. */
export function getDeprecatedMeta(target: object, propertyKey: string | symbol): DeprecatedOptions | undefined {
  return Reflect.getMetadata(DEPRECATED_KEY, target, propertyKey) as DeprecatedOptions | undefined;
}

// ─── enableVersioning ─────────────────────────────────────────────────────────

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
export function enableVersioning(app: StreetApp, opts: VersioningOptions): void {
  const mw: MiddlewareFn = async (ctx, next) => {
    if (opts.strategy === 'url') {
      // Match /v1, /v2, /v10, … at the start of the path
      const versionPrefixRe = /^\/v\d+/i;
      const match = versionPrefixRe.exec(ctx.path);
      if (match) {
        const version = match[0]; // e.g. "/v1"
        const stripped = ctx.path.slice(version.length) || '/';
        // Store metadata on the context for observability
        (ctx as unknown as Record<string, unknown>)['originalPath'] = ctx.path;
        (ctx as unknown as Record<string, unknown>)['apiVersion'] = version.replace('/', '');
        // Rewrite path so the router matches the unversioned route
        (ctx as unknown as Record<string, unknown>)['path'] = stripped;
      }
    } else {
      // header strategy
      const hName = (opts.headerName ?? 'Accept-Version').toLowerCase();
      const version = ctx.headers[hName];
      if (version) {
        (ctx as unknown as Record<string, unknown>)['apiVersion'] = version;
      }
    }
    await next();
  };

  app.use(mw);
}

// ─── Version-aware 404 + per-version OpenAPI ──────────────────────────────────

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
export function versionGuard(app: VersionAwareApp, knownVersions: string[]): void {
  const known = new Set(knownVersions.map((v) => v.toLowerCase()));
  app.use(async (ctx, next) => {
    const m = /^\/(v\d+)(?:\/|$)/i.exec(ctx.path);
    if (m && !known.has(m[1]!.toLowerCase())) {
      ctx.json({ error: 'version_not_found', available: knownVersions }, 404);
      return;
    }
    await next();
  });
}

/**
 * Filter a full OpenAPI document down to the paths belonging to a single
 * version prefix (e.g. `v1` keeps only `/v1/...` paths).
 */
export function filterOpenApiByVersion(spec: object, version: string): object {
  const prefix = `/${version.replace(/^\//, '')}/`;
  const s = spec as { paths?: Record<string, unknown> };
  const filtered: Record<string, unknown> = {};
  for (const [path, item] of Object.entries(s.paths ?? {})) {
    if (path.startsWith(prefix) || path === `/${version}`) filtered[path] = item;
  }
  return { ...s, paths: filtered };
}

/**
 * Register `GET /<version>/openapi.json` for each version, serving a spec
 * filtered to that version's routes. `specFn` returns the full OpenAPI doc.
 */
export function registerVersionedOpenApi(
  app: VersionAwareApp,
  versions: string[],
  specFn: () => object,
): void {
  app.use(async (ctx, next) => {
    if (ctx.method === 'GET') {
      for (const version of versions) {
        if (ctx.path === `/${version}/openapi.json`) {
          ctx.json(filterOpenApiByVersion(specFn(), version));
          return;
        }
      }
    }
    await next();
  });
}
