import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';
export interface OAuthProvider {
    name: 'google' | 'github' | 'microsoft' | string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes?: string[];
}
export interface OAuthProfile {
    id: string;
    email: string;
    name: string;
    avatarUrl: string;
}
export interface OAuthTokens {
    accessToken: string;
    idToken?: string;
    refreshToken?: string;
    expiresIn: number;
}
export type OAuthSuccessCallback = (profile: OAuthProfile, tokens: OAuthTokens, ctx: StreetContext) => Promise<void>;
export type OAuthErrorCallback = (err: Error, ctx: StreetContext) => Promise<void>;
interface JwkKey {
    kty: string;
    kid: string;
    use?: string;
    n?: string;
    e?: string;
    x?: string;
    y?: string;
    crv?: string;
}
export declare class JwksCache {
    private readonly _cache;
    private readonly _ttlMs;
    constructor(ttlMs?: number);
    getKeys(jwksUri: string): Promise<JwkKey[]>;
}
export interface OAuthManagerOptions {
    providers: OAuthProvider[];
    sessionManager: {
        get(ctx: StreetContext, key: string): unknown;
        set(ctx: StreetContext, key: string, value: unknown): void;
    };
}
export declare class OAuthManager {
    private readonly _providers;
    private readonly _jwksCache;
    private readonly _session;
    constructor(opts: OAuthManagerOptions);
    authorizationUrl(providerName: string): Promise<{
        url: string;
        state: string;
        codeVerifier: string;
    }>;
    handleCallback(providerName: string, code: string, state: string, sessionState: string, codeVerifier: string): Promise<{
        profile: OAuthProfile;
        tokens: OAuthTokens;
    }>;
    middleware(providerName: string, onSuccess: OAuthSuccessCallback, onError?: OAuthErrorCallback): MiddlewareFn;
}
export {};
//# sourceMappingURL=oauth2.d.ts.map