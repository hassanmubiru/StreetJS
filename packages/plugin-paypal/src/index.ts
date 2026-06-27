// packages/plugin-paypal/src/index.ts
// Official StreetJS plugin: PayPal Orders v2.
//
// Dependency-free: request construction (OAuth2 client-credentials token +
// JSON order creation/capture) is pure and offline-verifiable; the network send
// uses node:https. Mirrors the official Stripe plugin's design.

import { PluginModule, PluginError, type SandboxedApp, type PluginManifest } from 'streetjs';
import { request as httpsRequest } from 'node:https';
import { createVerify, createPublicKey, X509Certificate } from 'node:crypto';

export const PAYPAL_PLUGIN_NAME = 'street-plugin-paypal';
export const PAYPAL_PLUGIN_VERSION = '1.0.0';

/** Default outbound-request timeout (ms) when config omits `timeoutMs`. */
export const PAYPAL_DEFAULT_TIMEOUT_MS = 30_000;

/** Configuration schema for the PayPal plugin. */
export interface PayPalPluginConfig {
  clientId: string;
  clientSecret: string;
  /** 'sandbox' (default) or 'live'. */
  environment?: 'sandbox' | 'live';
  /** State key under which the client is injected. Default 'paypal'. */
  stateKey?: string;
  /** Outbound HTTP timeout in ms (default 30000). */
  timeoutMs?: number;
}

/** A fully-described outbound HTTPS request (pure, offline-verifiable). */
export interface PayPalHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function payPalPluginManifest(): PluginManifest {
  return {
    name: PAYPAL_PLUGIN_NAME,
    version: PAYPAL_PLUGIN_VERSION,
    capabilities: ['payments', 'paypal'],
    permissions: ['net', 'secrets', 'middleware'],
  };
}

export function validatePayPalConfig(input: unknown): PayPalPluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('PayPal plugin config must be an object');
  }
  const o = input as Record<string, unknown>;
  if (typeof o['clientId'] !== 'string' || (o['clientId'] as string).trim() === '') {
    throw new PluginError('PayPal plugin config: "clientId" is required and must be a non-empty string');
  }
  if (typeof o['clientSecret'] !== 'string' || (o['clientSecret'] as string).trim() === '') {
    throw new PluginError('PayPal plugin config: "clientSecret" is required and must be a non-empty string');
  }
  if (o['environment'] !== undefined && o['environment'] !== 'sandbox' && o['environment'] !== 'live') {
    throw new PluginError('PayPal plugin config: "environment" must be "sandbox" or "live"');
  }
  if (o['stateKey'] !== undefined && typeof o['stateKey'] !== 'string') {
    throw new PluginError('PayPal plugin config: "stateKey" must be a string');
  }
  if (o['timeoutMs'] !== undefined && (typeof o['timeoutMs'] !== 'number' || !Number.isInteger(o['timeoutMs']) || o['timeoutMs'] <= 0)) {
    throw new PluginError('PayPal plugin config: "timeoutMs" must be a positive integer (milliseconds)');
  }
  return {
    clientId: o['clientId'] as string,
    clientSecret: o['clientSecret'] as string,
    ...(o['environment'] !== undefined ? { environment: o['environment'] as 'sandbox' | 'live' } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
    ...(o['timeoutMs'] !== undefined ? { timeoutMs: o['timeoutMs'] as number } : {}),
  };
}

/** The REST base URL for the configured environment. */
export function baseUrl(environment: 'sandbox' | 'live' = 'sandbox'): string {
  return environment === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

/** Build the OAuth2 client-credentials token request (Basic auth, form body). */
export function buildTokenRequest(cfg: PayPalPluginConfig): PayPalHttpRequest {
  const env = cfg.environment ?? 'sandbox';
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`, 'utf8').toString('base64');
  return {
    method: 'POST',
    url: `${baseUrl(env)}/v1/oauth2/token`,
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  };
}

/** Build a create-order request (bearer token, JSON body). */
export function buildCreateOrderRequest(
  accessToken: string,
  order: { amount: string; currency: string; intent?: 'CAPTURE' | 'AUTHORIZE' },
  environment: 'sandbox' | 'live' = 'sandbox',
): PayPalHttpRequest {
  if (!/^\d+(\.\d{1,2})?$/.test(order.amount)) {
    throw new PluginError(`PayPal: invalid amount "${order.amount}" (expected e.g. "20.00")`);
  }
  if (!/^[A-Z]{3}$/.test(order.currency)) {
    throw new PluginError(`PayPal: invalid currency "${order.currency}" (expected ISO-4217, e.g. "USD")`);
  }
  const body = JSON.stringify({
    intent: order.intent ?? 'CAPTURE',
    purchase_units: [{ amount: { currency_code: order.currency, value: order.amount } }],
  });
  return {
    method: 'POST',
    url: `${baseUrl(environment)}/v2/checkout/orders`,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body,
  };
}

/** Minimal dependency-free PayPal client over node:https. */
export class PayPalClient {
  constructor(private readonly config: PayPalPluginConfig) {}

  private send(req: PayPalHttpRequest): Promise<{ status: number; body: string }> {
    const u = new URL(req.url);
    const timeoutMs = this.config.timeoutMs ?? PAYPAL_DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const r = httpsRequest(
        { method: req.method, hostname: u.hostname, path: u.pathname + u.search, timeout: timeoutMs, headers: req.headers },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      r.on('error', (e) => reject(new PluginError(`PayPal request failed: ${e.message}`)));
      r.once('timeout', () => r.destroy(new PluginError(`PayPal request timed out after ${timeoutMs}ms`)));
      r.end(req.body);
    });
  }

  /** Fetch an OAuth2 access token. */
  async accessToken(): Promise<string> {
    const { status, body } = await this.send(buildTokenRequest(this.config));
    if (status < 200 || status >= 300) throw new PluginError(`PayPal token request returned ${status}`);
    return (JSON.parse(body) as { access_token: string }).access_token;
  }

  /** Create an order, fetching a token first. */
  async createOrder(order: { amount: string; currency: string; intent?: 'CAPTURE' | 'AUTHORIZE' }): Promise<unknown> {
    const token = await this.accessToken();
    const { status, body } = await this.send(buildCreateOrderRequest(token, order, this.config.environment ?? 'sandbox'));
    if (status < 200 || status >= 300) throw new PluginError(`PayPal create-order returned ${status}`);
    return JSON.parse(body);
  }
}

export class PayPalPlugin extends PluginModule {
  readonly name = PAYPAL_PLUGIN_NAME;
  readonly version = PAYPAL_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: PayPalPluginConfig | null = null;
  private client: PayPalClient | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  override async onInstall(): Promise<void> {
    this.config = validatePayPalConfig(this.raw);
  }

  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.client = new PayPalClient(cfg);
    const stateKey = cfg.stateKey ?? 'paypal';
    const client = this.client;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = client;
      await next();
    });
  }

  get payments(): PayPalClient {
    if (!this.client) throw new PluginError('PayPal plugin is not loaded');
    return this.client;
  }

  private _config(): PayPalPluginConfig {
    if (!this.config) this.config = validatePayPalConfig(this.raw);
    return this.config;
  }
}
