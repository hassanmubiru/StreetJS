// src/platform/plugins/official/stripe.ts
// Official reference plugin: Stripe payments. Deterministic, offline-verifiable
// request building (bearer auth + form-encoded body) for the Stripe REST API.

import { request as httpsRequest } from 'node:https';
import { PluginModule, type SandboxedApp } from '../sdk.js';
import { PluginError, type PluginManifest } from '../host.js';
import type { MiddlewareFn } from '../../../core/types.js';

export const STRIPE_PLUGIN_NAME = 'street-plugin-stripe';
export const STRIPE_PLUGIN_VERSION = '1.0.0';

export interface StripePluginConfig { apiKey: string; stateKey?: string; }
export interface StripeHttpRequest { method: 'POST'; url: string; headers: Record<string, string>; body: string; }

export function stripePluginManifest(): PluginManifest {
  return {
    name: STRIPE_PLUGIN_NAME, version: STRIPE_PLUGIN_VERSION,
    capabilities: ['payments', 'billing', 'stripe'], permissions: ['net', 'secrets', 'middleware'],
  };
}

export function validateStripeConfig(input: unknown): StripePluginConfig {
  if (typeof input !== 'object' || input === null) throw new PluginError('Stripe plugin config must be an object');
  const o = input as Record<string, unknown>;
  if (typeof o['apiKey'] !== 'string' || o['apiKey'].trim() === '') {
    throw new PluginError('Stripe plugin config: "apiKey" is required and must be a non-empty string');
  }
  if (o['stateKey'] !== undefined && typeof o['stateKey'] !== 'string') throw new PluginError('Stripe plugin config: "stateKey" must be a string');
  return { apiKey: o['apiKey'], ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}) };
}

export class StripeClient {
  constructor(private readonly config: StripePluginConfig) {}

  /** Build a Stripe API POST request (bearer auth + x-www-form-urlencoded). */
  buildRequest(resource: string, params: Record<string, string | number>): StripeHttpRequest {
    if (!resource || resource.includes('..')) throw new PluginError('Stripe: invalid resource');
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) form.append(k, String(v));
    return {
      method: 'POST',
      url: `https://api.stripe.com/v1/${resource.replace(/^\//, '')}`,
      headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    };
  }

  /** Build a PaymentIntent creation request. */
  buildCreatePaymentIntent(amount: number, currency: string): StripeHttpRequest {
    if (!Number.isInteger(amount) || amount <= 0) throw new PluginError('Stripe: amount must be a positive integer (minor units)');
    return this.buildRequest('payment_intents', { amount, currency });
  }

  async post(resource: string, params: Record<string, string | number>): Promise<number> {
    const r = this.buildRequest(resource, params);
    const u = new URL(r.url);
    return new Promise<number>((resolve, reject) => {
      const req = httpsRequest({ method: r.method, hostname: u.hostname, path: u.pathname, headers: { ...r.headers, 'content-length': Buffer.byteLength(r.body).toString() } },
        (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
      req.once('error', reject); req.end(r.body);
    });
  }
}

export class StripePlugin extends PluginModule {
  readonly name = STRIPE_PLUGIN_NAME;
  readonly version = STRIPE_PLUGIN_VERSION;
  private readonly raw: unknown;
  private config: StripePluginConfig | null = null;
  private client: StripeClient | null = null;
  constructor(config: unknown) { super(); this.raw = config; }
  async onInstall(): Promise<void> { this.config = validateStripeConfig(this.raw); }
  async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config(); this.client = new StripeClient(cfg);
    const stateKey = cfg.stateKey ?? 'stripe'; const client = this.client;
    const mw: MiddlewareFn = async (ctx, next) => { (ctx.state as Record<string, unknown>)[stateKey] = client; await next(); };
    app.use(mw);
  }
  async onUnload(): Promise<void> { this.client = null; }
  get payments(): StripeClient { if (!this.client) throw new PluginError('Stripe plugin is not loaded'); return this.client; }
  private _config(): StripePluginConfig { if (!this.config) this.config = validateStripeConfig(this.raw); return this.config; }
}
