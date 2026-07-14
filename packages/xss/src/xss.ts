// Dependency-free XSS input sanitization.
// Strips HTML tag delimiters, dangerous URL protocols, event-handler
// attributes, and null bytes from string values; recursively for structures.

const MAX_DEPTH = 32;
const MAX_STRING_LEN = 1_000_000; // 1 MB string cap

const DANGEROUS_ATTRS = /on\w+\s*=/gi;
const SCRIPT_PROTOCOL = /javascript\s*:/gi;
const DATA_PROTOCOL = /data\s*:/gi;
const VBSCRIPT_PROTOCOL = /vbscript\s*:/gi;
// eslint-disable-next-line no-control-regex
const NULL_BYTES = /\x00/g;

/**
 * Sanitize a single string. Runs deletions to a true fixed point: each pass
 * only removes characters, so length is monotonically non-increasing and the
 * loop is guaranteed to terminate — closing the "reconstitution" class of bugs
 * where a nested payload survives a fixed number of passes.
 */
export function sanitizeString(input: string): string {
  if (input.length > MAX_STRING_LEN) {
    input = input.substring(0, MAX_STRING_LEN);
  }

  let previous: string;
  let current = input;

  do {
    previous = current;
    current = current
      .replace(NULL_BYTES, '')
      .replace(/[<>]/g, '')
      .replace(SCRIPT_PROTOCOL, '')
      .replace(DATA_PROTOCOL, '')
      .replace(VBSCRIPT_PROTOCOL, '')
      .replace(DANGEROUS_ATTRS, '');
  } while (current !== previous);

  return current;
}

/**
 * Recursively sanitize all string values (and keys) in an object or array.
 * Bounded by depth, key count, array length, and string length to resist
 * resource-exhaustion via hostile input.
 */
export function sanitizeDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return null;
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const MAX_ARRAY = 10_000;
    return value.slice(0, MAX_ARRAY).map((item) => sanitizeDeep(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    let keyCount = 0;
    const MAX_KEYS = 500;
    for (const key of Object.keys(value as object)) {
      if (keyCount++ > MAX_KEYS) {
        break;
      }
      const sanitizedKey = sanitizeString(key);
      result[sanitizedKey] = sanitizeDeep((value as Record<string, unknown>)[key], depth + 1);
    }
    return result;
  }
  return null;
}

/** Escape HTML entities in a string for safe HTML output. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}
