/**
 * @streetjs/gateway — pure route matcher.
 *
 * A dependency-light, side-effect-free router. Given a fixed table of
 * {@link RouteConfig}s it resolves the best {@link RouteMatch} for a request
 * path (and optional method). Matching is total: it never throws and returns
 * `null` when nothing matches, leaving it to the caller to raise
 * {@link RouteNotFoundError}.
 *
 * Match kinds:
 * - `static`   — exact path equality.
 * - `prefix`   — `/users` matches `/users` and `/users/<anything>`.
 * - `wildcard` — `/users/*` matches `/users/<rest>` (trailing `*` captures the
 *                remaining tail); an interior `*` segment captures exactly one
 *                path segment.
 * - `regex`    — the pattern is a regex source, anchored to the full path; its
 *                capture groups become positional `params`.
 *
 * When `kind` is omitted it is inferred: a pattern ending in `/*` is `wildcard`,
 * otherwise `static`.
 *
 * Selection among multiple matches is deterministic: highest `priority` wins
 * (default 0); ties break toward the most specific route (longer literal
 * prefix), and remaining ties break by declaration order.
 */

import type { RouteConfig, RouteMatch, RouteMatchKind } from "./types.js";

/** Characters that begin a non-literal construct in a regex source. */
const REGEX_META = new Set([
  "\\", "^", "$", ".", "|", "?", "*", "+", "(", ")", "[", "]", "{", "}",
]);

/** Resolve a route's effective match kind, applying the inference rule. */
export function resolveKind(route: RouteConfig): RouteMatchKind {
  if (route.kind) return route.kind;
  return route.pattern.endsWith("/*") ? "wildcard" : "static";
}

/** Strip a query string (everything from the first `?`) from a path. */
function stripQuery(path: string): string {
  const q = path.indexOf("?");
  return q === -1 ? path : path.slice(0, q);
}

/**
 * The literal-prefix length used as the specificity tie-breaker. Longer means
 * more specific. For fully literal kinds this is the whole pattern; for
 * wildcard/regex it is the leading run of literal characters.
 */
export function specificity(route: RouteConfig): number {
  const kind = resolveKind(route);
  switch (kind) {
    case "static":
    case "prefix":
      return route.pattern.length;
    case "wildcard": {
      const star = route.pattern.indexOf("*");
      return star === -1 ? route.pattern.length : star;
    }
    case "regex": {
      let i = 0;
      while (i < route.pattern.length && !REGEX_META.has(route.pattern[i]!)) i++;
      return i;
    }
  }
}

/** Match a wildcard pattern, returning captured segments or `null`. */
function matchWildcard(pattern: string, path: string): string[] | null {
  const pSegs = pattern.split("/");
  const uSegs = path.split("/");
  const params: string[] = [];
  let ui = 0;
  for (let pi = 0; pi < pSegs.length; pi++) {
    const seg = pSegs[pi]!;
    const isLast = pi === pSegs.length - 1;
    if (seg === "*") {
      if (isLast) {
        // Trailing wildcard captures the entire remaining tail.
        if (ui >= uSegs.length) return null;
        params.push(uSegs.slice(ui).join("/"));
        ui = uSegs.length;
      } else {
        // Interior wildcard captures exactly one segment.
        if (ui >= uSegs.length) return null;
        params.push(uSegs[ui]!);
        ui++;
      }
    } else {
      if (ui >= uSegs.length || uSegs[ui] !== seg) return null;
      ui++;
    }
  }
  return ui === uSegs.length ? params : null;
}

/** Whether a route's method filter admits the given (optional) method. */
function methodAllows(route: RouteConfig, method: string | undefined): boolean {
  if (!route.methods || route.methods.length === 0) return true;
  if (method === undefined) return true; // no method supplied → path-only match
  const upper = method.toUpperCase();
  return route.methods.some((m) => m.toUpperCase() === upper);
}

/** A pure, precompiled route matcher over a fixed route table. */
export class Router {
  private readonly routes: readonly RouteConfig[];
  /** Precompiled anchored regexes for `regex` routes, keyed by array index. */
  private readonly compiled: ReadonlyArray<RegExp | null>;

  constructor(routes: readonly RouteConfig[]) {
    this.routes = routes.slice();
    this.compiled = this.routes.map((route) =>
      resolveKind(route) === "regex" ? new RegExp(`^(?:${route.pattern})$`) : null,
    );
  }

  /**
   * Resolve the best matching route for `path` (query string ignored) and an
   * optional `method`. Returns `null` when nothing matches; never throws.
   */
  match(path: string, method?: string): RouteMatch | null {
    const cleanPath = stripQuery(path);
    let best: RouteConfig | null = null;
    let bestParams: readonly string[] | null = null;
    let bestPriority = 0;
    let bestSpecificity = -1;

    for (let i = 0; i < this.routes.length; i++) {
      const route = this.routes[i]!;
      if (!methodAllows(route, method)) continue;

      const params = this.tryMatch(route, i, cleanPath);
      if (params === null) continue;

      const priority = route.priority ?? 0;
      const spec = specificity(route);
      if (
        best === null ||
        priority > bestPriority ||
        (priority === bestPriority && spec > bestSpecificity)
      ) {
        best = route;
        bestParams = params;
        bestPriority = priority;
        bestSpecificity = spec;
      }
    }

    return best === null ? null : { route: best, params: bestParams! };
  }

  /** Attempt to match a single route, returning captured params or `null`. */
  private tryMatch(route: RouteConfig, index: number, path: string): readonly string[] | null {
    const kind = resolveKind(route);
    switch (kind) {
      case "static":
        return path === route.pattern ? [] : null;
      case "prefix": {
        if (path === route.pattern) return [];
        const withSlash = route.pattern.endsWith("/") ? route.pattern : route.pattern + "/";
        return path.startsWith(withSlash) ? [] : null;
      }
      case "wildcard":
        return matchWildcard(route.pattern, path);
      case "regex": {
        const re = this.compiled[index]!;
        const m = re.exec(path);
        if (m === null) return null;
        return m.slice(1).map((g) => g ?? "");
      }
    }
  }
}

/** Factory returning a {@link Router} over the given route table. */
export function createRouter(routes: readonly RouteConfig[]): Router {
  return new Router(routes);
}
