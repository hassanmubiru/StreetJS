// packages/plugin-openai/src/index.ts
// Official StreetJS plugin: OpenAI chat completions + embeddings.
//
// Dependency-free: request construction (bearer auth + JSON body) is pure and
// offline-verifiable; the network send uses node:https. A configurable baseUrl
// supports Azure OpenAI and OpenAI-compatible gateways.

import { PluginModule, PluginError, type SandboxedApp, type PluginManifest } from 'streetjs';
import { request as httpsRequest } from 'node:https';

export const OPENAI_PLUGIN_NAME = 'street-plugin-openai';
export const OPENAI_PLUGIN_VERSION = '1.0.0';

export interface OpenAiPluginConfig {
  apiKey: string;
  /** Optional organization id (sent as OpenAI-Organization). */
  organization?: string;
  /** Override base URL (default https://api.openai.com/v1). */
  baseUrl?: string;
  /** State key under which the client is injected. Default 'openai'. */
  stateKey?: string;
}

export interface OpenAiHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export function openAiPluginManifest(): PluginManifest {
  return {
    name: OPENAI_PLUGIN_NAME,
    version: OPENAI_PLUGIN_VERSION,
    capabilities: ['ai', 'llm', 'embeddings'],
    permissions: ['net', 'secrets', 'middleware'],
  };
}

export function validateOpenAiConfig(input: unknown): OpenAiPluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('OpenAI plugin config must be an object');
  }
  const o = input as Record<string, unknown>;
  if (typeof o['apiKey'] !== 'string' || (o['apiKey'] as string).trim() === '') {
    throw new PluginError('OpenAI plugin config: "apiKey" is required and must be a non-empty string');
  }
  for (const k of ['organization', 'baseUrl', 'stateKey'] as const) {
    if (o[k] !== undefined && typeof o[k] !== 'string') {
      throw new PluginError(`OpenAI plugin config: "${k}" must be a string`);
    }
  }
  if (o['baseUrl'] !== undefined && !/^https:\/\//.test(o['baseUrl'] as string)) {
    throw new PluginError('OpenAI plugin config: "baseUrl" must be an https URL');
  }
  return {
    apiKey: o['apiKey'] as string,
    ...(o['organization'] !== undefined ? { organization: o['organization'] as string } : {}),
    ...(o['baseUrl'] !== undefined ? { baseUrl: o['baseUrl'] as string } : {}),
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
  };
}

function authHeaders(cfg: OpenAiPluginConfig): Record<string, string> {
  return {
    authorization: `Bearer ${cfg.apiKey}`,
    'content-type': 'application/json',
    accept: 'application/json',
    ...(cfg.organization !== undefined ? { 'openai-organization': cfg.organization } : {}),
  };
}

function base(cfg: OpenAiPluginConfig): string {
  return (cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
}

/** Build a chat-completions request. */
export function buildChatRequest(
  cfg: OpenAiPluginConfig,
  params: { model: string; messages: ChatMessage[]; temperature?: number },
): OpenAiHttpRequest {
  if (typeof params.model !== 'string' || params.model.trim() === '') {
    throw new PluginError('OpenAI: "model" is required');
  }
  if (!Array.isArray(params.messages) || params.messages.length === 0) {
    throw new PluginError('OpenAI: "messages" must be a non-empty array');
  }
  return {
    method: 'POST',
    url: `${base(cfg)}/chat/completions`,
    headers: authHeaders(cfg),
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    }),
  };
}

/** Build an embeddings request. */
export function buildEmbeddingsRequest(
  cfg: OpenAiPluginConfig,
  params: { model: string; input: string | string[] },
): OpenAiHttpRequest {
  if (typeof params.model !== 'string' || params.model.trim() === '') {
    throw new PluginError('OpenAI: "model" is required');
  }
  return {
    method: 'POST',
    url: `${base(cfg)}/embeddings`,
    headers: authHeaders(cfg),
    body: JSON.stringify({ model: params.model, input: params.input }),
  };
}

/** Minimal dependency-free OpenAI client over node:https. */
export class OpenAiClient {
  constructor(private readonly config: OpenAiPluginConfig) {}

  private send(req: OpenAiHttpRequest): Promise<{ status: number; body: string }> {
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
      r.on('error', (e) => reject(new PluginError(`OpenAI request failed: ${e.message}`)));
      r.end(req.body);
    });
  }

  async chat(params: { model: string; messages: ChatMessage[]; temperature?: number }): Promise<unknown> {
    const { status, body } = await this.send(buildChatRequest(this.config, params));
    if (status < 200 || status >= 300) throw new PluginError(`OpenAI chat returned ${status}`);
    return JSON.parse(body);
  }

  async embeddings(params: { model: string; input: string | string[] }): Promise<unknown> {
    const { status, body } = await this.send(buildEmbeddingsRequest(this.config, params));
    if (status < 200 || status >= 300) throw new PluginError(`OpenAI embeddings returned ${status}`);
    return JSON.parse(body);
  }
}

export class OpenAiPlugin extends PluginModule {
  readonly name = OPENAI_PLUGIN_NAME;
  readonly version = OPENAI_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: OpenAiPluginConfig | null = null;
  private client: OpenAiClient | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  override async onInstall(): Promise<void> {
    this.config = validateOpenAiConfig(this.raw);
  }

  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.client = new OpenAiClient(cfg);
    const stateKey = cfg.stateKey ?? 'openai';
    const client = this.client;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = client;
      await next();
    });
  }

  get ai(): OpenAiClient {
    if (!this.client) throw new PluginError('OpenAI plugin is not loaded');
    return this.client;
  }

  private _config(): OpenAiPluginConfig {
    if (!this.config) this.config = validateOpenAiConfig(this.raw);
    return this.config;
  }
}
