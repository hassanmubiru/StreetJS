import { PublisherDirectory } from './auth.js';
import { RegistryStore } from './store.js';
import type { ListQuery, PackageWithSignature, Paginated, PluginSummary, PluginVersion, PublishRequest, PublishResponse, RegistryError, SearchQuery, VerifyResponse } from './types.js';
/** A result that is either a value or a structured registry error. */
export type Result<T> = T | RegistryError;
/** True iff a result is a {@link RegistryError}. */
export declare function isRegistryError(value: unknown): value is RegistryError;
export interface RegistryServiceOptions {
    publishers?: PublisherDirectory;
    store?: RegistryStore;
    /** Clock injection for deterministic timestamps in tests. */
    now?: () => Date;
}
/** Optional per-publish metadata not carried inside the manifest. */
export interface PublishMeta {
    categories?: string[];
    tags?: string[];
    description?: string;
}
export declare class RegistryService {
    readonly publishers: PublisherDirectory;
    readonly store: RegistryStore;
    private readonly now;
    constructor(opts?: RegistryServiceOptions);
    /**
     * Publish a plugin version. `apiKey` is the raw bearer token presented by the
     * caller. Returns a {@link PublishResponse} on success or a
     * {@link RegistryError} identifying the rejection (Req 4.1/4.2/4.5/4.9/4.10).
     */
    publish(apiKey: string | undefined, req: PublishRequest, meta?: PublishMeta): Result<PublishResponse>;
    /** Download a package + its recorded signature for consumer-side verification (Req 4.3). */
    download(name: string, version: string): Result<PackageWithSignature>;
    /** Re-check manifest signature/checksum and tarball integrity on demand (Req 4.1). */
    verify(name: string, version: string): Result<VerifyResponse>;
    /** Paginated list of all plugins (default 25 / max 100, Req 4.6). */
    list(query?: ListQuery): Paginated<PluginSummary>;
    /** Search with optional free-text + category + tag filters, paginated (Req 4.6). */
    search(query?: SearchQuery): Paginated<PluginSummary>;
    /** Version history for a plugin (Req 4.6). */
    versions(name: string): PluginVersion[];
}
//# sourceMappingURL=registry.d.ts.map