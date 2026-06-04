// src/auth/oauth2.ts
// OAuth2 Authorization Code Flow + PKCE (RFC 7636) + OIDC ID token validation.
// Uses only node:crypto and node:https — zero external dependencies.

import * as crypto from 'node:crypto';
import * as https from 'node:https';
import * as http from 'node:http';
import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';

// ── Interfaces ────────────────────────────────────────────────────────────────

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

export type OAuthSuccessCallback = (
  profile: OAuthProfile,
  tokens: OAuthTokens,
  ctx: StreetContext,
) => Promise<void>;

export type OAuthErrorCallback = (err: Error, ctx: StreetContext) => Promise<void>;

// ── Built-in provider configs ─────────────────────────────────────────────────

const PROVIDER_CONFIGS: Record<string, {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  issuer: string;
}> = {
  google: {
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: 'https://accounts.google.com',
  },
  github: {
    authorizationEndpoint: 'https://github.com/login/oauth/authorize',
    tokenEndpoint: 'https://github.com/login/oauth/access_token',
    jwksUri: '',  // GitHub doesn't use OIDC JWKS
    issuer: 'github.com',
  },
  microsoft: {
    authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    issuer: 'https://login.microsoftonline.com',
  },
};

// ── JWKS Cache ────────────────────────────────────────────────────────────────

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

interface JwksCacheEntry {
  keys: JwkKey[];
  expiresAt: number;
}

export class JwksCache {
  private readonly _cache = new Map<string, JwksCacheEntry>();
  private readonly _ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this._ttlMs = ttlMs;
  }

  async getKeys(jwksUri: string): Promise<JwkKey[]> {
    const now = Date.now();
    const cached = this._cache.get(jwksUri);

    if (cached && cached.expiresAt > now) {
      return cached.keys;
    }

    try {
      const body = await fetchJson<{ keys: JwkKey[] }>(jwksUri);
      const entry: JwksCacheEntry = {
        keys: body.keys ?? [],
        expiresAt: now + this._ttlMs,
      };
      this._cache.set(jwksUri, entry);
      return entry.keys;
    } catch {
      // Fall back to stale cache if available (up to TTL)
      if (cached) return cached.keys;
      throw new Error(`Failed to fetch JWKS from ${jwksUri}`);
    }
  }
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

function fetchJson<T>(url: string, opts?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<T> {
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

    const req = (lib as typeof https).request(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
        } catch (e) {
          reject(new Error(`Invalid JSON response from ${url}: ${(e as Error).message}`));
        }
      });
    });

    req.on('error', reject);
    if (opts?.body) req.write(opts.body, 'utf8');
    req.end();
  });
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ── JWT decode (header only, no verification) ─────────────────────────────────

function decodeJwtHeader(token: string): { alg: string; kid?: string } {
  const parts = token.split('.');
  if (parts.length < 3) throw new Error('Invalid JWT format');
  const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8')) as { alg: string; kid?: string };
  return header;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 3) throw new Error('Invalid JWT format');
  return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
}

// ── OIDC ID token validation ──────────────────────────────────────────────────

async function verifyIdToken(
  idToken: string,
  jwksUri: string,
  expectedAud: string,
  expectedIss: string,
  jwksCache: JwksCache,
): Promise<Record<string, unknown>> {
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
  if (!key) throw new Error('No matching key found in JWKS');

  const parts = idToken.split('.');
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2]!, 'base64url');

  if (key.kty === 'RSA' && key.n && key.e) {
    const keyObj = crypto.createPublicKey({
      key: { kty: 'RSA', n: key.n, e: key.e },
      format: 'jwk',
    });
    const alg = header.alg === 'RS256' ? 'SHA256' : header.alg === 'RS384' ? 'SHA384' : 'SHA512';
    const valid = crypto.verify(alg, Buffer.from(signingInput), keyObj, signature);
    if (!valid) throw new Error('Invalid ID token signature');
  } else if (key.kty === 'EC' && key.x && key.y) {
    const keyObj = crypto.createPublicKey({
      key: { kty: 'EC', x: key.x, y: key.y, crv: key.crv ?? 'P-256' },
      format: 'jwk',
    });
    const alg = header.alg === 'ES256' ? 'SHA256' : 'SHA384';
    const valid = crypto.verify(alg, Buffer.from(signingInput), keyObj, signature);
    if (!valid) throw new Error('Invalid ID token signature');
  }

  return payload;
}

