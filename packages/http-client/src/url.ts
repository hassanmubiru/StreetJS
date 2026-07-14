/**
 * URL resolution and query-string building.
 *
 * Leaf module — depends only on `types`.
 */

import type { QueryParams } from './types.js';

const ABSOLUTE_URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** True when `path` is already an absolute URL (has a scheme). */
export function isAbsoluteUrl(path: string): boolean {
  return ABSOLUTE_URL_RE.test(path);
}

/**
 * Resolve a request URL from an optional base and a path. Absolute paths ignore
 * the base; relative paths are joined with exactly one `/` between them.
 */
export function resolveUrl(baseUrl: string | undefined, path: string): string {
  if (isAbsoluteUrl(path)) {
    return path;
  }
  if (!baseUrl) {
    return path;
  }
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.replace(/^\/+/, '');
  return suffix ? `${base}/${suffix}` : base;
}

/** Serialize query params to a string (without a leading `?`). Skips null/undefined. */
export function buildQueryString(query: QueryParams): string {
  const parts: string[] = [];
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

/** Append a query object to a URL, preserving any existing query string. */
export function appendQuery(url: string, query: QueryParams | undefined): string {
  if (!query) {
    return url;
  }
  const qs = buildQueryString(query);
  if (!qs) {
    return url;
  }
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}
