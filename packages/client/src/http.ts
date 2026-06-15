// packages/client/src/http.ts
// Framework-agnostic HTTP layer over the platform `fetch`. Pure request building
// + response handling so it is fully unit-testable with an injected fetch.

import { StreetApiError, StreetClientError } from './errors.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StreetClientConfig {
  /** Base URL for the API, e.g. "/api" or "https://api.example.com". */
  baseUrl: string;
  /** Override the fetch implementation (defaults to globalThis.fetch). */
  fetch?: FetchLike;
  /** Returns a bearer token to attach as Authorization (sync or async). */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Default headers merged into every request. */
  headers?: Record<string, string>;
  /** fetch credentials mode (e.g. "include" for cookie auth). */
  credentials?: RequestCredentials;
  /** Optional WebSocket implementation for realtime (defaults to globalThis.WebSocket). */
  WebSocket?: unknown;
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  /** Pass a FormData/Blob/stream body verbatim (no JSON serialization). */
  rawBody?: BodyInit;
  signal?: AbortSignal;
}

/**
 * Remove every trailing '/' from a string in linear time (regex-free).
 *
 * Replaces the polynomial-ReDoS-prone `/\/+$/` (CodeQL js/polynomial-redos) with
 * a deterministic O(n) scan: walk back over '/' (charCode 47) and `slice` once.
 * Exported for reuse by other client modules (e.g. realtime URL building).
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}

/** Join a base URL and a path, then append a query string (skipping null/undefined). */
export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const base = trimTrailingSlashes(baseUrl);
  const p = path.startsWith('/') ? path : `/${path}`;
  let url = `${base}${p}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

function resolveFetch(config: StreetClientConfig): FetchLike {
  const f = config.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!f) throw new StreetClientError('No fetch implementation: pass `fetch` in config or run on a platform with global fetch.');
  return f;
}

/** Perform a typed request. Throws {@link StreetApiError} on a non-2xx response. */
export async function request<T = unknown>(
  config: StreetClientConfig,
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const doFetch = resolveFetch(config);
  const url = buildUrl(config.baseUrl, path, opts.query);

  const headers: Record<string, string> = { accept: 'application/json', ...config.headers, ...opts.headers };
  const token = config.getToken ? await config.getToken() : undefined;
  if (token) headers['authorization'] = `Bearer ${token}`;

  const init: RequestInit = { method, headers };
  if (config.credentials) init.credentials = config.credentials;
  if (opts.signal) init.signal = opts.signal;

  if (opts.rawBody !== undefined) {
    init.body = opts.rawBody; // FormData/Blob/stream — let fetch set content-type
  } else if (opts.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  const res = await doFetch(url, init);
  return parseResponse<T>(res);
}

/** Parse a Response: JSON when the content-type says so, else text; throw on non-2xx. */
export async function parseResponse<T>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') ?? '';
  const isJson = ct.includes('application/json');
  let body: unknown;
  try {
    body = isJson ? await res.json() : await res.text();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const msg = (isJson && body && typeof body === 'object' && 'message' in (body as object))
      ? String((body as { message: unknown }).message)
      : `Request failed with status ${res.status}`;
    throw new StreetApiError(res.status, msg, body);
  }
  return body as T;
}
