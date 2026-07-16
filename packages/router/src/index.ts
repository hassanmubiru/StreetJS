/**
 * @streetjs/router — the StreetJS HTTP router.
 *
 * A compiled-regex router with path-parameter extraction and a recursive
 * middleware pipeline. Routes bake `@Roles`/`@Permissions` RBAC requirements and
 * `@RateLimit` limiters at registration time, apply optional request validation,
 * and can be latency-profiled. Ships `notFoundHandler` and a leak-safe
 * `errorHandler`. Public API only.
 *
 * ```ts
 * import { Router } from '@streetjs/router';
 *
 * const router = new Router();
 * router.add('GET', '/users/:id', [], (ctx) => ctx.json({ id: ctx.params.id }));
 * await router.dispatch(ctx); // true if a route matched
 * ```
 *
 * > This is the standalone home of the router that also backs the
 * > `streetjs/router` subpath; the `streetjs` framework re-exports it, so there
 * > is a single implementation.
 */

export { Router, notFoundHandler, errorHandler } from './router.js';
export type { RouterOptions } from './router.js';
export type { ValidationSchema, FieldRule, RouteProfiler } from './types.js';
