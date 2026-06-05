/** Sanitize a single string value */
export declare function sanitizeString(input: string): string;
/** Recursively sanitize all string values in an object or array */
export declare function sanitizeDeep(value: unknown, depth?: number): unknown;
/** Escape HTML entities in a string (for safe HTML output) */
export declare function escapeHtml(str: string): string;
/** Middleware that sanitizes request body recursively */
export declare function xssMiddleware(ctx: import('../core/context.js').StreetContext, next: () => Promise<void>): Promise<void>;
//# sourceMappingURL=xss.d.ts.map