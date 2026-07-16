/**
 * @streetjs/context — the StreetJS request/response context.
 *
 * `createContext(req, res, path, query)` builds a strict `StreetContext` over
 * Node's `http` request/response with ergonomic `json`/`text`/`html`/`send`
 * responders, a single-write guard (`sent`), header and secure-by-default
 * cookie handling, and mutable `params`/`body`/`state`/`user`/`files` slots that
 * middleware fills in. `serializeCookie` is the pure `Set-Cookie` builder.
 * Public API only.
 *
 * ```ts
 * import { createContext } from '@streetjs/context';
 *
 * const ctx = createContext(req, res, url.pathname, query);
 * ctx.json({ ok: true });
 * ```
 *
 * > This is the standalone home of the context that also backs the `streetjs`
 * > framework; the framework re-exports it, so there is a single implementation.
 */

export { createContext, serializeCookie } from './context.js';
export type { StreetContext, AuthenticatedUser, CookieOptions, MiddlewareFn } from './context.js';
