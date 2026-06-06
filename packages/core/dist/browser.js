// src/browser.ts
// Browser / edge-runtime entry point for @streetjs/core.
//
// This module is selected automatically by bundlers (Vite, Rollup, Webpack,
// ESBuild) and edge runtimes via the package.json "browser" export condition.
// It re-exports ONLY the parts of the framework that are free of Node.js core
// modules (no `node:net`, `node:fs`, `node:crypto`, `node:http`, …) so that a
// browser/edge bundle never pulls a Node built-in into the dependency graph.
//
// Anything that requires a Node runtime (the HTTP server, PostgreSQL wire
// driver, clustering, filesystem, native crypto, transports, …) is intentionally
// NOT exported here. Importing such a feature in a browser build resolves to the
// stub module (`browser-stub.ts`) which throws FeatureUnavailableInEdgeRuntimeError.
// ── Runtime-agnostic exceptions (no imports) ───────────────────────────────────
export { StreetException, BadRequestException, UnauthorizedException, ForbiddenException, NotFoundException, ConflictException, UnprocessableException, InternalException, ServiceUnavailableException, DatabaseConnectionError, FeatureUnavailableInEdgeRuntimeError, isStreetException, } from './http/exceptions.js';
// ── XSS sanitisation helpers (pure string functions, no imports) ───────────────
export { sanitizeString, sanitizeDeep, escapeHtml } from './security/xss.js';
// ── In-memory LRU cache (pure data structure, no imports) ──────────────────────
export { LruCache } from './cache/lru.js';
/**
 * The runtime this build targets. Useful for guards in isomorphic code:
 *
 *   import { STREET_BUILD_TARGET } from '@streetjs/core';
 *   if (STREET_BUILD_TARGET === 'browser') { ... }
 */
export const STREET_BUILD_TARGET = 'browser';
//# sourceMappingURL=browser.js.map