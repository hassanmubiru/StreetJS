/**
 * JSON-safe normalization of arbitrary values, including robust error
 * serialization. Used by the redactor's walk to turn leaf values into
 * transport-ready {@link JsonValue}s.
 *
 * Depends only on `types` — no other internal modules.
 */

import type { JsonValue } from './types.js';

/**
 * Serialize an error (or any thrown value) into a JSON-safe object.
 *
 * Captures `name`, `message`, and `stack`, follows a `cause` chain (bounded to
 * avoid pathological depth), and includes any own enumerable properties an
 * application attached to the error.
 */
export function serializeError(err: unknown, depth = 0): JsonValue {
  if (!(err instanceof Error)) {
    // A non-Error was thrown/logged as an error; represent it faithfully.
    return { type: 'NonError', value: normalizeLeaf(err) } as JsonValue;
  }

  const out: Record<string, JsonValue> = {
    type: err.name || 'Error',
    message: err.message,
  };
  if (typeof err.stack === 'string') {
    out.stack = err.stack;
  }

  // Own enumerable extras (e.g. `code`, `statusCode`) beyond the standard trio.
  for (const key of Object.keys(err)) {
    if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') {
      continue;
    }
    out[key] = normalizeLeaf((err as unknown as Record<string, unknown>)[key]);
  }

  const cause = (err as { cause?: unknown }).cause;
  if (cause !== undefined && depth < 8) {
    out.cause = serializeError(cause, depth + 1);
  }

  return out;
}

/**
 * Normalize a single leaf (non-plain-object, non-array) value to a JSON-safe
 * representation. Containers are handled by the redactor walk, not here.
 */
export function normalizeLeaf(value: unknown): JsonValue {
  switch (typeof value) {
    case 'string':
      return value;
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : String(value);
    case 'bigint':
      return value.toString();
    case 'undefined':
      return null;
    case 'function':
      return `[Function: ${value.name || 'anonymous'}]`;
    case 'symbol':
      return value.toString();
    case 'object': {
      if (value === null) {
        return null;
      }
      if (value instanceof Error) {
        return serializeError(value);
      }
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
      }
      if (value instanceof RegExp) {
        return value.toString();
      }
      if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
        try {
          return normalizeLeaf((value as { toJSON: () => unknown }).toJSON());
        } catch {
          return '[unserializable]';
        }
      }
      // Buffers / typed arrays: report kind + length rather than dumping bytes.
      if (ArrayBuffer.isView(value)) {
        return `[${(value as { constructor: { name: string } }).constructor.name}: ${
          (value as { byteLength: number }).byteLength
        } bytes]`;
      }
      // Any other object reaching here is handled by the container walk;
      // as a defensive fallback, stringify.
      return String(value);
    }
    default:
      return String(value);
  }
}

/** True when `value` should be walked as a plain container (object/array). */
export function isPlainContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (value instanceof Error || value instanceof Date || value instanceof RegExp) {
    return false;
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return false;
  }
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return false;
  }
  if (Array.isArray(value) || value instanceof Map || value instanceof Set) {
    return true;
  }
  return true;
}