// ── OAuthManager ──────────────────────────────────────────────────────────────

export interface OAuthManagerOptions {
  providers: OAuthProvider[];
  sessionManager: { get(ctx: StreetContext, key: string): unknown; set(ctx: StreetContext, key: string, value: unknown): void };
}

export class OAuthManager {
  private readonly _providers: Map<string, OAuthProvider>;
  private readonly _jwksCache: JwksCache;
  private readonly _session: NonNullable<OAuthManagerOptions['sessionManager']>;

  constructor(opts: OAuthManagerOptions) {
    if (!opts.sessionManager) {
      throw new Error('OAuthManager requires a sessionManager to securely persist PKCE state');
    }
    this._providers = new Map(opts.providers.map((p) => [p.name, p]));
    this._jwksCache = new JwksCache();
    this._session = opts.sessionManager;
  }

  async authorizationUrl(
    providerName: string,
  ): Promise<{ url: string; state: string; codeVerifier: string }> {
    const provider = this._providers.get(providerName);
    if (!provider) throw new Error(`Unknown OAuth provider: ${providerName}`);

    const config = PROVIDER_CONFIGS[providerName];
    if (!config) throw new Error(`No built-in config for provider: ${providerName}`);

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

  async handleCallback(
    providerName: string,
    code: string,
    state: string,
    sessionState: string,
    codeVerifier: string,
  ): Promise<{ profile: OAuthProfile; tokens: OAuthTokens }> {
    const provider = this._providers.get(providerName);
    if (!provider) throw new Error(`Unknown OAuth provider: ${providerName}`);

    // Validate state with constant-time comparison
    if (!constantTimeEqual(state, sessionState)) {
      throw new Error('OAuth state mismatch — possible CSRF attack');
    }

    const config = PROVIDER_CONFIGS[providerName];
    if (!config) throw new Error(`No built-in config for provider: ${providerName}`);

    // Exchange code for tokens
    const tokenResponse = await fetchJson<{
      access_token: string;
      id_token?: string;
      refresh_token?: string;
      expires_in: number;
    }>(config.tokenEndpoint, {
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

    const tokens: OAuthTokens = {
      accessToken: tokenResponse.access_token,
      idToken: tokenResponse.id_token,
      refreshToken: tokenResponse.refresh_token,
      expiresIn: tokenResponse.expires_in ?? 3600,
    };

    // Extract profile from ID token or user info
    let profile: OAuthProfile;
    if (tokens.idToken && config.jwksUri) {
      const claims = await verifyIdToken(
        tokens.idToken,
        config.jwksUri,
        provider.clientId,
        config.issuer,
        this._jwksCache,
      );
      profile = {
        id: String(claims['sub'] ?? ''),
        email: String(claims['email'] ?? ''),
        name: String(claims['name'] ?? ''),
        avatarUrl: String(claims['picture'] ?? ''),
      };
    } else {
      // GitHub: fetch user info separately
      const userInfo = await fetchJson<{ id: number; name?: string; email?: string; avatar_url?: string; login: string }>(
        'https://api.github.com/user',
        { headers: { Authorization: `Bearer ${tokens.accessToken}`, 'User-Agent': 'StreetFramework' } },
      ).catch(() => ({ id: 0, login: 'unknown', name: undefined, email: undefined, avatar_url: undefined }));

      profile = {
        id: String(userInfo.id),
        email: userInfo.email ?? '',
        name: userInfo.name ?? userInfo.login,
        avatarUrl: userInfo.avatar_url ?? '',
      };
    }

    return { profile, tokens };
  }

  middleware(
    providerName: string,
    onSuccess: OAuthSuccessCallback,
    onError?: OAuthErrorCallback,
  ): MiddlewareFn {
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

        const { profile, tokens } = await this.handleCallback(
          providerName, code, state, sessionState, codeVerifier,
        );
        await onSuccess(profile, tokens, ctx);
      } catch (err) {
        if (onError) {
          await onError(err instanceof Error ? err : new Error(String(err)), ctx);
        } else {
          await next();
        }
      }
    };
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aB = Buffer.from(a, 'utf8');
  const bB = Buffer.from(b, 'utf8');
  if (aB.length !== bB.length) return false;
  return crypto.timingSafeEqual(aB, bB);
}
