/**
 * @streetjs/gateway — pure CORS resolver.
 *
 * Given a {@link CorsPolicy} and a {@link GatewayRequest}, computes the CORS
 * decision and the exact set of `Access-Control-*` response headers to emit.
 * The function is total and side-effect-free: it never throws, performs no I/O,
 * and depends only on the request's headers and method.
 *
 * Decision summary:
 * - `allowed` is `false` only when the request carries an `Origin` that the
 *   policy does not permit; it is `true` otherwise (including when no `Origin`
 *   header is present — such requests are same-origin/non-CORS).
 * - `isPreflight` is `true` for a genuine CORS preflight: an `OPTIONS` request
 *   that carries an `access-control-request-method` header.
 *
 * `Access-Control-Allow-Origin` rules:
 * - `origins: "*"` without credentials → the literal `*`.
 * - `origins: "*"` with credentials → echo the request's specific origin (the
 *   wildcard is illegal alongside credentials per the Fetch standard).
 * - explicit allowlist → echo the request origin when it is listed, else omit.
 */

import type { CorsPolicy, GatewayRequest, Headers } from "./types.js";

/** The default methods advertised on a preflight when the policy omits them. */
const DEFAULT_METHODS = "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS";

/**
 * Read a single header value case-insensitively. Header bags are expected to be
 * lower-cased already, but we scan defensively. When a header holds an array of
 * values the first is returned.
 */
function header(headers: Headers, name: string): string | undefined {
  const lower = name.toLowerCase();
  const direct = headers[lower];
  const value = direct !== undefined ? direct : findCaseInsensitive(headers, lower);
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Fallback lookup for header bags whose keys are not already lower-cased. */
function findCaseInsensitive(headers: Headers, lower: string): string | string[] | undefined {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return undefined;
}

/** Whether the policy permits `origin` (an explicit member, or any under `"*"`). */
function originAllowed(policy: CorsPolicy, origin: string): boolean {
  if (policy.origins === "*") return true;
  return policy.origins.includes(origin);
}

/** The result of resolving a CORS policy against a request. */
export interface CorsResolution {
  /** `false` only when a present `Origin` is not permitted by the policy. */
  readonly allowed: boolean;
  /** The `Access-Control-*` response headers to emit (may be empty). */
  readonly headers: Record<string, string>;
  /** `true` for a genuine preflight (`OPTIONS` + `access-control-request-method`). */
  readonly isPreflight: boolean;
}

/**
 * Resolve a {@link CorsPolicy} against a {@link GatewayRequest}. Pure: returns
 * the CORS decision and the response headers without mutating either argument.
 */
export function resolveCors(policy: CorsPolicy, req: GatewayRequest): CorsResolution {
  const origin = header(req.headers, "origin");
  const requestMethod = header(req.headers, "access-control-request-method");
  const isPreflight = req.method.toUpperCase() === "OPTIONS" && requestMethod !== undefined;

  const headers: Record<string, string> = {};
  const credentials = policy.credentials === true;

  // ── Access-Control-Allow-Origin + allowed decision ────────────────────────
  let allowed = true;
  if (origin === undefined) {
    // No Origin → not a CORS request; permitted, but emit no ACAO.
  } else if (originAllowed(policy, origin)) {
    // Wildcard without credentials may answer with the literal `*`; otherwise
    // (explicit allowlist, or wildcard + credentials) we echo the origin.
    if (policy.origins === "*" && !credentials) {
      headers["Access-Control-Allow-Origin"] = "*";
    } else {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
  } else {
    allowed = false;
  }

  if (credentials) {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  // ── Preflight vs. actual-request headers ──────────────────────────────────
  if (isPreflight) {
    headers["Access-Control-Allow-Methods"] =
      policy.methods && policy.methods.length > 0
        ? policy.methods.join(",")
        : DEFAULT_METHODS;

    if (policy.allowedHeaders && policy.allowedHeaders.length > 0) {
      headers["Access-Control-Allow-Headers"] = policy.allowedHeaders.join(",");
    } else {
      const requested = header(req.headers, "access-control-request-headers");
      if (requested !== undefined) {
        headers["Access-Control-Allow-Headers"] = requested;
      }
    }

    if (policy.maxAgeSeconds !== undefined) {
      headers["Access-Control-Max-Age"] = String(policy.maxAgeSeconds);
    }
  } else if (policy.exposedHeaders && policy.exposedHeaders.length > 0) {
    headers["Access-Control-Expose-Headers"] = policy.exposedHeaders.join(",");
  }

  return { allowed, headers, isPreflight };
}
