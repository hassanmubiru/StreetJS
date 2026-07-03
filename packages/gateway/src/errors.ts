/**
 * @streetjs/gateway — typed error hierarchy.
 *
 * Every error the gateway raises derives from {@link GatewayError} so a single
 * `instanceof GatewayError` catches the whole family while callers can still
 * discriminate on concrete subclasses. Each subclass carries a stable HTTP
 * `status` so the gateway can map a failure to a client response deterministically.
 */

import type { ValidationIssue } from "./types.js";

/** Base class for every gateway error; carries the HTTP status to surface. */
export class GatewayError extends Error {
  /** HTTP status the gateway returns for this error. */
  readonly status: number;
  readonly cause?: unknown;

  constructor(message: string, status = 500, options?: { cause?: unknown }) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, GatewayError.prototype);
  }
}

/** No route matched the request path/method (HTTP 404). */
export class RouteNotFoundError extends GatewayError {
  readonly path: string;
  constructor(path: string, message?: string) {
    super(message ?? `No route matches "${path}".`, 404);
    this.name = "RouteNotFoundError";
    this.path = path;
    Object.setPrototypeOf(this, RouteNotFoundError.prototype);
  }
}

/** A referenced service pool has no configured/healthy targets (HTTP 503). */
export class NoHealthyUpstreamError extends GatewayError {
  readonly service: string;
  constructor(service: string, message?: string) {
    super(message ?? `Service "${service}" has no healthy upstream targets.`, 503);
    this.name = "NoHealthyUpstreamError";
    this.service = service;
    Object.setPrototypeOf(this, NoHealthyUpstreamError.prototype);
  }
}

/** The circuit for a target/service is open and requests are shed (HTTP 503). */
export class CircuitOpenError extends GatewayError {
  readonly key: string;
  constructor(key: string, message?: string) {
    super(message ?? `Circuit is open for "${key}"; request shed.`, 503);
    this.name = "CircuitOpenError";
    this.key = key;
    Object.setPrototypeOf(this, CircuitOpenError.prototype);
  }
}

/** The upstream request exceeded its timeout (HTTP 504). */
export class UpstreamTimeoutError extends GatewayError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number, message?: string) {
    super(message ?? `Upstream request exceeded its ${timeoutMs}ms timeout.`, 504);
    this.name = "UpstreamTimeoutError";
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, UpstreamTimeoutError.prototype);
  }
}

/** The client exceeded a configured rate limit (HTTP 429). */
export class RateLimitExceededError extends GatewayError {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number, message?: string) {
    super(message ?? `Rate limit exceeded; retry after ${retryAfterMs}ms.`, 429);
    this.name = "RateLimitExceededError";
    this.retryAfterMs = retryAfterMs;
    Object.setPrototypeOf(this, RateLimitExceededError.prototype);
  }
}

/** Authentication was required but not satisfied (HTTP 401). */
export class UnauthenticatedError extends GatewayError {
  constructor(message?: string) {
    super(message ?? "Authentication required.", 401);
    this.name = "UnauthenticatedError";
    Object.setPrototypeOf(this, UnauthenticatedError.prototype);
  }
}

/** The authenticated principal lacks the required authorization (HTTP 403). */
export class ForbiddenError extends GatewayError {
  constructor(message?: string) {
    super(message ?? "Forbidden.", 403);
    this.name = "ForbiddenError";
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

/** Request validation failed; carries the consistent issue list (HTTP 400). */
export class RequestValidationError extends GatewayError {
  readonly issues: readonly ValidationIssue[];
  constructor(issues: readonly ValidationIssue[], message?: string) {
    super(message ?? `Request validation failed with ${issues.length} issue(s).`, 400);
    this.name = "RequestValidationError";
    this.issues = issues;
    Object.setPrototypeOf(this, RequestValidationError.prototype);
  }
}

/** The request body exceeded the configured size limit (HTTP 413). */
export class PayloadTooLargeError extends GatewayError {
  readonly limitBytes: number;
  constructor(limitBytes: number, message?: string) {
    super(message ?? `Request body exceeds the ${limitBytes}-byte limit.`, 413);
    this.name = "PayloadTooLargeError";
    this.limitBytes = limitBytes;
    Object.setPrototypeOf(this, PayloadTooLargeError.prototype);
  }
}

/** Invalid gateway configuration detected at construction (HTTP 500). */
export class GatewayConfigError extends GatewayError {
  constructor(message: string) {
    super(message, 500);
    this.name = "GatewayConfigError";
    Object.setPrototypeOf(this, GatewayConfigError.prototype);
  }
}
