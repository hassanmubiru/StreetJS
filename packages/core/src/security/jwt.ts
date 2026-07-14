// src/security/jwt.ts
//
// The HS256 JWT service now lives in the standalone @streetjs/security package
// (single source of truth). This module re-exports it so the `streetjs/security`
// subpath and all internal `../security/jwt.js` imports keep working unchanged —
// dependency inversion, not duplication.

export { JwtService } from '@streetjs/security';
export type { JwtPayload, JwtOptions } from '@streetjs/security';
