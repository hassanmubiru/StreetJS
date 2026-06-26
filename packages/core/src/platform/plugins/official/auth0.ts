// src/platform/plugins/official/auth0.ts
// Official reference plugin: Auth0. Deterministic, offline-verifiable request
// building for the OAuth2 client-credentials token endpoint (JSON body).

import { request as httpsRequest } from 'node:https';
import { PluginModule, type SandboxedApp } from '../sdk.js';
import { PluginError, type PluginManifest } from '../host.js';
import type { MiddlewareFn } from '../../../core/types.js';

export const AUTH0_PLUGIN_NAME = 'street-plugin-auth0';
export const AUTH0_PLUGIN_VERSION = '1.0.0';

/** Default outbound-request timeout (ms) when config omits `timeoutMs`. */
export const AUTH0_DEFAULT_TIMEOUT_MS = 30_000;

export interface Auth0PluginConfig { domain: string; clientId: string; clientSecret: string; audience?: string; stateKey?: string; timeoutMs?: number; }
export interface Auth0HttpRequest { method: 'POST'; url: string; headers: Record<string, string>; body: string; }

export function auth0PluginManifest(): PluginManifest {
  return {
    name: AUTH0_PLUGIN_NAME, version: AUTH0_PLUGIN_VERSION,
    capabilities: ['auth', 'identity', 'auth0'], permissions: ['net', 'secrets', 'middleware'],
  };
}

export function validateAuth0Config(input: unknown): Auth0PluginConfig {
  if (typeof input !== 'object' || input === null) throw new PluginError('Auth0 plugin config must be an object');
  const o = input as Record<string, unknown>;
  for (const k of ['domain', 'clientId', 'clientSecret']) {
    if (typeof o[k] !== 'string' || (o[k] as string).trim() === '') throw new PluginError(`Auth0 plugin config: "${k}" is required and must be a non-empty string`);
  }
  for (const k of ['audience', 'stateKey']) {
    if (o[k] !== undefined && typeof o[k] !== 'string') throw new PluginError(`Auth0 plugin config: "${k}" must be a string`);
  }
  // Normalise domain: strip protocol and trailing slash.
  const domain = (o['domain'] as string).replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    domain, clientId: o['clientId'] as string, clientSecret: o['clientSecret'] as string,
    ...(o['audience'] !== undefined ? { audience: o['audience'] as string } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
  };
}

export class Auth0Client {
  constructor(private readonly config: Auth0PluginConfig) {}

  /** Build the OAuth2 client-credentials token request (JSON body). */
  buildTokenRequest(audience?: string): Auth0HttpRequest {
    const aud = audience ?? this.config.audience;
    if (!aud) throw new PluginError('Auth0: no audience (set buildTokenRequest(audience) or config.audience)');
    const body = {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      audience: aud,
      grant_type: 'client_credentials',
    };
    return {
      method: 'POST',
      url: `https://${this.config.domain}/oauth/token`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  async getToken(audience?: string): Promise<number> {
    const r = this.buildTokenRequest(audience); const u = new URL(r.url);
    return new Promise<number>((resolve, reject) => {
      const req = httpsRequest({ method: r.method, hostname: u.hostname, path: u.pathname, headers: { ...r.headers, 'content-length': Buffer.byteLength(r.body).toString() } },
        (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
      req.once('error', reject); req.end(r.body);
    });
  }
}

export class Auth0Plugin extends PluginModule {
  readonly name = AUTH0_PLUGIN_NAME;
  readonly version = AUTH0_PLUGIN_VERSION;
  private readonly raw: unknown;
  private config: Auth0PluginConfig | null = null;
  private client: Auth0Client | null = null;
  constructor(config: unknown) { super(); this.raw = config; }
  async onInstall(): Promise<void> { this.config = validateAuth0Config(this.raw); }
  async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config(); this.client = new Auth0Client(cfg);
    const stateKey = cfg.stateKey ?? 'auth0'; const client = this.client;
    const mw: MiddlewareFn = async (ctx, next) => { (ctx.state as Record<string, unknown>)[stateKey] = client; await next(); };
    app.use(mw);
  }
  async onUnload(): Promise<void> { this.client = null; }
  get identity(): Auth0Client { if (!this.client) throw new PluginError('Auth0 plugin is not loaded'); return this.client; }
  private _config(): Auth0PluginConfig { if (!this.config) this.config = validateAuth0Config(this.raw); return this.config; }
}
