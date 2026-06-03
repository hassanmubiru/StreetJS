export interface SecretProvider {
    get(key: string): Promise<string>;
}
export declare class VaultSecretProvider implements SecretProvider {
    private readonly _endpoint;
    private readonly _token;
    private readonly _mountPath;
    private readonly _cache;
    private readonly _ttlMs;
    constructor(opts: {
        endpoint: string;
        token: string;
        mountPath?: string;
        cacheTtlMs?: number;
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
    private readonly _cache;
    private readonly _ttlMs;
    constructor(opts: {
        region: string;
        accessKeyId: string;
        secretAccessKey: string;
        cacheTtlMs?: number;
    });
    get(key: string): Promise<string>;
    private _fetchSecret;
    private _getSigningKey;
    private _httpsPost;
    private _fetchWithRetry;
}
export declare class GcpSecretManagerProvider implements SecretProvider {
    private readonly _projectId;
    private readonly _serviceAccountToken;
    private readonly _cache;
    private readonly _ttlMs;
    constructor(opts: {
        projectId: string;
        serviceAccountToken?: string;
        cacheTtlMs?: number;
    });
    get(key: string): Promise<string>;
    private _fetchSecret;
    private _fetchMetadataToken;
    private _fetchWithRetry;
}
//# sourceMappingURL=secret-providers.d.ts.map