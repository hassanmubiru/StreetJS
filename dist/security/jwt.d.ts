export interface JwtPayload {
    sub: string;
    email?: string;
    roles?: string[];
    iat?: number;
    exp?: number;
    [key: string]: unknown;
}
export interface JwtOptions {
    expiresInSeconds?: number;
    issuer?: string;
    audience?: string;
}
export declare class JwtService {
    private readonly secret;
    constructor(secret: string);
    /** Sign a payload and return a JWT string */
    sign(payload: JwtPayload, options?: JwtOptions): string;
    /** Verify a JWT string and return its decoded payload, or null if invalid */
    verify(token: string, options?: JwtOptions): JwtPayload | null;
    /** Decode a JWT without verification (for inspection only) */
    decode(token: string): JwtPayload | null;
    private _sign;
}
//# sourceMappingURL=jwt.d.ts.map