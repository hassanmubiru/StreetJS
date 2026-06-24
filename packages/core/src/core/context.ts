// src/core/context.ts
// Strict request/response context passed through middleware and handlers.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ParsedFile } from '../multipart/parser.js';

export interface StreetContext {
  /** Raw Node.js request */
  readonly req: IncomingMessage;
  /** Raw Node.js response */
  readonly res: ServerResponse;
  /** Parsed URL path */
  readonly path: string;
  /** HTTP method (uppercase) */
  readonly method: string;
  /** Extracted route params e.g. { id: "123" } */
  params: Record<string, string>;
  /** Parsed query string */
  readonly query: Record<string, string>;
  /** Parsed request headers (lowercase keys) */
  readonly headers: Record<string, string>;
  /** Parsed request body (JSON or form) */
  body: unknown;
  /** Uploaded files from multipart parsing */
  files: ParsedFile[];
  /** Arbitrary state bag for middleware communication */
  state: Record<string, unknown>;
  /** Authenticated user (set by auth middleware) */
  user: AuthenticatedUser | null;
  /** Request start time (hrtime bigint) */
  readonly startTime: bigint;

  /** Send JSON response */
  json(data: unknown, status?: number): void;
  /** Send plain text response */
  text(data: string, status?: number): void;
  /** Send HTML response */
  html(data: string, status?: number): void;
  /** Send empty response with status */
  send(status: number): void;
  /** Set a response header */
  setHeader(name: string, value: string): void;
  /** Get a request cookie value */
  cookie(name: string): string | undefined;
  /** Set a response cookie */
  setCookie(name: string, value: string, options?: CookieOptions): void;
  /** Check if response has been sent */
  readonly sent: boolean;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: string[];
}

export interface CookieOptions {
  /** Defaults to `true` (HttpOnly emitted) unless explicitly set to `false`. */
  httpOnly?: boolean;
  /** Defaults to `true` in production (`NODE_ENV === 'production'`) unless explicitly set. */
  secure?: boolean;
  /** Defaults to `'Lax'` unless explicitly provided. */
  sameSite?: 'Strict' | 'Lax' | 'None';
  maxAge?: number;
  path?: string;
  domain?: string;
}

/**
 * Pure helper that serializes a single cookie into a `Set-Cookie` value applying
 * the secure-by-default flag resolution (F-A1):
 * - `httpOnly`: `options.httpOnly ?? true`
 * - `secure`: `options.secure ?? (process.env.NODE_ENV === 'production')`
 * - `sameSite`: `options.sameSite ?? 'Lax'`
 *
 * Attributes are emitted in a fixed, stable order so the output is deterministic:
 * `name=encodeURIComponent(value); HttpOnly?; Secure?; SameSite=<v>?; Max-Age?; Path?; Domain?`
 */
function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const httpOnly = options.httpOnly ?? true;
  const secure = options.secure ?? (process.env.NODE_ENV === 'production');
  const sameSite = options.sameSite ?? 'Lax';

  const parts: string[] = [`${name}=${encodeURIComponent(value)}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  parts.push(`SameSite=${sameSite}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  return parts.join('; ');
}

export function createContext(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  query: Record<string, string>
): StreetContext {
  let _sent = false;

  const headers: Record<string, string> = {};
  for (const [key, val] of Object.entries(req.headers)) {
    if (val !== undefined) {
      headers[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : val;
    }
  }

  const ctx: StreetContext = {
    req,
    res,
    path,
    method: (req.method ?? 'GET').toUpperCase(),
    params: {},
    query,
    headers,
    body: null,
    files: [],
    state: {},
    user: null,
    startTime: process.hrtime.bigint(),

    get sent() {
      return _sent;
    },

    json(data: unknown, status = 200): void {
      if (_sent) return;
      _sent = true;
      const body = JSON.stringify(data);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body, 'utf8').toString(),
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
    },

    text(data: string, status = 200): void {
      if (_sent) return;
      _sent = true;
      res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(data, 'utf8').toString(),
      });
      res.end(data);
    },

    html(data: string, status = 200): void {
      if (_sent) return;
      _sent = true;
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(data, 'utf8').toString(),
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(data);
    },

    send(status: number): void {
      if (_sent) return;
      _sent = true;
      res.writeHead(status);
      res.end();
    },

    setHeader(name: string, value: string): void {
      res.setHeader(name, value);
    },

    cookie(name: string): string | undefined {
      const header = req.headers.cookie ?? '';
      for (const part of header.split(';')) {
        const [k, ...rest] = part.trim().split('=');
        if (k?.trim() === name) {
          return decodeURIComponent(rest.join('='));
        }
      }
      return undefined;
    },

    setCookie(name: string, value: string, options: CookieOptions = {}): void {
      res.setHeader('Set-Cookie', serializeCookie(name, value, options));
    },
  };

  return ctx;
}
