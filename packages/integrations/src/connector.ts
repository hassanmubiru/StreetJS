// src/connector.ts
// HttpConnector: the shared base for vendor API clients.

import { IntegrationError, IntegrationRequestError } from './errors.js';
import type { AuthStrategy, ConnectorOptions, FetchLike, RequestOptions } from './types.js';

function resolveFetch(f: FetchLike | undefined): FetchLike {
  if (f) return f;
  const g = (globalThis as { fetch?: unknown }).fetch;
  if (typeof g !== 'function') throw new IntegrationError('No fetch available; pass options.fetch');
  return g as FetchLike;
}

function applyAuth(headers: Record<string, string>, auth: AuthStrategy): void {
  if (auth.type === 'bearer') headers['authorization'] = `Bearer ${auth.token}`;
  else if (auth.type === 'header') headers[auth.name.toLowerCase()] = auth.value;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const base = baseUrl.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  let url = `${base}${rel}`;
  if (query) {
    const params: string[] = [];
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      params.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    if (params.length) url += `${url.includes('?') ? '&' : '?'}${params.join('&')}`;
  }
  return url;
}

const RETRIABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Base HTTP client for vendor connectors: injectable fetch, auth application,
 * query building, JSON (de)serialization, normalized errors, and idempotent
 * retry with backoff on network errors / 429 / 5xx. Vendor connectors extend
 * this and expose typed methods that call `request<T>()`.
 */
export class HttpConnector {
  protected readonly baseUrl: string;
  protected readonly auth: AuthStrategy;
  protected readonly fetch: FetchLike;
  protected readonly defaultHeaders: Record<string, string>;
  protected readonly retries: number;
  protected readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ConnectorOptions) {
    if (!options?.baseUrl) throw new IntegrationError('HttpConnector: baseUrl is required');
    this.baseUrl = options.baseUrl;
    this.auth = options.auth ?? { type: 'none' };
    this.fetch = resolveFetch(options.fetch);
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.retries = options.retries ?? 2;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Perform a request and parse a JSON response body into `T`. */
  async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = (options.method ?? 'GET').toUpperCase();
    const url = buildUrl(this.baseUrl, path, options.query);

    const headers: Record<string, string> = { accept: 'application/json', ...this.defaultHeaders };
    applyAuth(headers, this.auth);
    let body: string | undefined;
    if (options.body !== undefined) {
      body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      if (typeof options.body !== 'string') headers['content-type'] = 'application/json';
    }
    Object.assign(headers, options.headers ?? {});

    const idempotent = method === 'GET' || method === 'HEAD';
    const maxAttempts = idempotent ? this.retries + 1 : 1;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res;
      try {
        const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
        if (body !== undefined) init.body = body;
        res = await this.fetch(url, init);
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) { await this.sleep(backoff(attempt)); continue; }
        throw new IntegrationError(`request to ${url} failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (!res.ok) {
        const text = await safeText(res);
        if (idempotent && RETRIABLE.has(res.status) && attempt < maxAttempts) {
          await this.sleep(backoff(attempt));
          continue;
        }
        throw new IntegrationRequestError(`${method} ${url} → ${res.status}`, res.status, text.slice(0, 1000));
      }

      const text = await safeText(res);
      return parseJson<T>(text);
    }
    // Unreachable in practice; satisfies the type checker.
    throw new IntegrationError(`request to ${url} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try { return await res.text(); } catch { return ''; }
}

function parseJson<T>(text: string): T {
  if (text.length === 0) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Non-JSON success bodies are returned as-is (typed loosely).
    return text as unknown as T;
  }
}
