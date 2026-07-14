/**
 * Public types for @streetjs/http-client.
 *
 * Interface-first: the underlying `fetch`, the sleep function, and the
 * interceptor hooks are all injectable, so the client is fully testable without
 * network access and wireable through DI.
 */

/** HTTP methods this client issues. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** A single query value; arrays repeat the key. */
export type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

/** Query parameters appended to a request URL. */
export type QueryParams = Record<string, QueryValue>;

/** Plain header map (case is preserved as given; fetch lowercases on the wire). */
export type HeaderMap = Record<string, string>;

/** The `fetch` shape the client depends on (global `fetch` by default). */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Injectable delay (default a real timer); tests pass a no-op for instant retries. */
export type SleepFn = (ms: number) => Promise<void>;

/** Retry behavior. */
export interface RetryPolicy {
  /** Number of *additional* attempts after the first. Default `2`. */
  readonly retries: number;
  /** Methods eligible for retry. Default idempotent methods. */
  readonly methods: readonly HttpMethod[];
  /** Response statuses that trigger a retry. Default `408,429,500,502,503,504`. */
  readonly statuses: readonly number[];
  /** Base backoff in ms (doubled each attempt). Default `100`. */
  readonly baseDelayMs: number;
  /** Maximum backoff in ms. Default `2000`. */
  readonly maxDelayMs: number;
  /** Add random jitter (0..1x of the delay). Default `true`. */
  readonly jitter: boolean;
  /** Honor a `Retry-After` header when present. Default `true`. */
  readonly respectRetryAfter: boolean;
}

/** The fully-resolved request handed to `fetch` and to interceptors. */
export interface HttpRequest {
  method: HttpMethod;
  /** Absolute URL (base + path + query, already resolved). */
  url: string;
  headers: HeaderMap;
  /** Encoded body, or `undefined` for bodyless requests. */
  body?: string | Uint8Array;
}

/** Per-request options. */
export interface RequestOptions {
  readonly headers?: HeaderMap;
  readonly query?: QueryParams;
  /** Body sent as-is (`string`/`Uint8Array`) or JSON-encoded (any other value). */
  readonly body?: unknown;
  /** Force a JSON body (sets `content-type: application/json`). */
  readonly json?: unknown;
  /** Per-request timeout in ms. Overrides the client default. */
  readonly timeoutMs?: number;
  /** Per-request retry overrides. */
  readonly retry?: Partial<RetryPolicy>;
  /** Caller-supplied abort signal, combined with the timeout. */
  readonly signal?: AbortSignal;
  /** Throw on non-2xx responses. Overrides the client default. */
  readonly throwOnError?: boolean;
}

/** Request interceptor: inspect/modify a request before it is sent. */
export type RequestInterceptor = (request: HttpRequest) => HttpRequest | void | Promise<HttpRequest | void>;

/** Response interceptor: inspect/modify a response before it is returned. */
export type ResponseInterceptor = (
  response: HttpResponseView,
  request: HttpRequest,
) => HttpResponseView | void | Promise<HttpResponseView | void>;

/** Read-only view of a buffered HTTP response (see the `HttpResponse` class). */
export interface HttpResponseView {
  readonly status: number;
  readonly statusText: string;
  readonly headers: HeaderMap;
  readonly url: string;
  readonly ok: boolean;
  text(): string;
  json<T = unknown>(): T;
  bytes(): Uint8Array;
}

/** Client construction options. */
export interface ClientOptions {
  /** Prepended to relative request paths. */
  readonly baseUrl?: string;
  /** Default headers merged into every request. */
  readonly headers?: HeaderMap;
  /** Default timeout in ms. Default `30000`. */
  readonly timeoutMs?: number;
  /** Default retry policy overrides. */
  readonly retry?: Partial<RetryPolicy>;
  /** Throw on non-2xx by default. Default `true`. */
  readonly throwOnError?: boolean;
  /** Injectable fetch. Default global `fetch`. */
  readonly fetch?: FetchLike;
  /** Injectable delay. Default a real timer. */
  readonly sleep?: SleepFn;
  /** Request interceptors, run in order. */
  readonly onRequest?: readonly RequestInterceptor[];
  /** Response interceptors, run in order. */
  readonly onResponse?: readonly ResponseInterceptor[];
}
