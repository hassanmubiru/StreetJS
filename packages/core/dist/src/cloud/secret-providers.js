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
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// A fetch error that knows whether retrying could help. 4xx responses (auth,
// not-found, bad request) are not retried; network errors and 5xx/429 are.
class SecretFetchError extends Error {
    retryable;
    constructor(message, retryable) {
        super(message);
        this.retryable = retryable;
        this.name = 'SecretFetchError';
    }
}
function isRetryable(err) {
    if (err instanceof SecretFetchError)
        return err.retryable;
    return true; // network/transport errors are retryable
}
function httpRequestRaw(method, url, extraHeaders, body, tls) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const isHttp = parsed.protocol === 'http:';
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttp ? 80 : 443),
            path: parsed.pathname + parsed.search,
            method,
            headers: { ...extraHeaders, ...(body ? { 'Content-Length': String(body.length) } : {}) },
        };
        if (!isHttp) {
            options['rejectUnauthorized'] = tls.rejectUnauthorized ?? true;
            if (tls.ca)
                options['ca'] = tls.ca;
        }
        const requestFn = isHttp ? httpRequest : httpsRequest;
        const req = requestFn(options, (res) => {
            const chunks = [];
            res.on('data', (d) => chunks.push(d));
            res.on('end', () => {
                resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
            });
        });
        req.on('error', reject);
        if (body)
            req.write(body);
        req.end();
    });
}
function httpsGet(url, extraHeaders = {}, tls = {}) {
    return httpRequestRaw('GET', url, extraHeaders, null, tls);
}
// ── VaultSecretProvider ───────────────────────────────────────────────────────
export class VaultSecretProvider {
    _endpoint;
    _token;
    _mountPath;
    _cache = new Map();
    _ttlMs;
    _tls;
    constructor(opts) {
        this._endpoint = opts.endpoint.replace(/\/$/, '');
        this._token = opts.token;
        this._mountPath = opts.mountPath ?? 'secret';
        this._ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
        this._tls = opts.tls ?? {};
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
                return await httpsGet(url, headers, this._tls);
            }
            catch (err) {
                lastErr = err;
                if (!isRetryable(err))
                    break;
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
    _endpoint;
    _cache = new Map();
    _ttlMs;
    _tls;
    constructor(opts) {
        this._region = opts.region;
        this._accessKeyId = opts.accessKeyId;
        this._secretAccessKey = opts.secretAccessKey;
        this._endpoint = opts.endpoint;
        this._ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
        this._tls = opts.tls ?? {};
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
        const { status, body: respBody } = await httpRequestRaw('POST', endpoint, {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Date': amzDate,
            'X-Amz-Target': 'secretsmanager.GetSecretValue',
            Authorization: authorizationHeader,
        }, Buffer.from(body, 'utf8'), this._tls);
        if (status !== 200) {
            throw new SecretFetchError(`AwsSecretsManagerProvider: HTTP ${status} for secret "${secretId}". Body: [REDACTED]`, status >= 500 || status === 429);
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
                if (!isRetryable(err))
                    break;
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
    _endpoint;
    _cache = new Map();
    _ttlMs;
    _tls;
    constructor(opts) {
        this._projectId = opts.projectId;
        this._serviceAccountToken = opts.serviceAccountToken;
        this._endpoint = (opts.endpoint ?? 'https://secretmanager.googleapis.com').replace(/\/$/, '');
        this._ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
        this._tls = opts.tls ?? {};
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
        const url = `${this._endpoint}/v1/projects/${encodeURIComponent(this._projectId)}` +
            `/secrets/${encodeURIComponent(secretName)}/versions/latest:access`;
        const { status, body } = await httpsGet(url, {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        }, this._tls);
        if (status !== 200) {
            throw new SecretFetchError(`GcpSecretManagerProvider: HTTP ${status} for secret "${secretName}". Body: [REDACTED]`, status >= 500 || status === 429);
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
                if (!isRetryable(err))
                    break;
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
// ── AzureKeyVaultProvider ─────────────────────────────────────────────────────
/**
 * Azure Key Vault secret provider. Retrieves secrets from
 * `GET {vaultUrl}/secrets/{name}?api-version=<v>` with an OAuth2 bearer token.
 *
 * The access token is obtained either directly (`accessToken`) or lazily via a
 * `tokenProvider` callback (e.g. wrapping the Azure IMDS managed-identity
 * endpoint or a client-credentials flow). Tokens from the callback are cached
 * until shortly before their `expiresAt`.
 */
export class AzureKeyVaultProvider {
    _vaultUrl;
    _apiVersion;
    _staticToken;
    _tokenProvider;
    _cachedToken = null;
    _cache = new Map();
    _ttlMs;
    _tls;
    constructor(opts) {
        if (!opts.accessToken && !opts.tokenProvider) {
            throw new Error('AzureKeyVaultProvider: provide either accessToken or tokenProvider');
        }
        this._vaultUrl = opts.vaultUrl.replace(/\/$/, '');
        this._apiVersion = opts.apiVersion ?? '7.4';
        this._staticToken = opts.accessToken;
        this._tokenProvider = opts.tokenProvider;
        this._ttlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
        this._tls = opts.tls ?? {};
    }
    async get(key) {
        const cached = this._cache.get(key);
        if (cached && Date.now() < cached.expiresAt)
            return cached.value;
        const value = await this._fetchWithRetry(key);
        this._cache.set(key, { value, expiresAt: Date.now() + this._ttlMs });
        return value;
    }
    async _token() {
        if (this._staticToken)
            return this._staticToken;
        if (this._cachedToken && Date.now() < this._cachedToken.expiresAt - 30_000) {
            return this._cachedToken.token;
        }
        this._cachedToken = await this._tokenProvider();
        return this._cachedToken.token;
    }
    async _fetchSecret(name) {
        const token = await this._token();
        const url = `${this._vaultUrl}/secrets/${encodeURIComponent(name)}?api-version=${this._apiVersion}`;
        const { status, body } = await httpsGet(url, { Authorization: `Bearer ${token}` }, this._tls);
        if (status !== 200) {
            throw new SecretFetchError(`AzureKeyVaultProvider: HTTP ${status} for secret "${name}". Value: [REDACTED]`, status >= 500 || status === 429);
        }
        const parsed = JSON.parse(body);
        if (parsed.value === undefined) {
            throw new Error(`AzureKeyVaultProvider: no "value" field for secret "${name}"`);
        }
        return parsed.value;
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
                if (!isRetryable(err))
                    break;
                if (i < delays.length && Date.now() + (delays[i] ?? 0) < deadline) {
                    await new Promise((r) => setTimeout(r, delays[i]));
                }
                else {
                    break;
                }
            }
        }
        throw lastErr ?? new Error(`AzureKeyVaultProvider: failed to fetch key "${key}"`);
    }
}
/**
 * Watches a single secret for rotation. On a timer it re-fetches the key from
 * the underlying `SecretProvider`; when the value changes it emits a `rotate`
 * event (`{ key, newValue, oldValue }`) and invokes the optional `onRotate`
 * callback. This is the seam used to recycle a `PgPool`'s connections when a DB
 * password rotates — pass an `onRotate` that calls `pool.recycle()`.
 *
 * Errors during a refresh are emitted as `error` events and do not stop the
 * watch loop. The interval timer is `unref()`-ed so it never blocks process
 * exit; call `stop()` for a clean shutdown.
 */
export class SecretRotationManager extends EventEmitter {
    provider;
    key;
    opts;
    timer = null;
    current = null;
    stopped = false;
    constructor(provider, key, opts) {
        super();
        this.provider = provider;
        this.key = key;
        this.opts = opts;
    }
    /** Fetch the initial value and begin watching for rotation. */
    async start() {
        this.current = await this.provider.get(this.key);
        this.stopped = false;
        this.timer = setInterval(() => { void this._tick(); }, this.opts.intervalMs);
        this.timer.unref();
        return this.current;
    }
    /** The most recently observed value (null before start()). */
    get value() {
        return this.current;
    }
    async _tick() {
        if (this.stopped)
            return;
        try {
            const next = await this.provider.get(this.key);
            if (next !== this.current) {
                const old = this.current;
                this.current = next;
                this.emit('rotate', { key: this.key, newValue: next, oldValue: old });
                if (this.opts.onRotate)
                    await this.opts.onRotate(next, old);
            }
        }
        catch (err) {
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
    }
    /** Force an immediate rotation check (used by tests and on-demand refresh). */
    async checkNow() {
        await this._tick();
    }
    /** Stop watching and clear the timer. */
    stop() {
        this.stopped = true;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}
//# sourceMappingURL=secret-providers.js.map