// src/router/router.ts
// Compiled regex router with parameter extraction and middleware pipeline.
//
// The implementation now lives in the standalone `@streetjs/router` package
// (built on @streetjs/context + @streetjs/exceptions + @streetjs/diagnostics +
// @streetjs/ratelimit). This module re-exports it verbatim so every internal
// `../router/router.js` importer and the public `streetjs`/`streetjs/router`
// API keep working against a single source of truth — no duplication, no shim.

export { Router, notFoundHandler, errorHandler } from '@streetjs/router';
export type { RouterOptions } from '@streetjs/router';
