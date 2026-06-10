import type { PluginManifest } from 'streetjs';
import type { PluginSummary, PluginVersion } from './types.js';
/** A single stored version: everything needed to serve download/verify. */
export interface StoredVersion {
    name: string;
    version: string;
    manifest: PluginManifest;
    publicKeyPem: string;
    /** Raw tarball bytes. */
    tarball: Buffer;
    /** SHA-256 hex of `tarball` recorded at publish time. */
    tarballChecksum: string;
    categories: string[];
    tags: string[];
    publishedAt: string;
}
/**
 * In-memory registry store. Insertion is keyed by `name` then `version`; the
 * service layer guarantees only validated, non-duplicate versions reach `put`.
 */
export declare class RegistryStore {
    private readonly plugins;
    /** True iff `name@version` already exists (duplicate detection, Req 4.10). */
    hasVersion(name: string, version: string): boolean;
    /** Insert a fully-validated version. Indexes categories/tags + version history. */
    put(record: StoredVersion, opts?: {
        categories?: string[];
        tags?: string[];
        description?: string;
    }): void;
    /** Fetch one stored version, or `undefined` if not present. */
    get(name: string, version: string): StoredVersion | undefined;
    /** All known plugin names. */
    names(): string[];
    /** Version history for a plugin, sorted ascending by semver-ish order. */
    versions(name: string): PluginVersion[];
    /** A condensed summary for one plugin (latest version + indexed metadata). */
    summary(name: string): PluginSummary | undefined;
    /** Summaries for every plugin, in stable name order. */
    summaries(): PluginSummary[];
}
//# sourceMappingURL=store.d.ts.map