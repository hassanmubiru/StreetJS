/**
 * The HTTP client.
 *
 * Depends on `types`, `errors`, `url`, `retry`, and `response`.
 */

import type {
  ClientOptions,
  FetchLike,
  HeaderMap,
  HttpMethod,
  HttpRequest,
  RequestInterceptor,
  RequestOptions,
  ResponseInterceptor,
  RetryPolicy,
  SleepFn,
} from './types.js';
import { HttpError } from './errors.js';
import { appendQuery, resolveUrl } from './url.js';
import {
  computeBackoff,
  isRetriableMethod,
  isRetriableStatus,
  parseRetryAfter,
  resolveRetryPolicy,
} from './retry.js';
import { HttpResponse } from './response.js';

const DEFAULT_TIMEOUT_MS = 30_000;

const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hasHeader(headers: HeaderMap, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

export class HttpClient {
  private readonly baseUrl?: string;
  private readonly defaultHeaders: HeaderMap;
  private readonly timeoutMs: number;
  private readonly retryDefaults: Partial<RetryPolicy>;
  private readonly throwOnError: boolean;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: SleepFn;
  private readonly requestInterceptors: readonly RequestInterceptor[];
  private readonly responseInterceptors: readonly ResponseInterceptor[];

  constructor(options: ClientOptions = {}) {
    this.baseUrl = options.baseUrl;
    this.defaultHeaders = { ...(options.headers ?? {}) };
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retryDefaults = options.retry ?? {};
    this.throwOnError = options.throwOnError ?? true;
    const injected = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!injected) {
      throw new Error('No fetch implementation available; pass options.fetch');
    }
    this.fetchImpl = injected;
    this.sleep = options.sleep ?? realSleep;
    this.requestInterceptors = options.onRequest ?? [];
    this.responseInterceptors = options.onResponse ?? [];
  }

  get(path: string, options?: RequestOptions): Promise<HttpResponse> {
    return this.request('GET', path, options);
  }

  delete(path: string, options?: RequestOptions): Promise<HttpResponse> {
    return this.request('DELETE', path, options);
  }

  head(path: string, options?: RequestOptions): Promise<HttpResponse> {
    return this.request('HEAD', path, options);
  }

  options(path: string, options?: RequestOptions): Promise<HttpResponse> {
    return this.request('OPTIONS', path, options);
  }

  post(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResponse> {
    return this.request('POST', path, { ...options, body });
  }

  put(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResponse> {
    return this.request('PUT', path, { ...options, body });
  }

  patch(path: string, body?: unknown, options?: RequestOptions): Promise<HttpResponse> {
    return this.request('PATCH', path, { ...options, body });
  }

  /** Issue a request with full control. */
  async request(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<HttpResponse> {
    const request = await this.buildRequest(method, path, options);
    const policy = resolveRetryPolicy({ ...this.retryDefaults, ...(options.retry ?? {}) });
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const throwOnError = options.throwOnError ?? this.throwOnError;

    let attempt = 0;
    for (;;) {
      const result = await this.attempt(request, timeoutMs, options.signal);

      if (result.kind === 'response') {
        let response = result.response;
        for (const interceptor of this.responseInterceptors) {
          const replaced = await interceptor(response, request);
          if (replaced) {
            response = replaced as HttpResponse;
          }
        }
        const retriable =
          !response.ok &&
          isRetriableStatus(response.status, policy) &&
          isRetriableMethod(request.method, policy) &&
          attempt < policy.retries;
        if (retriable) {
          await this.sleep(this.retryDelay(attempt, policy, response.headers['retry-after']));
          attempt++;
          continue;
        }
        if (!response.ok && throwOnError) {
          throw new HttpError(
            'status',
            `HTTP ${response.status} ${response.statusText} for ${request.method} ${request.url}`,
            request,
            response,
          );
        }
        return response;
      }

      // A transport failure (network/timeout/aborted).
      const retriableFailure =
        result.kind !== 'aborted' &&
        isRetriableMethod(request.method, policy) &&
        attempt < policy.retries;
      if (retriableFailure) {
        await this.sleep(computeBackoff(attempt, policy));
        attempt++;
        continue;
      }
      throw new HttpError(result.kind, result.message, request, undefined, result.cause);
    }
  }

  private async buildRequest(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
  ): Promise<HttpRequest> {
    const url = appendQuery(resolveUrl(this.baseUrl, path), options.query);
    const headers: HeaderMap = { ...this.defaultHeaders, ...(options.headers ?? {}) };

    let body: string | Uint8Array | undefined;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      if (!hasHeader(headers, 'content-type')) {
        headers['content-type'] = 'application/json';
      }
    } else if (typeof options.body === 'string' || options.body instanceof Uint8Array) {
      body = options.body;
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      if (!hasHeader(headers, 'content-type')) {
        headers['content-type'] = 'application/json';
      }
    }

    let request: HttpRequest = { method, url, headers, body };
    for (const interceptor of this.requestInterceptors) {
      const replaced = await interceptor(request);
      if (replaced) {
        request = replaced;
      }
    }
    return request;
  }

  private retryDelay(attempt: number, policy: RetryPolicy, retryAfter: string | undefined): number {
    if (policy.respectRetryAfter) {
      const fromHeader = parseRetryAfter(retryAfter, Date.now());
      if (fromHeader !== undefined) {
        return Math.min(fromHeader, policy.maxDelayMs);
      }
    }
    return computeBackoff(attempt, policy);
  }

  private async attempt(
    request: HttpRequest,
    timeoutMs: number,
    userSignal: AbortSignal | undefined,
  ): Promise<
    | { kind: 'response'; response: HttpResponse }
    | { kind: 'network' | 'timeout' | 'aborted'; message: string; cause: unknown }
  > {
    const controller = new AbortController();
    let timedOut = false;
    let userAborted = false;

    // Not unref'd: the timeout must fire; it is always cleared in `finally`.
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onUserAbort = (): void => {
      userAborted = true;
      controller.abort();
    };
    if (userSignal) {
      if (userSignal.aborted) {
        onUserAbort();
      } else {
        userSignal.addEventListener('abort', onUserAbort, { once: true });
      }
    }

    try {
      const raw = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      const response = await HttpResponse.fromFetch(raw);
      return { kind: 'response', response };
    } catch (cause) {
      if (userAborted) {
        return { kind: 'aborted', message: 'request aborted by caller', cause };
      }
      if (timedOut) {
        return { kind: 'timeout', message: `request timed out after ${timeoutMs}ms`, cause };
      }
      const message = cause instanceof Error ? cause.message : String(cause);
      return { kind: 'network', message: `network error: ${message}`, cause };
    } finally {
      clearTimeout(timer);
      if (userSignal) {
        userSignal.removeEventListener('abort', onUserAbort);
      }
    }
  }
}

/** Create an {@link HttpClient}. */
export function createHttpClient(options?: ClientOptions): HttpClient {
  return new HttpClient(options);
}
