// src/cloud/secret-providers.ts
// Secret providers for HashiCorp Vault, AWS Secrets Manager, Azure Key Vault,
// and GCP Secret Manager. All providers share an in-memory cache with TTL, an
// exponential-backoff startup retry, and never log raw secret values.
//
// All network access is over node:https (or node:http for plain-HTTP dev/test
// endpoints such as a local Vault or LocalStack), with no cloud SDK dependency.

import { createHmac } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { EventEmitter } from 'node:events';

// ── SecretProvider interface ──────────────────────────────────────────────────

export interface SecretProvider {
  get(key: string): Promise<string>;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── HTTP(S) helper ────────────────────────────────────────────────────────────
// Chooses node:http for `http:` URLs (dev/test endpoints) and node:https
// otherwise. A custom CA bundle can be supplied for private TLS endpoints.

export interface HttpClientOptions {
  /** Custom CA certificate(s) for private TLS endpoints. */
  ca?: string | Buffer | Array<string | Buffer>;
  /** Set false only for trusted self-signed dev endpoints. Default true. */
  rejectUnauthorized?: boolean;
}

function httpRequestRaw(
  method: 'GET' | 'POST',
  url: string,
  extraHeaders: Record<string, string>,
  body: Buffer | null,
  tls: HttpClientOptions,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttp = parsed.protocol === 'http:';
    const options: Record<string, unknown> = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttp ? 80 : 443),
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...extraHeaders, ...(body ? { 'Content-Length': String(body.length) } : {}) },
    };
    if (!isHttp) {
      options['rejectUnauthorized'] = tls.rejectUnauthorized ?? true;
      if (tls.ca) options['ca'] = tls.ca;
    }
    const requestFn = isHttp ? httpRequest : httpsRequest;
    const req = requestFn(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (d: Buffer) => chunks.push(d));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function httpsGet(
  url: string,
  extraHeaders: Record<string, string> = {},
  tls: HttpClientOptions = {},
): Promise<{ status: number; body: string }> {
  return httpRequestRaw('GET', url, extraHeaders, null, tls);
}

// ── VaultSecretProvider ───────────────────────────────────────────────────────

export class VaultSecretProvider implements SecretProvider {
  private readonly _endpoint: string;
  private readonly _token: string;
  private readonly _mountPath: string;
  private readonly _cache = new Map<string, CacheEntry>();
  private readonly _ttlMs: number;
  private readonly _tls: HttpClientOptions;

  constructor(opts: {
    endpoint: string;
    token: string;
    mountPath?: string;
    cacheTtlMs?: number;
    tls?: HttpClientOptions;
  }) {
    this._endpoint = opts.endpoint.replace(/\/$/, '');
    this._token = opts.token;
    this._mountPath = opts.mountPath ?? 'secret';
    this._ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this._tls = opts.tls ?? {};
  }

  async get(key: string): Promise<string> {
    // Check cache
    const cached = this._cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    // KV v2: GET /v1/<mount>/data/<key>
    const url = `${this._endpoint}/v1/${this._mountPath}/data/${encodeURIComponent(key)}`;

    const { status, body } = await this._fetchWithRetry(url, {
      'X-Vault-Token': this._token,
    });

    if (status !== 200) {
      throw new Error(
        `VaultSecretProvider: failed to fetch secret "${key}" (HTTP ${status}). Value: [REDACTED]`,
      );
    }

    const parsed = JSON.parse(body) as { data?: { data?: Record<string, string> } };
    const value = parsed.data?.data?.[key] ?? parsed.data?.data?.['value'];

    if (value === undefined) {
      throw new Error(`VaultSecretProvider: key "${key}" not found in Vault response`);
    }

    this._cache.set(key, { value, expiresAt: Date.now() + this._ttlMs });
    return value;
  }

