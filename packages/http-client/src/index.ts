/**
 * @streetjs/http-client — the StreetJS outbound HTTP client foundation.
 *
 * A typed client over `fetch` with base URLs, query building, JSON helpers,
 * timeouts, retries with backoff, request/response interceptors, and descriptive
 * errors. Zero runtime dependencies (uses global `fetch`). Public API only.
 *
 * ```ts
 * import { createHttpClient } from '@streetjs/http-client';
 *
 * const api = createHttpClient({ baseUrl: 'https://api.example.com', timeoutMs: 5000 });
 * const res = await api.get('/users', { query: { page: 2 } });
 * const users = res.json<User[]>();
 * await api.post('/users', { name: 'Ada' }); // JSON-encoded
 * ```
 */

export { HttpClient, createHttpClient } from './client.js';
export { HttpResponse } from './response.js';
export { HttpError, type HttpErrorKind } from './errors.js';

export {
  DEFAULT_RETRY_POLICY,
  resolveRetryPolicy,
  isRetriableMethod,
  isRetriableStatus,
  computeBackoff,
  parseRetryAfter,
} from './retry.js';

export { resolveUrl, appendQuery, buildQueryString, isAbsoluteUrl } from './url.js';

export type {
  HttpMethod,
  QueryValue,
  QueryParams,
  HeaderMap,
  FetchLike,
  SleepFn,
  RetryPolicy,
  HttpRequest,
  RequestOptions,
  RequestInterceptor,
  ResponseInterceptor,
  HttpResponseView,
  ClientOptions,
} from './types.js';

/**
 * Dependency-injection token for an {@link HttpClient}. `@streetjs/http-client`
 * depends on no container, so the token is a plain unique symbol.
 */
export const HTTP_CLIENT: unique symbol = Symbol.for('@streetjs/http-client:Client');
