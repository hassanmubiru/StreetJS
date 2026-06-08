// src/security/xss.ts
// Recursive XSS sanitizer for deep object sanitization.
// Strips HTML tags, script: protocol, and event handlers from string values.

const MAX_DEPTH = 32;
const MAX_STRING_LEN = 1_000_000; // 1MB string cap

const DANGEROUS_ATTRS = /on\w+\s*=/gi;
const SCRIPT_PROTOCOL = /javascript\s*:/gi;
const DATA_PROTOCOL = /data\s*:/gi;
const VBSCRIPT_PROTOCOL = /vbscript\s*:/gi;
const NULL_BYTES = /\x00/g;

/** Sanitize a single string value */
export function sanitizeString(input: string): string {
  if (input.length > MAX_STRING_LEN) {
    input = input.substring(0, MAX_STRING_LEN);
  }

  let previous: string;
  let current = input;

  // Loop to a true fixed point. Each pass only DELETES characters, so the
  // string length is monotonically non-increasing and the loop is guaranteed
  // to terminate. This eliminates the residual Class D defect where a deeply
  // nested reconstitution (e.g. nestedReconstitution(11)) survived the former
  // MAX_SANITIZE_PASSES cap and left a dangerous substring intact.
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

/** Recursively sanitize all string values in an object or array */
export function sanitizeDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return null;

  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    // Bounded array processing
    const MAX_ARRAY = 10_000;
    return value.slice(0, MAX_ARRAY).map((item) => sanitizeDeep(item, depth + 1));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    let keyCount = 0;
    const MAX_KEYS = 500;
    for (const key of Object.keys(value as object)) {
      if (keyCount++ > MAX_KEYS) break;
      const sanitizedKey = sanitizeString(key);
      result[sanitizedKey] = sanitizeDeep((value as Record<string, unknown>)[key], depth + 1);
    }
    return result;
  }

  return null;
}

/** Escape HTML entities in a string (for safe HTML output) */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/** Middleware that sanitizes request body recursively */
export async function xssMiddleware(
  ctx: import('../core/context.js').StreetContext,
  next: () => Promise<void>
): Promise<void> {
  if (ctx.body !== null && typeof ctx.body === 'object') {
    (ctx as unknown as Record<string, unknown>)['body'] = sanitizeDeep(ctx.body);
  }
  await next();
}
