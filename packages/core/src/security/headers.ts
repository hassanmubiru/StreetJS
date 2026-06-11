// src/security/headers.ts
// Configurable security-header presets and a typed Content-Security-Policy
// builder. Complements the always-on `securityHeaders` middleware by letting
// applications tailor CSP directives, HSTS, and frame options without losing
// the hardened defaults. Pure functions — no Node built-ins, browser-safe.

export type CspDirectives = Record<string, string[] | true>;

/**
 * Build a Content-Security-Policy header value from a directive map.
 * - `['self']` → `default-src 'self'`
 * - `true`     → a valueless directive (e.g. `upgrade-insecure-requests`)
 * Tokens that are CSP keywords (`self`, `none`, `unsafe-inline`, nonces/hashes)
 * are quoted automatically; hosts/schemes are emitted verbatim.
 */
export function buildCsp(directives: CspDirectives): string {
  const KEYWORDS = new Set(['self', 'none', 'unsafe-inline', 'unsafe-eval', 'strict-dynamic', 'unsafe-hashes']);
  const parts: string[] = [];
  for (const [name, value] of Object.entries(directives)) {
    if (value === true) { parts.push(name); continue; }
    const tokens = value.map((t) => {
      if (KEYWORDS.has(t) || /^(nonce|sha256|sha384|sha512)-/.test(t)) return `'${t}'`;
      return t;
    });
    parts.push(tokens.length ? `${name} ${tokens.join(' ')}` : name);
  }
  return parts.join('; ');
}

/** Hardened default CSP: same-origin only, no inline scripts, framing denied. */
export const DEFAULT_CSP: CspDirectives = {
  'default-src': ['self'],
  'script-src': ['self'],
  'object-src': ['none'],
  'base-uri': ['self'],
  'frame-ancestors': ['none'],
};

/**
 * The set of security response headers managed by the middleware that an
 * application may explicitly override or disable (R4.2/R4.4/R4.5). These are the
 * always-on protections the middleware applies by default on every response.
 */
export type SecurityHeaderName =
  | 'Content-Security-Policy'
  | 'Strict-Transport-Security'
  | 'X-Frame-Options'
  | 'X-Content-Type-Options'
  | 'Referrer-Policy'
  | 'Permissions-Policy';

export interface SecurityHeadersOptions {
  /** CSP directive map; defaults to {@link DEFAULT_CSP}. Pass `false` to omit CSP. */
  csp?: CspDirectives | false;
  /** HSTS max-age in seconds (default 63072000 = 2y). `0` omits HSTS. */
  hstsMaxAge?: number;
  /** `X-Frame-Options` value (default `DENY`). */
  frameOptions?: 'DENY' | 'SAMEORIGIN';
  /** `Referrer-Policy` (default `strict-origin-when-cross-origin`). */
  referrerPolicy?: string;
  /** `Permissions-Policy` (default disables geolocation/mic/camera). */
  permissionsPolicy?: string;
  /**
   * Explicitly omit named headers from the response (R4.5). Any header named
   * here is removed from the computed set even if a default or supplied value
   * exists for it. Complements the existing per-header sentinels (`csp: false`,
   * `hstsMaxAge: 0`).
   */
  disable?: SecurityHeaderName[];
}

interface HeaderSink { setHeader(name: string, value: string): void }

/**
 * Compute the security headers for the given options. Returned as a plain map
 * so it can be unit-tested and applied to any sink.
 */
export function computeSecurityHeaders(opts: SecurityHeadersOptions = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (opts.csp !== false) headers['Content-Security-Policy'] = buildCsp(opts.csp ?? DEFAULT_CSP);
  const hsts = opts.hstsMaxAge ?? 63072000;
  if (hsts > 0) headers['Strict-Transport-Security'] = `max-age=${hsts}; includeSubDomains; preload`;
  headers['X-Content-Type-Options'] = 'nosniff';
  headers['X-Frame-Options'] = opts.frameOptions ?? 'DENY';
  headers['Cross-Origin-Opener-Policy'] = 'same-origin';
  headers['Cross-Origin-Resource-Policy'] = 'same-origin';
  headers['Referrer-Policy'] = opts.referrerPolicy ?? 'strict-origin-when-cross-origin';
  headers['Permissions-Policy'] = opts.permissionsPolicy ?? 'geolocation=(), microphone=(), camera=()';
  return headers;
}

/**
 * Configurable security-headers middleware factory. Backward-compatible default
 * output matches the always-on `securityHeaders` middleware; pass options to
 * customise CSP/HSTS/frame policy per application.
 */
export function securityHeadersMiddleware(opts: SecurityHeadersOptions = {}) {
  const headers = computeSecurityHeaders(opts);
  return async (ctx: HeaderSink, next: () => Promise<void>): Promise<void> => {
    for (const [name, value] of Object.entries(headers)) ctx.setHeader(name, value);
    await next();
  };
}
