// src/platform/plugins/official/sendgrid.ts
// Official reference plugin: SendGrid v3 email, built on the PluginHost contract.
// The request-building (endpoint, bearer auth, JSON body) is pure and
// offline-verifiable; the network send uses node:https. Dependency-free.

import { request as httpsRequest } from 'node:https';
import { PluginModule, type SandboxedApp } from '../sdk.js';
import { PluginError, type PluginManifest } from '../host.js';
import type { MiddlewareFn } from '../../../core/types.js';

export const SENDGRID_PLUGIN_NAME = 'street-plugin-sendgrid';
export const SENDGRID_PLUGIN_VERSION = '1.0.0';

/** Default outbound-request timeout (ms) when config omits `timeoutMs`. */
export const SENDGRID_DEFAULT_TIMEOUT_MS = 30_000;

export interface SendGridPluginConfig {
  apiKey: string;
  /** Default sender address used when a message omits `from`. */
  defaultFrom?: string;
  /** State key under which the mail client is injected. Default 'mail'. */
  stateKey?: string;
  /** Outbound HTTP timeout in ms (default 30000). */
  timeoutMs?: number;
}

export interface MailMessage {
  to: string;
  subject: string;
  from?: string;
  text?: string;
  html?: string;
}

export interface SendGridRequest {
  method: 'POST';
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Unsigned manifest for the SendGrid plugin (sign via `signManifest`). */
export function sendGridPluginManifest(): PluginManifest {
  return {
    name: SENDGRID_PLUGIN_NAME,
    version: SENDGRID_PLUGIN_VERSION,
    capabilities: ['email', 'notifications', 'sendgrid'],
    permissions: ['net', 'secrets', 'middleware'],
  };
}

/** Validate raw config against the SendGrid plugin schema. */
export function validateSendGridConfig(input: unknown): SendGridPluginConfig {
  if (typeof input !== 'object' || input === null) throw new PluginError('SendGrid plugin config must be an object');
  const o = input as Record<string, unknown>;
  if (typeof o['apiKey'] !== 'string' || o['apiKey'].trim() === '') {
    throw new PluginError('SendGrid plugin config: "apiKey" is required and must be a non-empty string');
  }
  for (const k of ['defaultFrom', 'stateKey']) {
    if (o[k] !== undefined && typeof o[k] !== 'string') throw new PluginError(`SendGrid plugin config: "${k}" must be a string`);
  }
  if (o['timeoutMs'] !== undefined && (typeof o['timeoutMs'] !== 'number' || !Number.isInteger(o['timeoutMs']) || o['timeoutMs'] <= 0)) {
    throw new PluginError('SendGrid plugin config: "timeoutMs" must be a positive integer (milliseconds)');
  }
  return {
    apiKey: o['apiKey'],
    ...(o['defaultFrom'] !== undefined ? { defaultFrom: o['defaultFrom'] as string } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
    ...(o['timeoutMs'] !== undefined ? { timeoutMs: o['timeoutMs'] as number } : {}),
  };
}

/** A minimal SendGrid mail client. Request-building is pure and testable offline. */
export class SendGridClient {
  constructor(private readonly config: SendGridPluginConfig) {}

  /**
   * Build the SendGrid v3 `mail/send` HTTP request for a message. Pure and
   * deterministic — no network — so the endpoint, bearer auth, and JSON body
   * shape can be verified offline.
   */
  buildMailSendRequest(msg: MailMessage): SendGridRequest {
    const from = msg.from ?? this.config.defaultFrom;
    if (!from) throw new PluginError('SendGrid: no "from" address (set message.from or config.defaultFrom)');
    if (!msg.to) throw new PluginError('SendGrid: message "to" is required');
    const content: Array<{ type: string; value: string }> = [];
    if (msg.text !== undefined) content.push({ type: 'text/plain', value: msg.text });
    if (msg.html !== undefined) content.push({ type: 'text/html', value: msg.html });
    if (content.length === 0) throw new PluginError('SendGrid: message must include "text" or "html"');
    const body = {
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: from },
      subject: msg.subject,
      content,
    };
    return {
      method: 'POST',
      url: 'https://api.sendgrid.com/v3/mail/send',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    };
  }

  /** Send a message via the SendGrid API (network). Resolves with the HTTP status. */
  async send(msg: MailMessage): Promise<number> {
    const r = this.buildMailSendRequest(msg);
    const u = new URL(r.url);
    return new Promise<number>((resolve, reject) => {
      const req = httpsRequest(
        { method: r.method, hostname: u.hostname, path: u.pathname, headers: { ...r.headers, 'content-length': Buffer.byteLength(r.body).toString() } },
        (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); },
      );
      req.once('error', reject);
      req.end(r.body);
    });
  }
}

/**
 * SendGrid email plugin. On load it injects a {@link SendGridClient} into each
 * request's `ctx.state[stateKey]` via middleware (requires 'middleware').
 */
export class SendGridPlugin extends PluginModule {
  readonly name = SENDGRID_PLUGIN_NAME;
  readonly version = SENDGRID_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: SendGridPluginConfig | null = null;
  private client: SendGridClient | null = null;

  constructor(config: unknown) { super(); this.raw = config; }

  async onInstall(): Promise<void> { this.config = validateSendGridConfig(this.raw); }

  async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.client = new SendGridClient(cfg);
    const stateKey = cfg.stateKey ?? 'mail';
    const client = this.client;
    const mw: MiddlewareFn = async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = client;
      await next();
    };
    app.use(mw);
  }

  async onUnload(): Promise<void> { this.client = null; }

  get mail(): SendGridClient {
    if (!this.client) throw new PluginError('SendGrid plugin is not loaded');
    return this.client;
  }

  private _config(): SendGridPluginConfig {
    if (!this.config) this.config = validateSendGridConfig(this.raw);
    return this.config;
  }
}