  private async _fetchWithRetry(
    url: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    const delays = [1000, 2000, 4000, 8000, 10000];
    const deadline = Date.now() + 60_000;
    let lastErr: Error | undefined;

    for (let i = 0; i <= delays.length; i++) {
      try {
        return await httpsGet(url, headers, this._tls);
      } catch (err) {
        lastErr = err as Error;
        if (i < delays.length && Date.now() + (delays[i] ?? 0) < deadline) {
          await new Promise((r) => setTimeout(r, delays[i]));
        } else {
          break;
        }
      }
    }

    throw lastErr ?? new Error('VaultSecretProvider: fetch failed');
  }
}

// ── AwsSecretsManagerProvider ─────────────────────────────────────────────────

/**
 * AWS Secrets Manager provider using manually constructed SigV4 requests.
 * Uses node:https directly — no AWS SDK dependency.
 */
export class AwsSecretsManagerProvider implements SecretProvider {
  private readonly _region: string;
  private readonly _accessKeyId: string;
  private readonly _secretAccessKey: string;
  private readonly _endpoint: string | undefined;
  private readonly _cache = new Map<string, CacheEntry>();
  private readonly _ttlMs: number;
  private readonly _tls: HttpClientOptions;

  constructor(opts: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    cacheTtlMs?: number;
    /** Override the service endpoint (VPC endpoint, LocalStack, or test server). */
    endpoint?: string;
    tls?: HttpClientOptions;
  }) {
    this._region = opts.region;
    this._accessKeyId = opts.accessKeyId;
    this._secretAccessKey = opts.secretAccessKey;
    this._endpoint = opts.endpoint;
    this._ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this._tls = opts.tls ?? {};
  }

  async get(key: string): Promise<string> {
    const cached = this._cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    const value = await this._fetchWithRetry(key);
    this._cache.set(key, { value, expiresAt: Date.now() + this._ttlMs });
    return value;
  }

  private async _fetchSecret(secretId: string): Promise<string> {
    const service = 'secretsmanager';
    const defaultHost = `${service}.${this._region}.amazonaws.com`;
    const endpoint = this._endpoint ? this._endpoint.replace(/\/$/, '') : `https://${defaultHost}`;
    // The signed `host` header must match the Host actually sent on the wire.
    const host = new URL(endpoint).host;

    const body = JSON.stringify({ SecretId: secretId });
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);

    // Canonical request
    const method = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    const canonicalHeaders =
      `content-type:application/x-amz-json-1.1\n` +
      `host:${host}\n` +
      `x-amz-date:${amzDate}\n` +
      `x-amz-target:secretsmanager.GetSecretValue\n`;
    const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';

    const { createHash } = await import('node:crypto');
    const payloadHash = createHash('sha256').update(body).digest('hex');

    const canonicalRequest =
      `${method}\n${canonicalUri}\n${canonicalQueryString}\n` +
      `${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

    // String to sign
    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${this._region}/${service}/aws4_request`;
    const stringToSign =
      `${algorithm}\n${amzDate}\n${credentialScope}\n` +
      createHash('sha256').update(canonicalRequest).digest('hex');

    // Signing key
    const signingKey = this._getSigningKey(dateStamp, this._region, service);
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const authorizationHeader =
      `${algorithm} Credential=${this._accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // Make the request
    const { status, body: respBody } = await httpRequestRaw('POST', endpoint, {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Date': amzDate,
      'X-Amz-Target': 'secretsmanager.GetSecretValue',
      Authorization: authorizationHeader,
    }, Buffer.from(body, 'utf8'), this._tls);

    if (status !== 200) {
      throw new Error(
        `AwsSecretsManagerProvider: HTTP ${status} for secret "${secretId}". Body: [REDACTED]`,
      );
    }

    const parsed = JSON.parse(respBody) as { SecretString?: string; SecretBinary?: string };
    const value = parsed.SecretString;
    if (value === undefined) {
      throw new Error(`AwsSecretsManagerProvider: no SecretString found for "${secretId}"`);
    }
    return value;
  }

  private _getSigningKey(dateStamp: string, region: string, service: string): Buffer {
    const kDate = createHmac('sha256', `AWS4${this._secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(region).digest();
    const kService = createHmac('sha256', kRegion).update(service).digest();
    return createHmac('sha256', kService).update('aws4_request').digest();
  }

  private _httpsPost(
    url: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    return httpRequestRaw('POST', url, headers, Buffer.from(body, 'utf8'), this._tls);
  }

  private async _fetchWithRetry(key: string): Promise<string> {
    const delays = [1000, 2000, 4000, 8000, 10000];
    const deadline = Date.now() + 60_000;
    let lastErr: Error | undefined;

    for (let i = 0; i <= delays.length; i++) {
      try {
        return await this._fetchSecret(key);
      } catch (err) {
        lastErr = err as Error;
        if (i < delays.length && Date.now() + (delays[i] ?? 0) < deadline) {
          await new Promise((r) => setTimeout(r, delays[i]));
        } else {
          break;
        }
      }
    }

    throw lastErr ?? new Error(`AwsSecretsManagerProvider: failed to fetch key "${key}"`);
  }
}

