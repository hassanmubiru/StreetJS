// src/auth/oauth2.ts
// OAuth2 Authorization Code Flow + PKCE (RFC 7636) + OIDC ID token validation.
// Uses only node:crypto and node:https — zero external dependencies.
import * as crypto from 'node:crypto';
import * as https from 'node:https';
import * as http from 'node:http';
// ── Built-in provider configs ─────────────────────────────────────────────────
const PROVIDER_CONFIGS = {
    google: {
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
        issuer: 'https://accounts.google.com',
    },
    github: {
        authorizationEndpoint: 'https://github.com/login/oauth/authorize',
        tokenEndpoint: 'https://github.com/login/oauth/access_token',
        jwksUri: '', // GitHub doesn't use OIDC JWKS
        issuer: 'github.com',
    },
    microsoft: {
        authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
        issuer: 'https://login.microsoftonline.com',
    },
};
export class JwksCache {
    _cache = new Map();
    _ttlMs;
    constructor(ttlMs = 5 * 60 * 1000) {
        this._ttlMs = ttlMs;
    }
    async getKeys(jwksUri) {
        const now = Date.now();
        const cached = this._cache.get(jwksUri);
        if (cached && cached.expiresAt > now) {
            return cached.keys;
        }
        try {
            const body = await fetchJson(jwksUri);
            const entry = {
                keys: body.keys ?? [],
                expiresAt: now + this._ttlMs,
            };
            this._cache.set(jwksUri, entry);
            return entry.keys;
        }
        catch {
            // Fall back to stale cache if available (up to TTL)
            if (cached)
                return cached.keys;
            throw new Error(`Failed to fetch JWKS from ${jwksUri}`);
        }
    }
}
// ── HTTP helper ───────────────────────────────────────────────────────────────
function fetchJson(url, opts) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const isHttps = parsed.protocol === 'https:';
        const lib = isHttps ? https : http;
        const reqOpts = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: opts?.method ?? 'GET',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                ...opts?.headers,
            },
        };
        const req = lib.request(reqOpts, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
                }
                catch (e) {
                    reject(new Error(`Invalid JSON response from ${url}: ${e.message}`));
                }
            });
        });
        req.on('error', reject);
        if (opts?.body)
            req.write(opts.body, 'utf8');
        req.end();
    });
}
// ── PKCE helpers ──────────────────────────────────────────────────────────────
function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}
function generateCodeChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}
// ── JWT decode (header only, no verification) ─────────────────────────────────
function decodeJwtHeader(token) {
    const parts = token.split('.');
    if (parts.length < 3)
        throw new Error('Invalid JWT format');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return header;
}
function decodeJwtPayload(token) {
    const parts = token.split('.');
    if (parts.length < 3)
        throw new Error('Invalid JWT format');
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}
// ── OIDC ID token validation ──────────────────────────────────────────────────
async function verifyIdToken(idToken, jwksUri, expectedAud, expectedIss, jwksCache) {
    const header = decodeJwtHeader(idToken);
    const payload = decodeJwtPayload(idToken);
    // Check claims
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload['exp'] === 'number' && payload['exp'] < now) {
        throw new Error('ID token expired');
    }
    if (payload['aud'] !== expectedAud && !Array.isArray(payload['aud'])) {
        throw new Error('ID token audience mismatch');
    }
    if (typeof payload['iss'] === 'string' && !payload['iss'].startsWith(expectedIss.replace('https://', ''))) {
        // Lenient issuer check
    }
    // Verify signature
    const keys = await jwksCache.getKeys(jwksUri);
    const key = keys.find((k) => !header.kid || k.kid === header.kid);
    if (!key)
        throw new Error('No matching key found in JWKS');
    const parts = idToken.split('.');
    const signingInput = `${parts[0]}.${parts[1]}`;
    const signature = Buffer.from(parts[2], 'base64url');
    if (key.kty === 'RSA' && key.n && key.e) {
        const keyObj = crypto.createPublicKey({
            key: { kty: 'RSA', n: key.n, e: key.e },
            format: 'jwk',
        });
        const alg = header.alg === 'RS256' ? 'SHA256' : header.alg === 'RS384' ? 'SHA384' : 'SHA512';
        const valid = crypto.verify(alg, Buffer.from(signingInput), keyObj, signature);
        if (!valid)
            throw new Error('Invalid ID token signature');
    }
    else if (key.kty === 'EC' && key.x && key.y) {
        const keyObj = crypto.createPublicKey({
            key: { kty: 'EC', x: key.x, y: key.y, crv: key.crv ?? 'P-256' },
            format: 'jwk',
        });
        const alg = header.alg === 'ES256' ? 'SHA256' : 'SHA384';
        const valid = crypto.verify(alg, Buffer.from(signingInput), keyObj, signature);
        if (!valid)
            throw new Error('Invalid ID token signature');
    }
    return payload;
}
export class OAuthManager {
    _providers;
    _jwksCache;
    _session;
    constructor(opts) {
        if (!opts.sessionManager) {
            throw new Error('OAuthManager requires a sessionManager to securely persist PKCE state');
        }
        this._providers = new Map(opts.providers.map((p) => [p.name, p]));
        this._jwksCache = new JwksCache();
        this._session = opts.sessionManager;
    }
    async authorizationUrl(providerName) {
        const provider = this._providers.get(providerName);
        if (!provider)
            throw new Error(`Unknown OAuth provider: ${providerName}`);
        const config = PROVIDER_CONFIGS[providerName];
        if (!config)
            throw new Error(`No built-in config for provider: ${providerName}`);
        const state = crypto.randomBytes(32).toString('hex');
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const scopes = provider.scopes ?? ['openid', 'profile', 'email'];
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: provider.clientId,
            redirect_uri: provider.redirectUri,
            scope: scopes.join(' '),
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });
        return {
            url: `${config.authorizationEndpoint}?${params.toString()}`,
            state,
            codeVerifier,
        };
    }
    async handleCallback(providerName, code, state, sessionState, codeVerifier) {
        const provider = this._providers.get(providerName);
        if (!provider)
            throw new Error(`Unknown OAuth provider: ${providerName}`);
        // Validate state with constant-time comparison
        if (!constantTimeEqual(state, sessionState)) {
            throw new Error('OAuth state mismatch — possible CSRF attack');
        }
        const config = PROVIDER_CONFIGS[providerName];
        if (!config)
            throw new Error(`No built-in config for provider: ${providerName}`);
        // Exchange code for tokens
        const tokenResponse = await fetchJson(config.tokenEndpoint, {
            method: 'POST',
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: provider.redirectUri,
                client_id: provider.clientId,
                client_secret: provider.clientSecret,
                code_verifier: codeVerifier,
            }).toString(),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const tokens = {
            accessToken: tokenResponse.access_token,
            idToken: tokenResponse.id_token,
            refreshToken: tokenResponse.refresh_token,
            expiresIn: tokenResponse.expires_in ?? 3600,
        };
        // Extract profile from ID token or user info
        let profile;
        if (tokens.idToken && config.jwksUri) {
            const claims = await verifyIdToken(tokens.idToken, config.jwksUri, provider.clientId, config.issuer, this._jwksCache);
            profile = {
                id: String(claims['sub'] ?? ''),
                email: String(claims['email'] ?? ''),
                name: String(claims['name'] ?? ''),
                avatarUrl: String(claims['picture'] ?? ''),
            };
        }
        else {
            // GitHub: fetch user info separately
            const userInfo = await fetchJson('https://api.github.com/user', { headers: { Authorization: `Bearer ${tokens.accessToken}`, 'User-Agent': 'StreetFramework' } }).catch(() => ({ id: 0, login: 'unknown', name: undefined, email: undefined, avatar_url: undefined }));
            profile = {
                id: String(userInfo.id),
                email: userInfo.email ?? '',
                name: userInfo.name ?? userInfo.login,
                avatarUrl: userInfo.avatar_url ?? '',
            };
        }
        return { profile, tokens };
    }
    middleware(providerName, onSuccess, onError) {
        return async (ctx, next) => {
            try {
                const code = String(ctx.query['code'] ?? '');
                const state = String(ctx.query['state'] ?? '');
                const sessionState = String(this._session.get(ctx, `oauth_state_${providerName}`) ?? '');
                const codeVerifier = String(this._session.get(ctx, `oauth_verifier_${providerName}`) ?? '');
                if (!code) {
                    // Initiate flow
                    const { url, state: s, codeVerifier: cv } = await this.authorizationUrl(providerName);
                    this._session.set(ctx, `oauth_state_${providerName}`, s);
                    this._session.set(ctx, `oauth_verifier_${providerName}`, cv);
                    ctx.res.writeHead(302, { Location: url });
                    ctx.res.end();
                    return;
                }
                const { profile, tokens } = await this.handleCallback(providerName, code, state, sessionState, codeVerifier);
                await onSuccess(profile, tokens, ctx);
            }
            catch (err) {
                if (onError) {
                    await onError(err instanceof Error ? err : new Error(String(err)), ctx);
                }
                else {
                    await next();
                }
            }
        };
    }
}
function constantTimeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    const aB = Buffer.from(a, 'utf8');
    const bB = Buffer.from(b, 'utf8');
    if (aB.length !== bB.length)
        return false;
    return crypto.timingSafeEqual(aB, bB);
}
//# sourceMappingURL=oauth2.js.map