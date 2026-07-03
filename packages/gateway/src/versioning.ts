/**
 * @streetjs/gateway — pure API version resolver.
 *
 * Given a {@link VersioningPolicy} and an incoming {@link GatewayRequest}, this
 * module resolves the effective API version. It consults an ordered list of
 * {@link VersionSource}s (path segment, `x-version` header, `accept-version`
 * header); the first source that yields a version *known* to the policy wins.
 *
 * Resolution is total and side-effect free:
 * - A supplied-but-unknown version at one source falls through to the next.
 * - When no source yields a known version, the policy `default` is returned
 *   with source `"default"`.
 *
 * When (and only when) the winning source is `"path"`, the leading version
 * segment is stripped from the returned `strippedPath` (`/v1/users` → `/users`,
 * `/v1` → `/`). For every other outcome `strippedPath` equals the original
 * request path. Any query string on the path is preserved verbatim.
 */

import type { GatewayRequest, Headers, VersioningPolicy, VersionSource } from "./types.js";

/** The default source order when a policy does not specify one. */
const DEFAULT_SOURCES: readonly VersionSource[] = ["path", "x-version", "accept-version"];

/** Matches a leading version segment such as `/v1` or `/v2` (optionally more). */
const PATH_VERSION = /^\/(v\d+)(?:\/|$)/;

/** The result of resolving an API version for a request. */
export interface ResolvedVersion {
  /** The resolved version string (always a known version, or the policy default). */
  readonly version: string;
  /** Which source produced the version, or `"default"` when none matched. */
  readonly source: VersionSource | "default";
  /** The request path with a matched leading version segment removed (path source only). */
  readonly strippedPath: string;
}

/** Read a single header value, taking the first entry when a list is present. */
function headerValue(headers: Headers, name: string): string | undefined {
  const raw = headers[name];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Resolve the effective API version for `req` under `policy`.
 *
 * Pure: depends only on its arguments and never mutates them.
 */
export function resolveVersion(policy: VersioningPolicy, req: GatewayRequest): ResolvedVersion {
  const sources = policy.sources ?? DEFAULT_SOURCES;
  const known = (v: string | undefined): v is string =>
    v !== undefined && policy.versions.includes(v);

  // Split the query string off so we operate on the path but keep the query intact.
  const rawPath = req.path;
  const qIdx = rawPath.indexOf("?");
  const pathname = qIdx === -1 ? rawPath : rawPath.slice(0, qIdx);
  const query = qIdx === -1 ? "" : rawPath.slice(qIdx);

  const pathMatch = PATH_VERSION.exec(pathname);
  const pathCandidate = pathMatch ? pathMatch[1] : undefined;

  for (const source of sources) {
    switch (source) {
      case "path": {
        if (known(pathCandidate)) {
          // Remove the leading `/vN` segment; an empty remainder becomes `/`.
          const rest = pathname.slice(1 + pathCandidate.length);
          const stripped = rest === "" ? "/" : rest;
          return { version: pathCandidate, source: "path", strippedPath: stripped + query };
        }
        break;
      }
      case "x-version": {
        const value = headerValue(req.headers, "x-version");
        if (known(value)) {
          return { version: value, source: "x-version", strippedPath: rawPath };
        }
        break;
      }
      case "accept-version": {
        const value = headerValue(req.headers, "accept-version");
        if (known(value)) {
          return { version: value, source: "accept-version", strippedPath: rawPath };
        }
        break;
      }
    }
  }

  return { version: policy.default, source: "default", strippedPath: rawPath };
}