// ── GcpSecretManagerProvider ──────────────────────────────────────────────────

export class GcpSecretManagerProvider implements SecretProvider {
  private readonly _projectId: string;
  private readonly _serviceAccountToken: string | undefined;
  private readonly _cache = new Map<string, CacheEntry>();
  private readonly _ttlMs: number;

  constructor(opts: {
    projectId: string;
    serviceAccountToken?: string;
    cacheTtlMs?: number;
  }) {
    this._projectId = opts.projectId;
    this._serviceAccountToken = opts.serviceAccountToken;
    this._ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async get(key: string): Promise<string> {
    const cached = this._cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    const value = await this._fetchWithRetry(key);
    this._cache.set(key, { value, expiresAt: Date.now() + this._ttlMs });
    return value;
  }

  private async _fetchSecret(secretName: string): Promise<string> {
    // Resolve service account token — either provided directly or fetched from instance metadata
    const token = this._serviceAccountToken ?? (await this._fetchMetadataToken());

    const url =
      `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(this._projectId)}` +
      `/secrets/${encodeURIComponent(secretName)}/versions/latest:access`;

    const { status, body } = await httpsGet(url, {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });

    if (status !== 200) {
      throw new Error(
        `GcpSecretManagerProvider: HTTP ${status} for secret "${secretName}". Body: [REDACTED]`,
      );
    }

    const parsed = JSON.parse(body) as { payload?: { data?: string } };
    const encoded = parsed.payload?.data;
    if (!encoded) {
      throw new Error(`GcpSecretManagerProvider: no payload.data in response for "${secretName}"`);
    }

    return Buffer.from(encoded, 'base64').toString('utf8');
  }

  private _fetchMetadataToken(): Promise<string> {
    return new Promise((resolve, reject) => {
      const http = require('node:http') as typeof import('node:http');
      const req = http.request(
        {
          hostname: 'metadata.google.internal',
          path: '/computeMetadata/v1/instance/service-accounts/default/token',
          headers: { 'Metadata-Flavor': 'Google' },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (d: Buffer) => chunks.push(d));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { access_token?: string };
              if (!parsed.access_token) reject(new Error('No access_token in metadata response'));
              else resolve(parsed.access_token);
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  private async _fetchWithRetry(key: string): Promise<string> {
    const delays = [1000, 2000, 4000, 8000, 10000];
    const deadline = Date.now() + 60_000;
    let lastErr: Error | undefined;

    for (let i = 0; i <= delays.length; i++) {
      try {
        return await this._fetchSecret(key);
      } catch (err) {
        lastErr = err as Error;
        if (i < delays.length && Date.now() + (delays[i] ?? 0) < deadline) {
          await new Promise((r) => setTimeout(r, delays[i]));
        } else {
          break;
        }
      }
    }

    throw lastErr ?? new Error(`GcpSecretManagerProvider: failed to fetch key "${key}"`);
  }
}
