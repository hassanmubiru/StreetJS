// src/security/session.ts
//
// The AES-256-GCM session manager now lives in the standalone @streetjs/session
// package (single source of truth). This module re-exports it so the
// `streetjs/session` subpath and all internal `../security/session.js` imports
// keep working unchanged — dependency inversion, not duplication.

export { SessionManager } from '@streetjs/session';
export type { SessionData } from '@streetjs/session';
