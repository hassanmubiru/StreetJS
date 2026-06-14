// packages/plugin-firebase/src/index.ts
// Official StreetJS plugin: Firebase Auth (Identity Toolkit) REST.
//
// Dependency-free: request construction (Identity Toolkit endpoints with the
// Web API key as a query param and JSON bodies) is pure and offline-verifiable;
// the network send uses node:https. Covers email/password sign-up, sign-in, and
// token lookup.

import { PluginModule, PluginError, type SandboxedApp, type PluginManifest } from 'streetjs';
import { request as httpsRequest } from 'node:https';

export const FIREBASE_PLUGIN_NAME = 'street-plugin-firebase';
export const FIREBASE_PLUGIN_VERSION = '1.0.0';

export interface FirebasePluginConfig {
  /** Firebase Web API key. */
  apiKey: string;
  /** State key under which the client is injected. Default 'firebase'. */
  stateKey?: string;
}

export interface FirebaseHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

const IDENTITY_BASE = 'https://identitytoolkit.googleapis.com/v1/accounts';

export function firebasePluginManifest(): PluginManifest {
  return {
    name: FIREBASE_PLUGIN_NAME,
    version: FIREBASE_PLUGIN_VERSION,
    capabilities: ['auth', 'identity', 'firebase'],
    permissions: ['net', 'secrets', 'middleware'],
  };
}

export function validateFirebaseConfig(input: unknown): FirebasePluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('Firebase plugin config must be an object');
  }
  const o = input as Record<string, unknown>;
  if (typeof o['apiKey'] !== 'string' || (o['apiKey'] as string).trim() === '') {
    throw new PluginError('Firebase plugin config: "apiKey" is required and must be a non-empty string');
  }
  if (o['stateKey'] !== undefined && typeof o['stateKey'] !== 'string') {
    throw new PluginError('Firebase plugin config: "stateKey" must be a string');
  }
  return {
    apiKey: o['apiKey'] as string,
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
  };
}

function jsonHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', accept: 'application/json' };
}

function endpoint(cfg: FirebasePluginConfig, op: string, body: unknown): FirebaseHttpRequest {
  return {
    method: 'POST',
    url: `${IDENTITY_BASE}:${op}?key=${encodeURIComponent(cfg.apiKey)}`,
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  };
}

function assertEmail(email: string): void {
  // Linear, non-backtracking validation (no ReDoS): exactly one '@', non-empty
  // local and domain, a dot in the domain, and no whitespace anywhere.
  if (typeof email !== 'string' || /\s/.test(email)) throw new PluginError(`Firebase: invalid email "${email}"`);
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@')) throw new PluginError(`Firebase: invalid email "${email}"`);
  const domain = email.slice(at + 1);
  if (domain.length === 0 || !domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) {
    throw new PluginError(`Firebase: invalid email "${email}"`);
  }
}

/** Build an email/password sign-up request. */
export function buildSignUpRequest(cfg: FirebasePluginConfig, email: string, password: string): FirebaseHttpRequest {
  assertEmail(email);
  if (typeof password !== 'string' || password.length < 6) {
    throw new PluginError('Firebase: password must be at least 6 characters');
  }
  return endpoint(cfg, 'signUp', { email, password, returnSecureToken: true });
}

/** Build an email/password sign-in request. */
export function buildSignInRequest(cfg: FirebasePluginConfig, email: string, password: string): FirebaseHttpRequest {
  assertEmail(email);
  if (typeof password !== 'string' || password.length === 0) {
    throw new PluginError('Firebase: password is required');
  }
  return endpoint(cfg, 'signInWithPassword', { email, password, returnSecureToken: true });
}

/** Build an ID-token lookup request (account info). */
export function buildLookupRequest(cfg: FirebasePluginConfig, idToken: string): FirebaseHttpRequest {
  if (typeof idToken !== 'string' || idToken.trim() === '') {
    throw new PluginError('Firebase: "idToken" is required');
  }
  return endpoint(cfg, 'lookup', { idToken });
}

export class FirebaseAuthClient {
  constructor(private readonly config: FirebasePluginConfig) {}

  private send(req: FirebaseHttpRequest): Promise<{ status: number; body: string }> {
    const u = new URL(req.url);
    return new Promise((resolve, reject) => {
      const r = httpsRequest(
        { method: req.method, hostname: u.hostname, path: u.pathname + u.search, headers: req.headers },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      r.on('error', (e) => reject(new PluginError(`Firebase request failed: ${e.message}`)));
      r.end(req.body);
    });
  }

  async signUp(email: string, password: string): Promise<unknown> {
    const { status, body } = await this.send(buildSignUpRequest(this.config, email, password));
    if (status < 200 || status >= 300) throw new PluginError(`Firebase signUp returned ${status}`);
    return JSON.parse(body);
  }

  async signIn(email: string, password: string): Promise<unknown> {
    const { status, body } = await this.send(buildSignInRequest(this.config, email, password));
    if (status < 200 || status >= 300) throw new PluginError(`Firebase signIn returned ${status}`);
    return JSON.parse(body);
  }

  async lookup(idToken: string): Promise<unknown> {
    const { status, body } = await this.send(buildLookupRequest(this.config, idToken));
    if (status < 200 || status >= 300) throw new PluginError(`Firebase lookup returned ${status}`);
    return JSON.parse(body);
  }
}

export class FirebasePlugin extends PluginModule {
  readonly name = FIREBASE_PLUGIN_NAME;
  readonly version = FIREBASE_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: FirebasePluginConfig | null = null;
  private client: FirebaseAuthClient | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  override async onInstall(): Promise<void> {
    this.config = validateFirebaseConfig(this.raw);
  }

  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.client = new FirebaseAuthClient(cfg);
    const stateKey = cfg.stateKey ?? 'firebase';
    const client = this.client;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = client;
      await next();
    });
  }

  get auth(): FirebaseAuthClient {
    if (!this.client) throw new PluginError('Firebase plugin is not loaded');
    return this.client;
  }

  private _config(): FirebasePluginConfig {
    if (!this.config) this.config = validateFirebaseConfig(this.raw);
    return this.config;
  }
}
