// packages/plugin-supabase/src/index.ts
// Official StreetJS plugin: Supabase PostgREST data API.
//
// Dependency-free: request construction (apikey + bearer auth, PostgREST query
// params and JSON bodies) is pure and offline-verifiable; the network send uses
// node:https. Covers select and insert against the REST endpoint.

import { PluginModule, PluginError, type SandboxedApp, type PluginManifest } from 'streetjs';
import { request as httpsRequest } from 'node:https';

export const SUPABASE_PLUGIN_NAME = 'street-plugin-supabase';
export const SUPABASE_PLUGIN_VERSION = '1.0.0';

/** Default outbound-request timeout (ms) when config omits `timeoutMs`. */
export const SUPABASE_DEFAULT_TIMEOUT_MS = 30_000;

export interface SupabasePluginConfig {
  /** Project URL, e.g. https://xyzcompany.supabase.co */
  url: string;
  /** anon or service-role API key. */
  apiKey: string;
  /** State key under which the client is injected. Default 'supabase'. */
  stateKey?: string;
  /** Outbound HTTP timeout in ms (default 30000). */
  timeoutMs?: number;
}

export interface SupabaseHttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export function supabasePluginManifest(): PluginManifest {
  return {
    name: SUPABASE_PLUGIN_NAME,
    version: SUPABASE_PLUGIN_VERSION,
    capabilities: ['database', 'postgrest', 'supabase'],
    permissions: ['net', 'secrets', 'middleware'],
  };
}

/** Remove trailing '/' characters without a backtracking regex (ReDoS-safe). */
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

export function validateSupabaseConfig(input: unknown): SupabasePluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new PluginError('Supabase plugin config must be an object');
  }
  const o = input as Record<string, unknown>;
  if (typeof o['url'] !== 'string' || !/^https:\/\//.test(o['url'] as string)) {
    throw new PluginError('Supabase plugin config: "url" is required and must be an https URL');
  }
  if (typeof o['apiKey'] !== 'string' || (o['apiKey'] as string).trim() === '') {
    throw new PluginError('Supabase plugin config: "apiKey" is required and must be a non-empty string');
  }
  if (o['stateKey'] !== undefined && typeof o['stateKey'] !== 'string') {
    throw new PluginError('Supabase plugin config: "stateKey" must be a string');
  }
  if (o['timeoutMs'] !== undefined && (typeof o['timeoutMs'] !== 'number' || !Number.isInteger(o['timeoutMs']) || o['timeoutMs'] <= 0)) {
    throw new PluginError('Supabase plugin config: "timeoutMs" must be a positive integer (milliseconds)');
  }
  return {
    url: stripTrailingSlashes(o['url'] as string),
    apiKey: o['apiKey'] as string,
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
    ...(o['timeoutMs'] !== undefined ? { timeoutMs: o['timeoutMs'] as number } : {}),
  };
}

function restBase(cfg: SupabasePluginConfig): string {
  return `${cfg.url}/rest/v1`;
}

function authHeaders(cfg: SupabasePluginConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: cfg.apiKey,
    authorization: `Bearer ${cfg.apiKey}`,
    accept: 'application/json',
    ...extra,
  };
}

/** A table name must be a non-empty identifier (letters, digits, underscore). */
function assertTable(table: string): void {
  if (typeof table !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new PluginError(`Supabase: invalid table name "${table}"`);
  }
}

/**
 * Build a PostgREST select request. `columns` defaults to '*'; `filters` is a
 * map of column → "operator.value" (e.g. { id: 'eq.42' }).
 */
export function buildSelectRequest(
  cfg: SupabasePluginConfig,
  table: string,
  opts: { columns?: string; filters?: Record<string, string>; limit?: number } = {},
): SupabaseHttpRequest {
  assertTable(table);
  const q = new URLSearchParams();
  q.set('select', opts.columns ?? '*');
  for (const [col, expr] of Object.entries(opts.filters ?? {})) q.set(col, expr);
  if (opts.limit !== undefined) q.set('limit', String(opts.limit));
  return { method: 'GET', url: `${restBase(cfg)}/${table}?${q.toString()}`, headers: authHeaders(cfg) };
}

/** Build a PostgREST insert request (returns the inserted rows). */
export function buildInsertRequest(
  cfg: SupabasePluginConfig,
  table: string,
  rows: Record<string, unknown> | Array<Record<string, unknown>>,
): SupabaseHttpRequest {
  assertTable(table);
  return {
    method: 'POST',
    url: `${restBase(cfg)}/${table}`,
    headers: authHeaders(cfg, { 'content-type': 'application/json', prefer: 'return=representation' }),
    body: JSON.stringify(rows),
  };
}

export class SupabaseClient {
  constructor(private readonly config: SupabasePluginConfig) {}

  private send(req: SupabaseHttpRequest): Promise<{ status: number; body: string }> {
    const u = new URL(req.url);
    const timeoutMs = this.config.timeoutMs ?? SUPABASE_DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const r = httpsRequest(
        { method: req.method, hostname: u.hostname, path: u.pathname + u.search, timeout: timeoutMs, headers: req.headers },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      r.on('error', (e) => reject(new PluginError(`Supabase request failed: ${e.message}`)));
      r.once('timeout', () => r.destroy(new PluginError(`Supabase request timed out after ${timeoutMs}ms`)));
      r.end(req.body);
    });
  }

  async select(table: string, opts?: { columns?: string; filters?: Record<string, string>; limit?: number }): Promise<unknown> {
    const { status, body } = await this.send(buildSelectRequest(this.config, table, opts));
    if (status < 200 || status >= 300) throw new PluginError(`Supabase select returned ${status}`);
    return JSON.parse(body);
  }

  async insert(table: string, rows: Record<string, unknown> | Array<Record<string, unknown>>): Promise<unknown> {
    const { status, body } = await this.send(buildInsertRequest(this.config, table, rows));
    if (status < 200 || status >= 300) throw new PluginError(`Supabase insert returned ${status}`);
    return JSON.parse(body);
  }
}

export class SupabasePlugin extends PluginModule {
  readonly name = SUPABASE_PLUGIN_NAME;
  readonly version = SUPABASE_PLUGIN_VERSION;

  private readonly raw: unknown;
  private config: SupabasePluginConfig | null = null;
  private client: SupabaseClient | null = null;

  constructor(config: unknown) {
    super();
    this.raw = config;
  }

  override async onInstall(): Promise<void> {
    this.config = validateSupabaseConfig(this.raw);
  }

  override async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config();
    this.client = new SupabaseClient(cfg);
    const stateKey = cfg.stateKey ?? 'supabase';
    const client = this.client;
    app.use(async (ctx, next) => {
      (ctx.state as Record<string, unknown>)[stateKey] = client;
      await next();
    });
  }

  get data(): SupabaseClient {
    if (!this.client) throw new PluginError('Supabase plugin is not loaded');
    return this.client;
  }

  private _config(): SupabasePluginConfig {
    if (!this.config) this.config = validateSupabaseConfig(this.raw);
    return this.config;
  }
}
