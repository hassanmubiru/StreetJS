// @streetjs/plugin-htmx
// Official StreetJS plugin: first-class HTMX support for server-rendered apps.
// Self-contained and dependency-free — owns a tiny view engine + HTMX helpers so
// nothing HTMX-specific leaks into the StreetJS core (which stays frontend-agnostic).

export {
  ViewEngine,
  renderTemplate,
  escapeHtml,
  lookup,
} from './view-engine.js';
export type { ViewEngineOptions, PartialResolver } from './view-engine.js';

export {
  isHtmxRequest,
  isHtmxHistoryRestore,
  htmxTriggerId,
  htmxCurrentUrl,
  hxHeaders,
  csrfField,
} from './htmx.js';
export type { HeaderBag, HxResponseInit } from './htmx.js';

import { ViewEngine, type ViewEngineOptions } from './view-engine.js';
import { isHtmxRequest, hxHeaders, type HeaderBag, type HxResponseInit } from './htmx.js';

export const HTMX_PLUGIN_NAME = 'street-plugin-htmx';
export const HTMX_PLUGIN_VERSION = '1.0.0';

/** The (unsigned) plugin manifest. Sign + publish via the standard plugin flow. */
export function htmxPluginManifest(): {
  name: string; version: string; capabilities: string[]; permissions: string[];
} {
  return {
    name: HTMX_PLUGIN_NAME,
    version: HTMX_PLUGIN_VERSION,
    capabilities: ['views', 'htmx', 'html-rendering'],
    permissions: ['middleware'],
  };
}

/**
 * The minimal request/response context shape this plugin augments. Declared
 * structurally so the package builds standalone — at runtime StreetJS's own
 * `ctx` satisfies it (it already provides `headers` and `html(...)`).
 */
export interface HtmxCapableContext {
  headers: HeaderBag;
  html(data: string, status?: number): void;
  setHeader?(name: string, value: string): void;
}

/** The helpers attached to a request context by {@link attachHtmx}. */
export interface HtmxHelpers {
  /** True if this request came from HTMX. */
  readonly isHtmx: boolean;
  /** Render a page; wraps in the layout for full-page loads, returns just the
   *  fragment for HTMX requests (progressive enhancement). Writes the response. */
  view(page: string, data?: Record<string, unknown>, status?: number): void;
  /** Render a named partial (no layout) and write it. */
  partial(name: string, data?: Record<string, unknown>, status?: number): void;
  /** Write a raw HTML fragment. */
  fragment(html: string, status?: number): void;
  /** Set HX-* response headers (HX-Redirect, HX-Trigger, HX-Retarget, …). */
  hx(init: HxResponseInit): HtmxHelpers;
  /** The underlying view engine (for advanced/manual rendering). */
  readonly engine: ViewEngine;
}

export interface HtmxMiddlewareOptions extends ViewEngineOptions {}

/**
 * Attach HTMX view helpers to a context. Full-page requests get the layout;
 * HTMX requests (HX-Request: true) get just the page fragment.
 */
export function attachHtmx(ctx: HtmxCapableContext, engine: ViewEngine): HtmxHelpers {
  const isHtmx = isHtmxRequest(ctx.headers);
  const helpers: HtmxHelpers = {
    isHtmx,
    engine,
    view(page, data = {}, status = 200) {
      ctx.html(engine.view(page, data, { wrap: !isHtmx }), status);
    },
    partial(name, data = {}, status = 200) {
      ctx.html(engine.partial(name, data), status);
    },
    fragment(html, status = 200) {
      ctx.html(engine.fragment(html), status);
    },
    hx(init) {
      const headers = hxHeaders(init);
      if (ctx.setHeader) for (const [k, v] of Object.entries(headers)) ctx.setHeader(k, v);
      return helpers;
    },
  };
  return helpers;
}

/**
 * StreetJS plugin entry. Register with the app; on each request it attaches the
 * HTMX helpers (as `ctx.htmx`) backed by a shared, bounded view engine.
 *
 *   import { HtmxPlugin } from '@streetjs/plugin-htmx';
 *   app.use(HtmxPlugin.middleware({ viewsDir: 'src/views', layout: 'main' }));
 */
export const HtmxPlugin = {
  name: HTMX_PLUGIN_NAME,
  version: HTMX_PLUGIN_VERSION,
  manifest: htmxPluginManifest,
  /** Build a middleware that attaches `ctx.htmx` for every request. */
  middleware(options: HtmxMiddlewareOptions) {
    const engine = new ViewEngine(options);
    return function htmxMiddleware(
      ctx: HtmxCapableContext & { htmx?: HtmxHelpers },
      next: () => unknown,
    ) {
      ctx.htmx = attachHtmx(ctx, engine);
      return next();
    };
  },
};

export default HtmxPlugin;
