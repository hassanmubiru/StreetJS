// @streetjs/plugin-africastalking — shared types, config validation, base-URL
// resolution, and a secret-safe HTTP executor (timeout + bounded retry). Pure,
// dependency-free (Node native fetch). No credential is ever logged or thrown.

/** Plugin configuration. */
export interface AfricaTalkingConfig {
  /** Africa's Talking API key (kept out of all logs/errors). */
  apiKey: string;
  /** Africa's Talking username (use "sandbox" for the sandbox). */
  username: string;
  /** Use the sandbox environment when true (default false → production). */
  sandbox?: boolean;
  /** Per-request timeout in ms (default 15000). */
  timeoutMs?: number;
  /** Retry attempts for transient failures (429/5xx/network). Default 2. */
  retries?: number;
  /** Injectable fetch (defaults to global fetch) — for tests. */
  fetch?: FetchLike;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A built, executable HTTP request (pure — produced offline, executed later). */
export interface AtHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  /** URL-encoded form body (messaging/airtime/voice) or JSON string (payments). */
  body?: string;
}

/** Error thrown for non-2xx responses or transport failures. Never carries secrets. */
export class AfricaTalkingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Parsed response body when available (already provider-sourced, no secrets). */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'AfricaTalkingError';
  }
}

interface ResolvedConfig extends Required<Omit<AfricaTalkingConfig, 'fetch'>> {
  fetch?: FetchLike;
}

/** Validate config defensively: required strings, sane optionals. Throws on bad input. */
export function validateAfricaTalkingConfig(input: unknown): AfricaTalkingConfig {
  const o = (input ?? {}) as Record<string, unknown>;
  if (typeof o['apiKey'] !== 'string' || o['apiKey'].trim() === '') {
    throw new AfricaTalkingError('africastalking config: "apiKey" must be a non-empty string');
  }
  if (typeof o['username'] !== 'string' || o['username'].trim() === '') {
    throw new AfricaTalkingError('africastalking config: "username" must be a non-empty string');
  }
  if (o['sandbox'] !== undefined && typeof o['sandbox'] !== 'boolean') {
    throw new AfricaTalkingError('africastalking config: "sandbox" must be a boolean');
  }
  if (o['timeoutMs'] !== undefined && (typeof o['timeoutMs'] !== 'number' || o['timeoutMs'] <= 0)) {
    throw new AfricaTalkingError('africastalking config: "timeoutMs" must be a positive number');
  }
  if (o['retries'] !== undefined && (typeof o['retries'] !== 'number' || o['retries'] < 0)) {
    throw new AfricaTalkingError('africastalking config: "retries" must be a non-negative number');
  }
  if (o['fetch'] !== undefined && typeof o['fetch'] !== 'function') {
    throw new AfricaTalkingError('africastalking config: "fetch" must be a function');
  }
  return {
    apiKey: o['apiKey'],
    username: o['username'],
    ...(o['sandbox'] !== undefined ? { sandbox: o['sandbox'] as boolean } : {}),
    ...(o['timeoutMs'] !== undefined ? { timeoutMs: o['timeoutMs'] as number } : {}),
    ...(o['retries'] !== undefined ? { retries: o['retries'] as number } : {}),
    ...(o['fetch'] !== undefined ? { fetch: o['fetch'] as FetchLike } : {}),
  };
}

/** Fill defaults for internal use. */
export function resolveConfig(config: AfricaTalkingConfig): ResolvedConfig {
  return {
    apiKey: config.apiKey,
    username: config.username,
    sandbox: config.sandbox ?? false,
    timeoutMs: config.timeoutMs ?? 15_000,
    retries: config.retries ?? 2,
    ...(config.fetch ? { fetch: config.fetch } : {}),
  };
}

/** Africa's Talking host group (each product family lives on its own host). */
export type AtHost = 'api' | 'voice' | 'payments';

/** Resolve the base URL for a host family + environment. */
export function baseUrl(host: AtHost, sandbox: boolean): string {
  const env = sandbox ? 'sandbox.' : '';
  switch (host) {
    case 'api':      return `https://api.${env}africastalking.com/version1`;
    case 'voice':    return `https://voice.${env}africastalking.com`;
    case 'payments': return `https://payments.${env}africastalking.com`;
  }
}

/** Standard headers. `apiKey` is sent as a header per AT spec — never logged. */
export function headers(apiKey: string, contentType: string): Record<string, string> {
  return {
    apiKey,
    Accept: 'application/json',
    'Content-Type': contentType,
  };
}

/** Encode an object as application/x-www-form-urlencoded, skipping undefined. */
export function form(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.append(k, String(v));
  }
  return qs.toString();
}

const isTransient = (status: number): boolean => status === 429 || (status >= 500 && status <= 599);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Execute a built request with a hard timeout and bounded retry on transient
 * failures. Secret-safe: the api key (a header) is never included in any thrown
 * message. Returns the parsed JSON (or text) body.
 */
export async function execute<T = unknown>(req: AtHttpRequest, config: AfricaTalkingConfig): Promise<T> {
  const cfg = resolveConfig(config);
  const doFetch: FetchLike = cfg.fetch ?? (globalThis.fetch as FetchLike | undefined) ?? (() => {
    throw new AfricaTalkingError('No fetch implementation: provide `fetch` in config or run on Node ≥ 18.');
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const init: RequestInit = { method: req.method, headers: req.headers, signal: controller.signal };
      if (req.body !== undefined) init.body = req.body;
      const res = await doFetch(req.url, init);
      const ct = res.headers.get('content-type') ?? '';
      const parsed: unknown = ct.includes('application/json') ? await res.json() : await res.text();
      if (!res.ok) {
        if (isTransient(res.status) && attempt < cfg.retries) {
          lastErr = new AfricaTalkingError(`Africa's Talking request failed (${res.status})`, res.status, parsed);
          await sleep(2 ** attempt * 200);
          continue;
        }
        throw new AfricaTalkingError(`Africa's Talking request failed (${res.status})`, res.status, parsed);
      }
      return parsed as T;
    } catch (err) {
      // AbortError / network errors are transient — retry within budget.
      if (err instanceof AfricaTalkingError && err.status !== undefined && !isTransient(err.status)) throw err;
      lastErr = err;
      if (attempt < cfg.retries) { await sleep(2 ** attempt * 200); continue; }
    } finally {
      clearTimeout(timer);
    }
  }
  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new AfricaTalkingError(`Africa's Talking request failed after retries: ${reason}`);
}
