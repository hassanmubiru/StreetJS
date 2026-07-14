/**
 * @streetjs/security — the StreetJS security foundation.
 *
 * A dependency-free HS256 JWT service (sign/verify/decode) with
 * algorithm-confusion protection, timing-safe signature comparison, and
 * exp/nbf/iat/iss/aud claim validation. Zero runtime dependencies. Public API
 * only.
 *
 * ```ts
 * import { JwtService } from '@streetjs/security';
 *
 * const jwt = new JwtService(process.env.JWT_SECRET!); // >= 32 chars
 * const token = jwt.sign({ sub: '7', roles: ['admin'] }, { expiresInSeconds: 3600 });
 * const claims = jwt.verify(token); // JwtPayload | null
 * ```
 *
 * > This is the standalone home of the JWT service that also backs
 * > `streetjs/security`; the `streetjs` framework re-exports it, so there is a
 * > single implementation.
 */

export { JwtService, type JwtPayload, type JwtOptions } from './jwt.js';

/**
 * Dependency-injection token for a {@link JwtService}. `@streetjs/security`
 * depends on no container, so the token is a plain unique symbol.
 */
export const JWT_SERVICE: unique symbol = Symbol.for('@streetjs/security:JwtService');
