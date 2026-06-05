// src/config/validator.ts
// Configuration validation engine. Call defineConfig() at startup before any
// port binding to get a fully-typed, validated config bag from process.env.
// ── Error class ───────────────────────────────────────────────────────────────
export class ConfigValidationError extends Error {
    errors;
    constructor(errors) {
        super('Configuration validation failed:\n' + errors.join('\n'));
        this.errors = errors;
        this.name = 'ConfigValidationError';
    }
}
// ── Field validator ───────────────────────────────────────────────────────────
/**
 * Validate and coerce a raw string value against a field definition.
 * Returns the coerced value on success, or throws a descriptive error message
 * (caller should catch and accumulate).
 */
function validateField(key, raw, def) {
    switch (def.type) {
        case 'string': {
            return raw;
        }
        case 'number': {
            const n = Number(raw);
            if (!Number.isFinite(n)) {
                throw new Error(`${key}: expected a number, got "${raw}"`);
            }
            if (def.min !== undefined && n < def.min) {
                throw new Error(`${key}: ${n} is below minimum ${def.min}`);
            }
            if (def.max !== undefined && n > def.max) {
                throw new Error(`${key}: ${n} exceeds maximum ${def.max}`);
            }
            return n;
        }
        case 'boolean': {
            const lower = raw.toLowerCase();
            if (lower === 'true' || lower === '1')
                return true;
            if (lower === 'false' || lower === '0')
                return false;
            throw new Error(`${key}: expected a boolean (true/false/1/0), got "${raw}"`);
        }
        case 'url': {
            try {
                new URL(raw);
            }
            catch {
                throw new Error(`${key}: "${raw}" is not a valid URL`);
            }
            return raw;
        }
        case 'port': {
            const p = Number(raw);
            if (!Number.isInteger(p) || p < 1 || p > 65535) {
                throw new Error(`${key}: port must be an integer between 1 and 65535, got "${raw}"`);
            }
            if (def.min !== undefined && p < def.min) {
                throw new Error(`${key}: port ${p} is below minimum ${def.min}`);
            }
            if (def.max !== undefined && p > def.max) {
                throw new Error(`${key}: port ${p} exceeds maximum ${def.max}`);
            }
            return p;
        }
    }
}
// ── Main factory ──────────────────────────────────────────────────────────────
/**
 * Read process.env, validate every field in `schema`, collect ALL errors, and
 * either return a fully-typed config object or throw ConfigValidationError with
 * the complete error list.
 *
 * Rules:
 *  - Absent variable + default  → use default (no error)
 *  - Absent variable, required  → error
 *  - Present variable           → validate against type/constraints regardless
 *                                 of whether a default exists
 */
export function defineConfig(schema) {
    const errors = [];
    const result = {};
    for (const [key, def] of Object.entries(schema)) {
        const raw = process.env[key];
        if (raw === undefined || raw === '') {
            // Variable is absent (or empty string — treat as absent)
            if (def.default !== undefined) {
                result[key] = def.default;
            }
            else if (def.required) {
                errors.push(`${key}: required environment variable is not set`);
            }
            else {
                // Not required, no default — use empty string for 'string', otherwise error
                if (def.type === 'string') {
                    result[key] = '';
                }
                else {
                    errors.push(`${key}: required environment variable is not set (type "${def.type}" has no default)`);
                }
            }
            continue;
        }
        // Variable is present — validate regardless of default
        try {
            result[key] = validateField(key, raw, def);
        }
        catch (err) {
            errors.push(err.message);
        }
    }
    if (errors.length > 0) {
        throw new ConfigValidationError(errors);
    }
    return result;
}
//# sourceMappingURL=validator.js.map