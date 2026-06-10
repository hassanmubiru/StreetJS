// @streetjs/devtools — authentication & authorization model for the Interactive
// Developer Experience (Req 7.7).
//
// The devtools surface (Playground, Route Explorer, Dependency Graph Visualizer,
// API Inspector) is a privileged window into a running application. Its access
// model is DECLARED and ENFORCED here — it is not merely documentation. Every
// request the tools make against the inspected app is funnelled through
// `DevtoolsAuthGate.authorize()`, which fails closed.
//
// AUTHN MODEL (token-gated): a caller MUST present a bearer token in the
// `Authorization: Bearer <token>` header. The raw token is never stored; the
// gate is constructed from the SHA-256 hash of the token and compares hashes in
// constant time (`crypto.timingSafeEqual`). A request with a missing, empty, or
// non-matching token is rejected UNAUTHENTICATED (401).
//
// AUTHZ MODEL (read-only): even an authenticated caller may only perform
// SAFE, non-mutating HTTP methods against the inspected app — GET, HEAD,
// OPTIONS. Any state-changing method (POST, PUT, PATCH, DELETE, …) is rejected
// READ_ONLY (403). The tools therefore cannot mutate the inspected app.
import { createHash, timingSafeEqual } from 'node:crypto';
/** HTTP methods the devtools are permitted to issue — read-only by policy. */
export const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
/** HTTP status code that corresponds to each decision. */
export const STATUS_FOR_DECISION = {
    ALLOWED: 200,
    UNAUTHENTICATED: 401,
    READ_ONLY: 403,
};
/** SHA-256 hex digest of a token. Used to construct the gate and to compare. */
export function hashToken(token) {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}
/** True iff `method` is a safe, read-only method (case-insensitive). */
export function isSafeMethod(method) {
    return SAFE_METHODS.includes(method.trim().toUpperCase());
}
/** Extract the raw bearer token from an `Authorization` header value. */
export function parseBearer(header) {
    if (!header)
        return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : undefined;
}
/** Constant-time comparison of two hex digests of equal length. */
function hashesEqual(a, b) {
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
/**
 * Token-gated, read-only authorization gate for the devtools. Fails closed:
 * authentication is checked first (UNAUTHENTICATED), then the read-only policy
 * (READ_ONLY), and only a request that is both authenticated and read-only is
 * ALLOWED (Req 7.7).
 */
export class DevtoolsAuthGate {
    tokenHash;
    constructor(tokenHash) {
        this.tokenHash = tokenHash;
    }
    /** Construct a gate from the raw access token. */
    static fromToken(token) {
        if (typeof token !== 'string' || token.trim().length === 0) {
            throw new Error('DevtoolsAuthGate requires a non-empty access token');
        }
        return new DevtoolsAuthGate(hashToken(token));
    }
    /** Construct a gate from an already-computed SHA-256 token hash. */
    static fromTokenHash(tokenHash) {
        if (!/^[0-9a-f]{64}$/i.test(tokenHash)) {
            throw new Error('DevtoolsAuthGate requires a 64-char hex SHA-256 token hash');
        }
        return new DevtoolsAuthGate(tokenHash.toLowerCase());
    }
    /** True iff the presented token authenticates against this gate. */
    authenticate(token) {
        if (typeof token !== 'string' || token.length === 0)
            return false;
        return hashesEqual(hashToken(token), this.tokenHash);
    }
    /**
     * Decide whether an access attempt is permitted. Authentication is the first
     * gate; the read-only policy is the second. The decision is deterministic and
     * fails closed for any unrecognised input.
     */
    authorize(attempt) {
        if (!this.authenticate(attempt.token)) {
            return {
                allowed: false,
                code: 'UNAUTHENTICATED',
                status: STATUS_FOR_DECISION.UNAUTHENTICATED,
                reason: 'A valid devtools access token is required.',
            };
        }
        if (!isSafeMethod(attempt.method)) {
            return {
                allowed: false,
                code: 'READ_ONLY',
                status: STATUS_FOR_DECISION.READ_ONLY,
                reason: `The devtools are read-only; ${String(attempt.method).toUpperCase()} is not permitted against the inspected app.`,
            };
        }
        return { allowed: true, code: 'ALLOWED', status: STATUS_FOR_DECISION.ALLOWED };
    }
    /** Convenience: authorize directly from an `Authorization` header value. */
    authorizeHeader(authorization, method) {
        return this.authorize({ token: parseBearer(authorization), method });
    }
}
//# sourceMappingURL=auth.js.map