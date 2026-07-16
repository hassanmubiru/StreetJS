// src/core/context.ts
// Strict request/response context passed through middleware and handlers.
//
// The implementation now lives in the standalone `@streetjs/context` package
// (type-only deps: node:http + @streetjs/multipart). This module re-exports it
// verbatim so every internal `../core/context.js` importer and the public
// `streetjs` API keep working against a single source of truth — no duplication,
// no shim.

export { createContext, serializeCookie } from '@streetjs/context';
export type { StreetContext, AuthenticatedUser, CookieOptions } from '@streetjs/context';
