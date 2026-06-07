// src/platform/plugins/official/r2.ts
// Official reference plugin: Cloudflare R2 object storage. R2 is S3-compatible,
// so this reuses the framework's verified AWS SigV4 signer against the R2
// endpoint. Deterministic, offline-verifiable request signing.

import { PluginModule, type SandboxedApp } from '../sdk.js';
import { PluginError, type PluginManifest } from '../host.js';
import { signAwsV4 } from '../../../enterprise/storage-adapters.js';
import type { MiddlewareFn } from '../../../core/types.js';

export const R2_PLUGIN_NAME = 'street-plugin-r2';
export const R2_PLUGIN_VERSION = '1.0.0';

export interface R2PluginConfig {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  stateKey?: string;
}

export function r2PluginManifest(): PluginManifest {
  return {
    name: R2_PLUGIN_NAME, version: R2_PLUGIN_VERSION,
    capabilities: ['storage', 'object-storage', 'r2'], permissions: ['net', 'secrets', 'middleware'],
  };
}

export function validateR2Config(input: unknown): R2PluginConfig {
  if (typeof input !== 'object' || input === null) throw new PluginError('R2 plugin config must be an object');
  const o = input as Record<string, unknown>;
  for (const k of ['accountId', 'bucket', 'accessKeyId', 'secretAccessKey']) {
    if (typeof o[k] !== 'string' || (o[k] as string).trim() === '') throw new PluginError(`R2 plugin config: "${k}" is required and must be a non-empty string`);
  }
  if (o['stateKey'] !== undefined && typeof o['stateKey'] !== 'string') throw new PluginError('R2 plugin config: "stateKey" must be a string');
  return {
    accountId: o['accountId'] as string, bucket: o['bucket'] as string,
    accessKeyId: o['accessKeyId'] as string, secretAccessKey: o['secretAccessKey'] as string,
    ...(o['stateKey'] !== undefined ? { stateKey: o['stateKey'] as string } : {}),
  };
}

/** SHA-256 hex of empty payload (used for GET requests). */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export class R2Client {
  private readonly host: string;
  constructor(private readonly config: R2PluginConfig) {
    this.host = `${config.accountId}.r2.cloudflarestorage.com`;
  }

  private objectPath(key: string): string {
    const full = `${this.config.bucket}/${key}`;
    return '/' + full.split('/').map(encodeURIComponent).join('/');
  }

  /** Build deterministic SigV4 headers for an R2 object request (service 's3', region 'auto'). */
  signedObjectHeaders(method: 'GET' | 'PUT', key: string, payloadHash = EMPTY_SHA256, now?: Date): Record<string, string> {
    if (!key) throw new PluginError('R2: object key is required');
    return signAwsV4({
      method, host: this.host, path: this.objectPath(key),
      region: 'auto', service: 's3',
      accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey,
      payloadHash, ...(now ? { now } : {}),
    });
  }

  /** The R2 endpoint host. */
  endpoint(): string { return this.host; }
}

export class R2Plugin extends PluginModule {
  readonly name = R2_PLUGIN_NAME;
  readonly version = R2_PLUGIN_VERSION;
  private readonly raw: unknown;
  private config: R2PluginConfig | null = null;
  private client: R2Client | null = null;
  constructor(config: unknown) { super(); this.raw = config; }
  async onInstall(): Promise<void> { this.config = validateR2Config(this.raw); }
  async onLoad(app: SandboxedApp): Promise<void> {
    const cfg = this._config(); this.client = new R2Client(cfg);
    const stateKey = cfg.stateKey ?? 'r2'; const client = this.client;
    const mw: MiddlewareFn = async (ctx, next) => { (ctx.state as Record<string, unknown>)[stateKey] = client; await next(); };
    app.use(mw);
  }
  async onUnload(): Promise<void> { this.client = null; }
  get storage(): R2Client { if (!this.client) throw new PluginError('R2 plugin is not loaded'); return this.client; }
  private _config(): R2PluginConfig { if (!this.config) this.config = validateR2Config(this.raw); return this.config; }
}
