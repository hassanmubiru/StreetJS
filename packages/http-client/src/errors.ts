/**
 * Error types for @streetjs/http-client.
 *
 * Depends on `types` only.
 */

import type { HttpRequest, HttpResponseView } from './types.js';

/** Why a request failed. */
export type HttpErrorKind = 'status' | 'network' | 'timeout' | 'aborted';

/** A request failure. Carries the originating request and (for `status`) the response. */
export class HttpError extends Error {
  readonly kind: HttpErrorKind;
  readonly request: HttpRequest;
  readonly response?: HttpResponseView;
  readonly cause?: unknown;

  constructor(
    kind: HttpErrorKind,
    message: string,
    request: HttpRequest,
    response?: HttpResponseView,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
    this.kind = kind;
    this.request = request;
    this.response = response;
    this.cause = cause;
  }

  /** HTTP status code, when the failure was a non-2xx response. */
  get status(): number | undefined {
    return this.response?.status;
  }
}
