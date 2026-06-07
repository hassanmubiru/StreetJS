// src/platform/plugins/official/twilio.ts
// Official reference plugin: Twilio SMS. Deterministic, offline-verifiable
// request building (HTTP Basic auth + form-encoded body) for the Twilio REST API.

import { request as httpsRequest } from 'node:https';
import { PluginModule, type SandboxedApp } from '../sdk.js';
import { PluginError, type PluginManifest } from '../host.js';
import type { MiddlewareFn } from '../../../core/types.js';

export const TWILIO_PLUGIN_NAME = 'street-plugin-twilio';
export const TWILIO_PLUGIN_VERSION = '1.0.0';

export interface TwilioPluginConfig { accountSid: string; authToken: string; defaultFrom?: string; stateKey?: string; }
export interface TwilioHttpRequest { method: 'POST'; url: string; headers: Record<string, string>; body: string; }
export interface SmsMessage { to: string; body: string; from?: string; }

export function twilioPluginManifest(): PluginManifest {
  return {
    name: TWILIO_PLUGIN_NAME, version: TWILIO_PLUGIN_VERSION,
    capabilities: ['sms', 'notifications', 'twilio'], permissions: ['net', 'secrets', 'middleware'],
  };
}

export function validateTwilioConfig(input: unknown): TwilioPluginConfig {
  if (typeof input !== 'object' || input === null) throw new PluginError('Twilio plugin config must be an object');
  const o = input as Record<string, unknown>;
  for (const k of ['accountSid', 'authToken']) {
    if (typeof o[k] !== 'string' || (o[k] as string).trim() === '') throw new PluginError(`Twilio plugin config: "${k}" is required and must be a non-empty string`);
  }
  for (const k of ['defaultFrom', 'stateKey']) {
    if (o[k] !== undefined && typeof o[k] !== 'string') throw new PluginError(`Twilio plugin config: "${k}" must be a string`);
  }
  return {
    accountSid: o['accountSid'] as string, authToken: o['authToken'] as string,
    ...(o['defaultFrom'] !== undefined ? { defaultFrom: o['defaultFrom'] as string } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
  };
}

export class TwilioClient {
  constructor(private readonly config: TwilioPluginConfig) {}

  /** Build a Twilio "create message" request (Basic auth + form body). */
  buildSendSmsRequest(msg: SmsMessage): TwilioHttpRequest {
    const from = msg.from ?? this.config.defaultFrom;
    if (!from) throw new PluginError('Twilio: no "from" number (set message.from or config.defaultFrom)');
    if (!msg.to) throw new PluginError('Twilio: message "to" is required');
    if (!msg.body) throw new PluginError('Twilio: message "body" is required');
    const basic = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    const form = new URLSearchParams({ To: msg.to, From: from, Body: msg.body });
    return {
      method: 'POST',
      url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.config.accountSid)}/Messages.json`,
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    };
  }

  async send(msg: SmsMessage): Promise<number> {
    const r = this.buildSendSmsRequest(msg); const u = new URL(r.url);
    return new Promise<number>((resolve, reject) => {
      const req = httpsRequest({ method: r.method, hostname: u.hostname, path: u.pathname, headers: { ...r.headers, 'content-length': Buffer.byteLength(r.body).toString() } },
        (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); });
      req.once('error', reject); req.end(r.body);
    });
  }
}

export class TwilioPlugin extends PluginModule {
  readonly name = TWILIO_PLUGIN_NAME;
  readonly version = TWILIO_PLUGIN_VERSION;
  private readonly raw: unknown;
  private config: TwilioPluginConfig | null = null;
  private client: TwilioClient | null = null;
  constructor(config: unknown) { super(); this.raw = config; }
  async onInstall(): Promise<void> { this.config = validateTwilioConfig(this.raw); }
  async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config(); this.client = new TwilioClient(cfg);
    const stateKey = cfg.stateKey ?? 'sms'; const client = this.client;
    const mw: MiddlewareFn = async (ctx, next) => { (ctx.state as Record<string, unknown>)[stateKey] = client; await next(); };
    app.use(mw);
  }
  async onUnload(): Promise<void> { this.client = null; }
  get sms(): TwilioClient { if (!this.client) throw new PluginError('Twilio plugin is not loaded'); return this.client; }
  private _config(): TwilioPluginConfig { if (!this.config) this.config = validateTwilioConfig(this.raw); return this.config; }
}
