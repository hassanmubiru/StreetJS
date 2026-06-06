import type { StorageAdapter } from './backup.js';
export interface SigV4Input {
    method: string;
    host: string;
    path: string;
    query?: string;
    region: string;
    service: string;
    accessKeyId: string;
    secretAccessKey: string;
    payloadHash: string;
    now?: Date;
    extraHeaders?: Record<string, string>;
}
/**
 * Compute AWS SigV4 signed headers for a request. Exported for unit testing of
 * the canonical-request/signing logic without network access.
 */
export declare function signAwsV4(input: SigV4Input): Record<string, string>;
export interface S3StorageOptions {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    /** Optional key prefix within the bucket. */
    prefix?: string;
}
export declare class S3StorageAdapter implements StorageAdapter {
    private readonly opts;
    private readonly host;
    constructor(opts: S3StorageOptions);
    private objectPath;
    write(key: string, stream: NodeJS.ReadableStream): Promise<void>;
    read(key: string): Promise<NodeJS.ReadableStream>;
    list(): Promise<string[]>;
}
export interface GcsStorageOptions {
    bucket: string;
    /** OAuth2 bearer access token (from a service account). */
    accessToken: string;
    prefix?: string;
}
export declare class GcsStorageAdapter implements StorageAdapter {
    private readonly opts;
    private readonly host;
    constructor(opts: GcsStorageOptions);
    private objectName;
    write(key: string, stream: NodeJS.ReadableStream): Promise<void>;
    read(key: string): Promise<NodeJS.ReadableStream>;
    list(): Promise<string[]>;
}
//# sourceMappingURL=storage-adapters.d.ts.map