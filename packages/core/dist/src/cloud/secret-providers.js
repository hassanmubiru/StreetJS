// src/cloud/secret-providers.ts
// Secret providers for Vault, AWS Secrets Manager, and GCP Secret Manager.
// All providers share an in-memory cache with TTL.
import { createHmac } from 'node:crypto';
import { request as httpsRequest } from 'node:https';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// ── HTTPS helper ──────────────────────────────────────────────────────────────
function httpsGet(url, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: extraHeaders,
            rejectUnauthorized: true,
        };
        const req = httpsRequest(options, (res) => {
            const chunks = [];
            res.on('data', (d) => chunks.push(d));
            res.on('end', () => {
                resolve({
                    status: res.statusCode ?? 0,
                    body: Buffer.concat(chunks).toString('utf8'),
                });
            });
        });
        req.on('error', reject);
        req.end();
    });
}
// ── VaultSecretProvider ───────────────────────────────────────────────────────
export class VaultSecretProvider {
    _endpoint;
    _token;
    _mountPath;
    _cache = new Map();
    _ttlMs;
    constructor(opts) {
        this._endpoint = opts.endpoint.replace(/\/$/, '');
        this._token = opts.token;
        this._mountPath = opts.mountPath ?? 'secret';
        this._ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    }
    async get(key) {
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
            throw new Error(`VaultSecretProvider: failed to fetch secret "${key}" (HTTP ${status}). Value: [REDACTED]`);
        }
        const parsed = JSON.parse(body);
        const value = parsed.data?.data?.[key] ?? parsed.data?.data?.['value'];
        if (value === undefined) {
            throw new Error(`VaultSecretProvider: key "${key}" not found in Vault response`);
        }
        this._cache.set(key, { value, expiresAt: Date.now() + this._ttlMs });
        return value;
    }
    async _fetchWithRetry(url, headers) {
        const delays = [1000, 2000, 4000, 8000, 10000];
        const deadline = Date.now() + 60_000;
        let lastErr;
        for (let i = 0; i <= delays.length; i++) {
            try {
                return await httpsGet(url, headers);
            }
            catch (err) {
                lastErr = err;
                if (i < delays.length && Date.now() + (delays[i] ?? 0) < deadline) {
                    await new Promise((r) => setTimeout(r, delays[i]));
                }
                else {
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
export class AwsSecretsManagerProvider {
    _region;
    _accessKeyId;
    _secretAccessKey;
    _cache = new Map();
    _ttlMs;
    constructor(opts) {
        this._region = opts.region;
        this._accessKeyId = opts.accessKeyId;
        this._secretAccessKey = opts.secretAccessKey;
        this._ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    }
    async get(key) {
        const cached = this._cache.get(key);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.value;
        }
        const value = await this._fetchWithRetry(key);
        this._cache.set(key, { value, expiresAt: Date.now() + this._ttlMs });
        return value;
    }
    async _fetchSecret(secretId) {
        const service = 'secretsmanager';
        const host = `${service}.${this._region}.amazonaws.com`;
        const endpoint = `https://${host}`;
        const body = JSON.stringify({ SecretId: secretId });
        const now = new Date();
        const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
        const dateStamp = amzDate.slice(0, 8);
        // Canonical request
        const method = 'POST';
        const canonicalUri = '/';
        const canonicalQueryString = '';
        const canonicalHeaders = `content-type:application/x-amz-json-1.1\n` +
            `host:${host}\n` +
            `x-amz-date:${amzDate}\n` +
            `x-amz-target:secretsmanager.GetSecretValue\n`;
        const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';
        const { createHash } = await import('node:crypto');
        const payloadHash = createHash('sha256').update(body).digest('hex');
        const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQueryString}\n` +
            `${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
        // String to sign
        const algorithm = 'AWS4-HMAC-SHA256';
        const credentialScope = `${dateStamp}/${this._region}/${service}/aws4_request`;
        const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n` +
            createHash('sha256').update(canonicalRequest).digest('hex');
        // Signing key
        const signingKey = this._getSigningKey(dateStamp, this._region, service);
        const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
        const authorizationHeader = `${algorithm} Credential=${this._accessKeyId}/${credentialScope}, ` +
            `SignedHeaders=${signedHeaders}, Signature=${signature}`;
        // Make the request
        const { status, body: respBody } = await this._httpsPost(endpoint, body, {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Date': amzDate,
            'X-Amz-Target': 'secretsmanager.GetSecretValue',
            Authorization: authorizationHeader,
        });
        if (status !== 200) {
            throw new Error(`AwsSecretsManagerProvider: HTTP ${status} for secret "${secretId}". Body: [REDACTED]`);
        }
        const parsed = JSON.parse(respBody);
        const value = parsed.SecretString;
        if (value === undefined) {
            throw new Error(`AwsSecretsManagerProvider: no SecretString found for "${secretId}"`);
        }
        return value;
    }
    _getSigningKey(dateStamp, region, service) {
        const kDate = createHmac('sha256', `AWS4${this._secretAccessKey}`).update(dateStamp).digest();
        const kRegion = createHmac('sha256', kDate).update(region).digest();
        const kService = createHmac('sha256', kRegion).update(service).digest();
        return createHmac('sha256', kService).update('aws4_request').digest();
    }
    _httpsPost(url, body, headers) {
        return new Promise((resolve, reject) => {
            const parsed = new URL(url);
            const bodyBuf = Buffer.from(body, 'utf8');
            const options = {
                hostname: parsed.hostname,
                port: parsed.port || 443,
                path: parsed.pathname,
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Length': String(bodyBuf.length),
                },
                rejectUnauthorized: true,
            };
            const req = httpsRequest(options, (res) => {
                const chunks = [];
                res.on('data', (d) => chunks.push(d));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode ?? 0,
                        body: Buffer.concat(chunks).toString('utf8'),
                    });
                });
            });
            req.on('error', reject);
            req.write(bodyBuf);
            req.end();
        });
    }
    async _fetchWithRetry(key) {
        const delays = [1000, 2000, 4000, 8000, 10000];
        const deadline = Date.now() + 60_000;
        let lastErr;
        for (let i = 0; i <= delays.length; i++) {
            try {
                return await this._fetchSecret(key);
            }
            catch (err) {
                lastErr = err;
                if (i < delays.length && Date.now() + (delays[i] ?? 0) < deadline) {
                    await new Promise((r) => setTimeout(r, delays[i]));
                }
                else {
                    break;
                }
            }
        }
        throw lastErr ?? new Error(`AwsSecretsManagerProvider: failed to fetch key "${key}"`);
    }
}
// ── GcpSecretManagerProvider ──────────────────────────────────────────────────
export class GcpSecretManagerProvider {
    _projectId;
    _serviceAccountToken;
    _cache = new Map();
    _ttlMs;
    constructor(opts) {
        this._projectId = opts.projectId;
        this._serviceAccountToken = opts.serviceAccountToken;
        this._ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    }
    async get(key) {
        const cached = this._cache.get(key);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.value;
        }
        const value = await this._fetchWithRetry(key);
        this._cache.set(key, { value, expiresAt: Date.now() + this._ttlMs });
        return value;
    }
    async _fetchSecret(secretName) {
        // Resolve service account token — either provided directly or fetched from instance metadata
        const token = this._serviceAccountToken ?? (await this._fetchMetadataToken());
        const url = `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(this._projectId)}` +
            `/secrets/${encodeURIComponent(secretName)}/versions/latest:access`;
        const { status, body } = await httpsGet(url, {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        });
        if (status !== 200) {
            throw new Error(`GcpSecretManagerProvider: HTTP ${status} for secret "${secretName}". Body: [REDACTED]`);
        }
        const parsed = JSON.parse(body);
        const encoded = parsed.payload?.data;
        if (!encoded) {
            throw new Error(`GcpSecretManagerProvider: no payload.data in response for "${secretName}"`);
        }
        return Buffer.from(encoded, 'base64').toString('utf8');
    }
    _fetchMetadataToken() {
        return new Promise((resolve, reject) => {
            const http = require('node:http');
            const req = http.request({
                hostname: 'metadata.google.internal',
                path: '/computeMetadata/v1/instance/service-accounts/default/token',
                headers: { 'Metadata-Flavor': 'Google' },
            }, (res) => {
                const chunks = [];
                res.on('data', (d) => chunks.push(d));
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                        if (!parsed.access_token)
                            reject(new Error('No access_token in metadata response'));
                        else
                            resolve(parsed.access_token);
                    }
                    catch (err) {
                        reject(err);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }
    async _fetchWithRetry(key) {
        const delays = [1000, 2000, 4000, 8000, 10000];
        const deadline = Date.now() + 60_000;
        let lastErr;
        for (let i = 0; i <= delays.length; i++) {
            try {
                return await this._fetchSecret(key);
            }
            catch (err) {
                lastErr = err;
                if (i < delays.length && Date.now() + (delays[i] ?? 0) < deadline) {
                    await new Promise((r) => setTimeout(r, delays[i]));
                }
                else {
                    break;
                }
            }
        }
        throw lastErr ?? new Error(`GcpSecretManagerProvider: failed to fetch key "${key}"`);
    }
}
//# sourceMappingURL=secret-providers.js.map