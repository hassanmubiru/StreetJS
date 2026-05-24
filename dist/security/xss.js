// src/security/xss.ts
// Recursive XSS sanitizer for deep object sanitization.
// Strips HTML tags, script: protocol, and event handlers from string values.
const MAX_DEPTH = 32;
const MAX_STRING_LEN = 1_000_000; // 1MB string cap
const DANGEROUS_ATTRS = /on\w+\s*=/gi;
const SCRIPT_PROTOCOL = /javascript\s*:/gi;
const DATA_PROTOCOL = /data\s*:/gi;
const VBSCRIPT_PROTOCOL = /vbscript\s*:/gi;
const HTML_TAGS = /<[^>]*>/g;
const NULL_BYTES = /\x00/g;
/** Sanitize a single string value */
export function sanitizeString(input) {
    if (input.length > MAX_STRING_LEN) {
        input = input.substring(0, MAX_STRING_LEN);
    }
    return input
        .replace(NULL_BYTES, '')
        .replace(HTML_TAGS, '')
        .replace(SCRIPT_PROTOCOL, '')
        .replace(DATA_PROTOCOL, '')
        .replace(VBSCRIPT_PROTOCOL, '')
        .replace(DANGEROUS_ATTRS, '');
}
/** Recursively sanitize all string values in an object or array */
export function sanitizeDeep(value, depth = 0) {
    if (depth > MAX_DEPTH)
        return null;
    if (value === null || value === undefined)
        return value;
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
        const result = {};
        let keyCount = 0;
        const MAX_KEYS = 500;
        for (const key of Object.keys(value)) {
            if (keyCount++ > MAX_KEYS)
                break;
            const sanitizedKey = sanitizeString(key);
            result[sanitizedKey] = sanitizeDeep(value[key], depth + 1);
        }
        return result;
    }
    return null;
}
/** Escape HTML entities in a string (for safe HTML output) */
export function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}
/** Middleware that sanitizes request body recursively */
export async function xssMiddleware(ctx, next) {
    if (ctx.body !== null && typeof ctx.body === 'object') {
        ctx['body'] = sanitizeDeep(ctx.body);
    }
    await next();
}
//# sourceMappingURL=xss.js.map