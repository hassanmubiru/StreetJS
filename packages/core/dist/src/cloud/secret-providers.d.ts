import { EventEmitter } from 'node:events';
export interface SecretProvider {
    get(key: string): Promise<string>;
}
export interface HttpClientOptions {
    /** Custom CA certificate(s) for private TLS endpoints. */
    ca?: string | Buffer | Array<string | Buffer>;
    /** Set false only for trusted self-signed dev endpoints. Default true. */
    rejectUnauthorized?: boolean;
}
export declare class VaultSecretProvider implements SecretProvider {
    private readonly _endpoint;
    private readonly _token;
    private readonly _mountPath;
    private readonly _cache;
    private readonly _ttlMs;
    private readonly _tls;
    constructor(opts: {
        endpoint: string;
        token: string;
        mountPath?: string;
        cacheTtlMs?: number;
        tls?: HttpClientOptions;
    });
    get(key: string): Promise<string>;
    private _fetchWithRetry;
}
/**
 * AWS Secrets Manager provider using manually constructed SigV4 requests.
 * Uses node:https directly — no AWS SDK dependency.
 */
export declare class AwsSecretsManagerProvider implements SecretProvider {
    private readonly _region;
    private readonly _accessKeyId;
    private readonly _secretAccessKey;
    private readonly _endpoint;
    private readonly _cache;
    private readonly _ttlMs;
    private readonly _tls;
    constructor(opts: {
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
        cacheTtlMs?: number;
        /** Override the service endpoint (VPC endpoint, LocalStack, or test server). */
        endpoint?: string;
        tls?: HttpClientOptions;
    });
    get(key: string): Promise<string>;
    private _fetchSecret;
    private _getSigningKey;
    private _fetchWithRetry;
}
export declare class GcpSecretManagerProvider implements SecretProvider {
    private readonly _projectId;
    private readonly _serviceAccountToken;
    private readonly _endpoint;
    private readonly _cache;
    private readonly _ttlMs;
    private readonly _tls;
    constructor(opts: {
        projectId: string;
        serviceAccountToken?: string;
        cacheTtlMs?: number;
        /** Override the Secret Manager endpoint (private endpoint or test server). */
        endpoint?: string;
        tls?: HttpClientOptions;
    });
    get(key: string): Promise<string>;
    private _fetchSecret;
    private _fetchMetadataToken;
    private _fetchWithRetry;
}
/**
 * Azure Key Vault secret provider. Retrieves secrets from
 * `GET {vaultUrl}/secrets/{name}?api-version=<v>` with an OAuth2 bearer token.
 *
 * The access token is obtained either directly (`accessToken`) or lazily via a
 * `tokenProvider` callback (e.g. wrapping the Azure IMDS managed-identity
 * endpoint or a client-credentials flow). Tokens from the callback are cached
 * until shortly before their `expiresAt`.
 */
export declare class AzureKeyVaultProvider implements SecretProvider {
    private readonly _vaultUrl;
    private readonly _apiVersion;
    private readonly _staticToken;
    private readonly _tokenProvider;
    private _cachedToken;
    private readonly _cache;
    private readonly _ttlMs;
    private readonly _tls;
    constructor(opts: {
        vaultUrl: string;
        accessToken?: string;
        tokenProvider?: () => Promise<{
            token: string;
            expiresAt: number;
        }>;
        apiVersion?: string;
        cacheTtlMs?: number;
        tls?: HttpClientOptions;
    });
    get(key: string): Promise<string>;
    private _token;
    private _fetchSecret;
    private _fetchWithRetry;
}
export interface RotationOptions {
    /** How often to re-fetch and check for a changed value, in ms. */
    intervalMs: number;
    /** Optional callback invoked with the new value whenever rotation is detected. */
    onRotate?: (newValue: string, oldValue: string | null) => void | Promise<void>;
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
export declare class SecretRotationManager extends EventEmitter {
    private readonly provider;
    private readonly key;
    private readonly opts;
    private timer;
    private current;
    private stopped;
    constructor(provider: SecretProvider, key: string, opts: RotationOptions);
    /** Fetch the initial value and begin watching for rotation. */
    start(): Promise<string>;
    /** The most recently observed value (null before start()). */
    get value(): string | null;
    private _tick;
    /** Force an immediate rotation check (used by tests and on-demand refresh). */
    checkNow(): Promise<void>;
    /** Stop watching and clear the timer. */
    stop(): void;
}
//# sourceMappingURL=secret-providers.d.ts.map