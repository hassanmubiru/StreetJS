// src/security/jwt.ts
// JWT implementation using HMAC-SHA256 via node:crypto only.
import { createHmac, timingSafeEqual } from 'node:crypto';
const HEADER = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
export class JwtService {
    secret;
    constructor(secret) {
        if (secret.length < 32) {
            throw new Error('JWT secret must be at least 32 characters');
        }
        this.secret = Buffer.from(secret, 'utf8');
    }
    /** Sign a payload and return a JWT string */
    sign(payload, options = {}) {
        const now = Math.floor(Date.now() / 1000);
        const claims = {
            ...payload,
            iat: now,
            ...(options.expiresInSeconds !== undefined ? { exp: now + options.expiresInSeconds } : {}),
            ...(options.issuer ? { iss: options.issuer } : {}),
            ...(options.audience ? { aud: options.audience } : {}),
        };
        const payloadEncoded = base64urlEncode(JSON.stringify(claims));
        const message = `${HEADER}.${payloadEncoded}`;
        const signature = this._sign(message);
        return `${message}.${signature}`;
    }
    /** Verify a JWT string and return its decoded payload, or null if invalid */
    verify(token, options = {}) {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        const [headerB64, payloadB64, sigB64] = parts;
        // Finding 4 fix: verify the header declares exactly HS256 / JWT.
        // This prevents algorithm confusion (e.g. alg:none) and future
        // accidental acceptance of tokens signed with a different algorithm.
        try {
            const header = JSON.parse(base64urlDecode(headerB64));
            if (header['alg'] !== 'HS256' || header['typ'] !== 'JWT')
                return null;
        }
        catch {
            return null;
        }
        const message = `${headerB64}.${payloadB64}`;
        const expectedSig = this._sign(message);
        // Timing-safe comparison
        try {
            const givenSig = Buffer.from(sigB64, 'base64url');
            const expectedSigBuf = Buffer.from(expectedSig, 'base64url');
            if (givenSig.length !== expectedSigBuf.length)
                return null;
            if (!timingSafeEqual(givenSig, expectedSigBuf))
                return null;
        }
        catch {
            return null;
        }
        let payload;
        try {
            payload = JSON.parse(base64urlDecode(payloadB64));
        }
        catch {
            return null;
        }
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp !== undefined && payload.exp < now)
            return null;
        // Finding 4 fix: enforce nbf (not-before) claim
        if (payload.nbf !== undefined && payload.nbf > now)
            return null;
        if (payload.iat !== undefined && payload.iat > now + 60)
            return null; // clock skew
        if (options.issuer && payload.iss !== options.issuer)
            return null;
        if (options.audience && payload.aud !== options.audience)
            return null;
        return payload;
    }
    /** Decode a JWT without verification (for inspection only) */
    decode(token) {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        try {
            return JSON.parse(base64urlDecode(parts[1]));
        }
        catch {
            return null;
        }
    }
    _sign(message) {
        return createHmac('sha256', this.secret)
            .update(message)
            .digest('base64url');
    }
}
function base64urlEncode(str) {
    return Buffer.from(str, 'utf8').toString('base64url');
}
function base64urlDecode(str) {
    return Buffer.from(str, 'base64url').toString('utf8');
}
//# sourceMappingURL=jwt.js.map