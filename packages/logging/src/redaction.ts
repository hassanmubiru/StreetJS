/**
 * Secret redaction and JSON-safe normalization.
 *
 * The {@link DefaultRedactor} performs a single recursive walk that:
 *   - censors values whose key matches a case-insensitive key name (at any depth),
 *   - censors values at an exact dotted path (with `*` wildcard segments),
 *   - normalizes every leaf to a JSON-safe value via `serialize`,
 *   - is safe against circular references (replaced with `"[Circular]"`),
 *   - never mutates the input.
 *
 * Depends on `types` and `serialize` only.
 */

import type { JsonValue, LogFields, RedactionOptions, Redactor } from './types.js';
import { isPlainContainer, normalizeLeaf } from './serialize.js';

/** Key names censored by default, wherever they appear. */
export const DEFAULT_REDACT_KEYS: readonly string[] = Object.freeze([
  'password',
  'pass',
  'pwd',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'cookie',
  'setcookie',
  'set-cookie',
  'sessionid',
  'session_id',
  'credential',
  'credentials',
  'privatekey',
  'private_key',
  'clientsecret',
  'client_secret',
]);

const DEFAULT_CENSOR = '[Redacted]';
const MAX_DEPTH = 32;

type PathPattern = readonly string[];

function parsePath(path: string): PathPattern {
  return path.split('.').map((segment) => segment.trim());
}

function pathMatches(pattern: PathPattern, current: readonly string[]): boolean {
  if (pattern.length !== current.length) {
    return false;
  }
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p !== '*' && p !== current[i]) {
      return false;
    }
  }
  return true;
}

/**
 * The default {@link Redactor}. Construct via {@link createRedactor}, which
 * also accepts an already-built custom redactor and returns it unchanged.
 */
export class DefaultRedactor implements Redactor {
  private readonly keySet: ReadonlySet<string>;
  private readonly pathPatterns: readonly PathPattern[];
  private readonly censor: string;

  constructor(options: RedactionOptions = {}) {
    const useDefaults = options.useDefaults !== false;
    const keys = new Set<string>();
    if (useDefaults) {
      for (const key of DEFAULT_REDACT_KEYS) {
        keys.add(key.toLowerCase());
      }
    }
    for (const key of options.keys ?? []) {
      keys.add(key.toLowerCase());
    }
    this.keySet = keys;
    this.pathPatterns = (options.paths ?? []).map(parsePath);
    this.censor = options.censor ?? DEFAULT_CENSOR;
  }

  redact(fields: LogFields): Record<string, JsonValue> {
    const seen = new WeakSet<object>();
    const result = this.walkObject(fields, [], seen, 0);
    return result as Record<string, JsonValue>;
  }

  private isCensoredKey(key: string): boolean {
    return this.keySet.has(key.toLowerCase());
  }

  private isCensoredPath(path: readonly string[]): boolean {
    for (const pattern of this.pathPatterns) {
      if (pathMatches(pattern, path)) {
        return true;
      }
    }
    return false;
  }

  private walkValue(
    value: unknown,
    path: readonly string[],
    seen: WeakSet<object>,
    depth: number,
  ): JsonValue {
    if (depth > MAX_DEPTH) {
      return '[Truncated: max depth]';
    }
    if (!isPlainContainer(value)) {
      return normalizeLeaf(value);
    }
    if (seen.has(value as object)) {
      return '[Circular]';
    }
    seen.add(value as object);
    try {
      if (Array.isArray(value)) {
        return value.map((item, index) =>
          this.walkValue(item, [...path, String(index)], seen, depth + 1),
        );
      }
      if (value instanceof Map) {
        const obj: Record<string, unknown> = {};
        for (const [k, v] of value) {
          obj[String(k)] = v;
        }
        return this.walkObject(obj, path, seen, depth + 1);
      }
      if (value instanceof Set) {
        return [...value].map((item, index) =>
          this.walkValue(item, [...path, String(index)], seen, depth + 1),
        );
      }
      return this.walkObject(value as Record<string, unknown>, path, seen, depth + 1);
    } finally {
      seen.delete(value as object);
    }
  }

  private walkObject(
    obj: Record<string, unknown>,
    path: readonly string[],
    seen: WeakSet<object>,
    depth: number,
  ): Record<string, JsonValue> {
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(obj)) {
      const childPath = [...path, key];
      if (this.isCensoredKey(key) || this.isCensoredPath(childPath)) {
        out[key] = this.censor;
        continue;
      }
      out[key] = this.walkValue(obj[key], childPath, seen, depth);
    }
    return out;
  }
}

/** True when the argument already implements the {@link Redactor} contract. */
export function isRedactor(value: unknown): value is Redactor {
  return typeof value === 'object' && value !== null && typeof (value as Redactor).redact === 'function';
}

/**
 * Build a redactor from options, or pass through an existing custom redactor.
 */
export function createRedactor(config?: RedactionOptions | Redactor): Redactor {
  if (config && isRedactor(config)) {
    return config;
  }
  return new DefaultRedactor(config ?? {});
}
